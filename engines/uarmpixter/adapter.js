(function () {
  "use strict";

  var adapterScript = document.currentScript;
  var engineDirectory = adapterScript
    ? new URL(".", adapterScript.src)
    : new URL("engines/uarmpixter/", document.baseURI);
  var engineScriptUrl = new URL("uarmpixter.js", engineDirectory).href;
  var wasmUrl = new URL("uarmpixter.wasm", engineDirectory).href;
  var factoryPromise = null;
  var running = null;

  function loadFactory() {
    if (typeof window.createPixterColorModule === "function") {
      return Promise.resolve(window.createPixterColorModule);
    }
    if (!factoryPromise) {
      factoryPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = engineScriptUrl;
        script.onload = function () {
          if (typeof window.createPixterColorModule !== "function") {
            factoryPromise = null;
            reject(new Error("The uARMpixter JavaScript build did not expose its module factory."));
            return;
          }
          resolve(window.createPixterColorModule);
        };
        script.onerror = function () {
          factoryPromise = null;
          reject(new Error("Could not load the uARMpixter JavaScript build."));
        };
        document.head.appendChild(script);
      });
    }
    return factoryPromise;
  }

  function toBase64(bytes) {
    var binary = "";
    var chunkSize = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function fromBase64(value) {
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function putPersistentFile(module, path, key) {
    var encoded = window.localStorage.getItem(key);
    if (encoded !== null) module.FS.writeFile(path, fromBase64(encoded));
  }

  function savePersistentFile(module, path, key) {
    if (!module.FS.analyzePath(path).exists) return;
    window.localStorage.setItem(key, toBase64(module.FS.readFile(path)));
  }

  function touchPoint(canvas, event) {
    var bounds = canvas.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - bounds.left) * canvas.width / bounds.width),
      y: Math.floor((event.clientY - bounds.top) * canvas.height / bounds.height)
    };
  }

  function attachTouch(module, canvas) {
    var pointerId = null;

    function down(event) {
      event.preventDefault();
      pointerId = event.pointerId;
      if (canvas.setPointerCapture) canvas.setPointerCapture(pointerId);
      var point = touchPoint(canvas, event);
      module.ccall("uarmpixterTouch", null, ["number", "number", "number"], [point.x, point.y, 1]);
    }

    function move(event) {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      var point = touchPoint(canvas, event);
      module.ccall("uarmpixterTouch", null, ["number", "number", "number"], [point.x, point.y, 1]);
    }

    function up(event) {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      pointerId = null;
      module.ccall("uarmpixterTouch", null, ["number", "number", "number"], [0, 0, 0]);
    }

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return function detach() {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }

  window.PixterColorAdapter = {
    async start(options) {
      if (!options || !(options.cartridge instanceof Uint8Array) || !(options.consoleRom instanceof Uint8Array)) {
        throw new Error("Choose both a Pixter Color console ROM and a .PCI cartridge.");
      }
      if (options.system !== "color") throw new Error("uARMpixter only supports Pixter Color in this build.");
      if (running) await this.stop();

      var factory = await loadFactory();
      var logs = [];
      var module = await factory({
        canvas: options.canvas,
        noInitialRun: true,
        locateFile: function (path) {
          return path.endsWith(".wasm") ? wasmUrl : new URL(path, engineDirectory).href;
        },
        print: function (message) { console.info("[uARMpixter]", message); },
        printErr: function (message) {
          logs.push(String(message));
          if (logs.length > 20) logs.shift();
          console.error("[uARMpixter]", message);
        }
      });

      var eepromPath = "/pixter-color.eeprom";
      var savegamePath = "/cartridge-savegame.bin";
      var eepromKey = "pixtersuite:uarmpixter:color:eeprom";
      var savegameKey = "pixtersuite:uarmpixter:color:savegame:" + encodeURIComponent(options.cartridgeName);
      var cartridgePath = "/cartridge.pci";
      var consoleRomPath = "/console.pci";

      try {
        putPersistentFile(module, eepromPath, eepromKey);
        putPersistentFile(module, savegamePath, savegameKey);
        module.FS.writeFile(consoleRomPath, options.consoleRom);
        module.FS.writeFile(cartridgePath, options.cartridge);

        var result = module.ccall(
          "uarmpixterStart",
          "number",
          ["string", "string", "string", "string"],
          [consoleRomPath, eepromPath, cartridgePath, savegamePath]
        );
        if (result !== 0) {
          var details = logs.slice(-5).join("\n");
          throw new Error(details || "The uARMpixter emulator rejected the console ROM or cartridge.");
        }

        running = {
          module: module,
          canvas: options.canvas,
          detachTouch: attachTouch(module, options.canvas),
          eepromPath: eepromPath,
          eepromKey: eepromKey,
          savegamePath: savegamePath,
          savegameKey: savegameKey
        };
      } catch (error) {
        if (typeof module._uarmpixterStop === "function") {
          try {
            module.ccall("uarmpixterStop", null, [], []);
          } catch (cleanupError) {
            console.error("[uARMpixter] Cleanup after startup failure failed", cleanupError);
          }
        }
        var details = logs.slice(-5).join("\n");
        var message = error && error.message ? error.message : String(error);
        if (details && message.indexOf(details) === -1) {
          throw new Error(details + "\n" + message);
        }
        throw error;
      }
    },

    async stop() {
      var session = running;
      if (!session) return;
      running = null;
      session.detachTouch();
      session.module.ccall("uarmpixterStop", null, [], []);
      savePersistentFile(session.module, session.eepromPath, session.eepromKey);
      savePersistentFile(session.module, session.savegamePath, session.savegameKey);
    },

    input(controlName) {
      if (!running) return;
      if (controlName !== "calibrate") {
        throw new Error("uARMpixter does not implement the " + controlName + " control.");
      }
      running.module.ccall("uarmpixterInput", null, ["number", "number"], [0, 1]);
      running.module.ccall("uarmpixterInput", null, ["number", "number"], [0, 0]);
    }
  };
})();