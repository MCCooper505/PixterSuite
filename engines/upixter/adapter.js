(function () {
  "use strict";

  var adapterScript = document.currentScript;
  var engineDirectory = adapterScript
    ? new URL(".", adapterScript.src)
    : new URL("engines/upixter/", document.baseURI);
  var engineScriptUrl = new URL("upixter.js", engineDirectory).href;
  var wasmUrl = new URL("upixter.wasm", engineDirectory).href;
  var factoryPromise = null;
  var running = null;
  var calibrationTimer = null;

  function loadFactory() {
    if (typeof window.createPixterClassicModule === "function") {
      return Promise.resolve(window.createPixterClassicModule);
    }
    if (!factoryPromise) {
      factoryPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = engineScriptUrl;
        script.onload = function () {
          if (typeof window.createPixterClassicModule !== "function") {
            factoryPromise = null;
            reject(new Error("The uPixter JavaScript build did not expose its module factory."));
            return;
          }
          resolve(window.createPixterClassicModule);
        };
        script.onerror = function () {
          factoryPromise = null;
          reject(new Error("Could not load the uPixter JavaScript build."));
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

  function attachTouch(module, canvas) {
    var pointerId = null;
    var pendingPoint = null;
    var moveFrame = null;

    function send(clientX, clientY, down) {
      var bounds = canvas.getBoundingClientRect();
      var x = Math.floor((clientX - bounds.left) * canvas.width / bounds.width / 2);
      var y = Math.floor((clientY - bounds.top) * canvas.height / bounds.height / 2);
      module.ccall("upixterTouch", null, ["number", "number", "number"], [x, y, down ? 1 : 0]);
    }

    function down(event) {
      event.preventDefault();
      pointerId = event.pointerId;
      if (canvas.setPointerCapture) canvas.setPointerCapture(pointerId);
      send(event.clientX, event.clientY, true);
    }

    function move(event) {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      pendingPoint = { x: event.clientX, y: event.clientY };
      if (moveFrame !== null) return;
      moveFrame = window.requestAnimationFrame(function () {
        moveFrame = null;
        var point = pendingPoint;
        pendingPoint = null;
        if (pointerId !== null && point) send(point.x, point.y, true);
      });
    }

    function up(event) {
      if (pointerId !== event.pointerId) return;
      event.preventDefault();
      if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
      moveFrame = null;
      pendingPoint = null;
      pointerId = null;
      send(event.clientX, event.clientY, false);
    }

    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    return function detach() {
      if (moveFrame !== null) window.cancelAnimationFrame(moveFrame);
      moveFrame = null;
      pendingPoint = null;
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
    };
  }

  window.PixterClassicAdapter = {
    async start(options) {
      if (!options || !(options.cartridge instanceof Uint8Array) || !(options.consoleRom instanceof Uint8Array)) {
        throw new Error("Choose both a Pixter Classic console ROM and a .PCI cartridge.");
      }
      if (options.system !== "classic") throw new Error("uPixter only supports Pixter Classic in this build.");
      if (running) await this.stop();

      var factory = await loadFactory();
      var logs = [];
      var module = await factory({
        canvas: options.canvas,
        noInitialRun: true,
        locateFile: function (path) {
          return path.endsWith(".wasm") ? wasmUrl : new URL(path, engineDirectory).href;
        },
        print: function (message) { console.info("[uPixter]", message); },
        printErr: function (message) {
          logs.push(String(message));
          if (logs.length > 20) logs.shift();
          console.error("[uPixter]", message);
        }
      });

      var eepromPath = "/pixter-classic.eeprom";
      var eepromKey = "pixtersuite:upixter:classic:eeprom";
      var flashPath = "/cartridge-flash.bin";
      var flashKey = "pixtersuite:upixter:classic:flash:" + encodeURIComponent(options.cartridgeName);
      var cartridgePath = "/cartridge.pci";
      var consoleRomPath = "/console.pci";

      try {
        putPersistentFile(module, eepromPath, eepromKey);
        putPersistentFile(module, flashPath, flashKey);
        module.FS.writeFile(consoleRomPath, options.consoleRom);
        module.FS.writeFile(cartridgePath, options.cartridge);

        var result = module.ccall(
          "upixterStart",
          "number",
          ["string", "string", "string", "string"],
          [consoleRomPath, eepromPath, cartridgePath, flashPath]
        );
        if (result !== 0) {
          var details = logs.slice(-5).join("\n");
          throw new Error(details || "The uPixter emulator rejected the console ROM or cartridge.");
        }

        running = {
          module: module,
          detachTouch: attachTouch(module, options.canvas),
          eepromPath: eepromPath,
          eepromKey: eepromKey,
          flashPath: flashPath,
          flashKey: flashKey
        };
      } catch (error) {
        if (typeof module._upixterStop === "function") {
          try {
            module.ccall("upixterStop", null, [], []);
          } catch (cleanupError) {
            console.error("[uPixter] Cleanup after startup failure failed", cleanupError);
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
      if (calibrationTimer !== null) {
        window.clearTimeout(calibrationTimer);
        calibrationTimer = null;
      }
      session.detachTouch();
      session.module.ccall("upixterStop", null, [], []);
      savePersistentFile(session.module, session.eepromPath, session.eepromKey);
      savePersistentFile(session.module, session.flashPath, session.flashKey);
    },

    input(controlName) {
      if (!running) return;
      if (controlName !== "calibrate") {
        throw new Error("uPixter does not implement the " + controlName + " control.");
      }
      if (calibrationTimer !== null) window.clearTimeout(calibrationTimer);
      running.module.ccall("upixterCalibration", null, ["number"], [1]);
      var module = running.module;
      calibrationTimer = window.setTimeout(function () {
        calibrationTimer = null;
        if (running && running.module === module) {
          module.ccall("upixterCalibration", null, ["number"], [0]);
        }
      }, 50);
    }
  };
})();
