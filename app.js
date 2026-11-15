(function () {
  "use strict";

  var systemSelect = document.getElementById("system");
  var chooseConsoleRom = document.getElementById("chooseConsoleRom");
  var consoleRomInput = document.getElementById("consoleRomInput");
  var chooseCart = document.getElementById("chooseCart");
  var cartInput = document.getElementById("cartInput");
  var startButton = document.getElementById("start");
  var stopButton = document.getElementById("stop");
  var engineStatus = document.getElementById("engineStatus");
  var screenMessage = document.getElementById("screenMessage");
  var currentConsoleRom = null;
  var currentCart = null;
  var activeEngine = null;
  var engineStarting = false;
  var engineStopping = false;

  var configs = {
    classic: {
      title: "Pixter Classic",
      engine: "uPixter",
      moduleUrl: "engines/upixter/adapter.js",
      adapterGlobal: "PixterClassicAdapter",
      requiresConsoleRom: true,
      consoleRomLabel: "Choose Classic console ROM",
      controls: ["calibrate"],
      validationEngine: "uPixter"
    },
    color: {
      title: "Pixter Color",
      engine: "uARMpixter",
      moduleUrl: "engines/uarmpixter/adapter.js",
      adapterGlobal: "PixterColorAdapter",
      requiresConsoleRom: true,
      consoleRomLabel: "Choose Color console ROM",
      controls: ["calibrate"],
      validationEngine: "uARMpixter"
    }
  };

  function config() { return configs[systemSelect.value]; }

  function updateSystem() {
    var selected = config();
    document.getElementById("deviceTitle").textContent = selected.title;
    document.getElementById("engineName").textContent = selected.engine + " adapter not installed";
    chooseConsoleRom.textContent = selected.consoleRomLabel;
    document.getElementById("consoleRomLabel").textContent = selected.title + " console ROM";
    screenMessage.querySelector("strong").textContent = currentCart ? "Cartridge loaded into browser memory" : "Emulator engine required";
    screenMessage.querySelector("span").textContent = currentCart
      ? "Choose a " + selected.title + " console ROM and press Start to run this cartridge."
      : "Choose a " + selected.title + " console ROM and a .PCI cartridge to start the emulator.";
    if (activeEngine) stopEngine();
    refreshStartState();
  }

  function refreshStartState() {
    var selected = config();
    var adapter = window[selected.adapterGlobal];
    var ready = !!(adapter && typeof adapter.start === "function" && typeof adapter.stop === "function");
    var hasRequiredFiles = !!(currentCart && (!selected.requiresConsoleRom || currentConsoleRom));
    startButton.disabled = !(hasRequiredFiles && ready) || engineStarting || engineStopping || !!activeEngine;
    stopButton.disabled = !activeEngine || engineStarting || engineStopping;
    systemSelect.disabled = engineStarting || engineStopping || !!activeEngine;
    chooseCart.disabled = engineStarting || engineStopping || !!activeEngine;
    chooseConsoleRom.disabled = !selected.requiresConsoleRom || engineStarting || engineStopping || !!activeEngine;
    engineStatus.textContent = ready ? selected.title + " emulator connected" : "Emulator engines not connected";
    engineStatus.className = "status " + (ready ? "good" : "warn");
    if (ready) document.getElementById("engineName").textContent = selected.engine + " WebAssembly emulator";
    document.querySelectorAll("[data-control]").forEach(function (button) {
      button.disabled = !activeEngine || engineStarting || engineStopping || !selected.controls || selected.controls.indexOf(button.dataset.control) === -1;
    });
  }

  async function stopEngine() {
    var engine = activeEngine;
    if (!engine || typeof engine.stop !== "function") return;
    engineStopping = true;
    refreshStartState();
    try {
      await engine.stop();
    } catch (error) {
      document.getElementById("validation").textContent = "Could not save emulator state: " + (error.message || String(error));
    } finally {
      activeEngine = null;
      engineStopping = false;
      screenMessage.hidden = false;
      refreshStartState();
    }
  }

  chooseConsoleRom.addEventListener("click", function () { consoleRomInput.click(); });
  consoleRomInput.addEventListener("change", async function () {
    var file = consoleRomInput.files && consoleRomInput.files[0];
    if (!file) return;
    if (!/\.pci$/i.test(file.name)) {
      document.getElementById("validation").textContent = "Rejected: choose a Pixter console .PCI ROM";
      return;
    }
    try {
      currentConsoleRom = {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer())
      };
      document.getElementById("consoleRomName").textContent = file.name;
      document.getElementById("validation").textContent = "Console ROM read locally; format is checked by " + config().validationEngine;
      refreshStartState();
    } catch (error) {
      document.getElementById("validation").textContent = "Could not read console ROM: " + error.message;
    }
  });

  chooseCart.addEventListener("click", function () { cartInput.click(); });
  cartInput.addEventListener("change", async function () {
    var file = cartInput.files && cartInput.files[0];
    if (!file) return;
    if (!/\.pci$/i.test(file.name)) {
      document.getElementById("validation").textContent = "Rejected: choose a .PCI file";
      return;
    }
    try {
      var bytes = await file.arrayBuffer();
      currentCart = { name: file.name, size: file.size, bytes: new Uint8Array(bytes) };
      document.getElementById("cartName").textContent = file.name;
      document.getElementById("fileName").textContent = file.name;
      document.getElementById("fileSize").textContent = file.size.toLocaleString() + " bytes";
      document.getElementById("validation").textContent = "Cartridge read locally; format is checked by " + config().validationEngine;
      screenMessage.hidden = false;
      screenMessage.querySelector("strong").textContent = "Cartridge loaded into browser memory";
      screenMessage.querySelector("span").textContent = "Choose a " + config().title + " console ROM and press Start to run this cartridge.";
      refreshStartState();
    } catch (error) {
      document.getElementById("validation").textContent = "Could not read file: " + error.message;
    }
  });

  startButton.addEventListener("click", async function () {
    var selected = config();
    var adapter = window[selected.adapterGlobal];
    if (!currentCart || (selected.requiresConsoleRom && !currentConsoleRom) || !adapter || typeof adapter.start !== "function" || activeEngine || engineStarting || engineStopping) return;
    activeEngine = adapter;
    engineStarting = true;
    refreshStartState();
    try {
      await adapter.start({
        canvas: document.getElementById("screen"),
        cartridge: currentCart.bytes,
        cartridgeName: currentCart.name,
        consoleRom: currentConsoleRom && currentConsoleRom.bytes,
        consoleRomName: currentConsoleRom && currentConsoleRom.name,
        system: systemSelect.value
      });
      screenMessage.hidden = true;
    } catch (error) {
      activeEngine = null;
      screenMessage.hidden = false;
      screenMessage.querySelector("strong").textContent = "Engine failed to start";
      screenMessage.querySelector("span").textContent = error.message || String(error);
    } finally {
      engineStarting = false;
      refreshStartState();
    }
  });

  stopButton.addEventListener("click", function () { stopEngine(); });
  systemSelect.addEventListener("change", updateSystem);
  window.addEventListener("pagehide", function () {
    if (activeEngine) stopEngine();
  });

  document.querySelectorAll("[data-control]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (activeEngine && typeof activeEngine.input === "function") {
        activeEngine.input(button.dataset.control);
      }
    });
  });

  updateSystem();
})();
