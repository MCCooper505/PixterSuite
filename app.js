(function () {
  "use strict";

  var systemSelect = document.getElementById("system");
  var chooseCart = document.getElementById("chooseCart");
  var cartInput = document.getElementById("cartInput");
  var startButton = document.getElementById("start");
  var stopButton = document.getElementById("stop");
  var engineStatus = document.getElementById("engineStatus");
  var screenMessage = document.getElementById("screenMessage");
  var currentCart = null;
  var activeEngine = null;

  var configs = {
    classic: {
      title: "Pixter Classic",
      engine: "uPixter",
      moduleUrl: "engines/upixter/adapter.js",
      adapterGlobal: "PixterClassicAdapter"
    },
    color: {
      title: "Pixter Color",
      engine: "uARMpixter",
      moduleUrl: "engines/uarmpixter/adapter.js",
      adapterGlobal: "PixterColorAdapter"
    }
  };

  function config() { return configs[systemSelect.value]; }

  function updateSystem() {
    var selected = config();
    document.getElementById("deviceTitle").textContent = selected.title;
    document.getElementById("engineName").textContent = selected.engine + " adapter not installed";
    stopEngine();
    refreshStartState();
  }

  function refreshStartState() {
    var selected = config();
    var adapter = window[selected.adapterGlobal];
    var ready = !!(adapter && typeof adapter.start === "function" && typeof adapter.stop === "function");
    startButton.disabled = !(currentCart && ready);
    stopButton.disabled = !activeEngine;
    engineStatus.textContent = ready ? "Engine adapter detected" : "Emulator engines not connected";
    engineStatus.className = "status " + (ready ? "good" : "warn");
    if (ready) document.getElementById("engineName").textContent = selected.engine + " adapter detected";
  }

  function stopEngine() {
    if (activeEngine && typeof activeEngine.stop === "function") {
      try { activeEngine.stop(); } catch (error) { console.error(error); }
    }
    activeEngine = null;
    stopButton.disabled = true;
    screenMessage.hidden = false;
  }

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
      document.getElementById("validation").textContent = "File read locally; format not yet verified";
      screenMessage.hidden = false;
      screenMessage.querySelector("strong").textContent = "Cartridge loaded into browser memory";
      screenMessage.querySelector("span").textContent = "The file is selected and read. A verified Pixter engine adapter is still required to execute it.";
      refreshStartState();
    } catch (error) {
      document.getElementById("validation").textContent = "Could not read file: " + error.message;
    }
  });

  startButton.addEventListener("click", async function () {
    var selected = config();
    var adapter = window[selected.adapterGlobal];
    if (!currentCart || !adapter || typeof adapter.start !== "function") return;
    try {
      activeEngine = adapter;
      await adapter.start({
        canvas: document.getElementById("screen"),
        cartridge: currentCart.bytes,
        cartridgeName: currentCart.name,
        system: systemSelect.value
      });
      screenMessage.hidden = true;
      stopButton.disabled = false;
    } catch (error) {
      activeEngine = null;
      screenMessage.hidden = false;
      screenMessage.querySelector("strong").textContent = "Engine failed to start";
      screenMessage.querySelector("span").textContent = error.message || String(error);
      refreshStartState();
    }
  });

  stopButton.addEventListener("click", stopEngine);
  systemSelect.addEventListener("change", updateSystem);

  document.querySelectorAll("[data-control]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (activeEngine && typeof activeEngine.input === "function") {
        activeEngine.input(button.dataset.control);
      }
    });
  });

  updateSystem();
})();
