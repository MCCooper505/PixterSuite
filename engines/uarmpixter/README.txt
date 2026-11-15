PixterSuite's Color adapter runs the upstream uARMpixter ARM emulator built
with Emscripten and SDL2. The browser build is in uarmpixter.js and
uarmpixter.wasm; the adapted upstream source and GPLv3 license are in source/.

The adapter contract is:

window.PixterColorAdapter = {
  async start({
    canvas,
    cartridge: Uint8Array,
    cartridgeName,
    consoleRom: Uint8Array,
    consoleRomName,
    system
  }) {},
  async stop() {},
  input(controlName) {}
};

Choose a Pixter Color console ROM and a Color .PCI cartridge in the page before
starting. The firmware ROM is not bundled. Touches on the canvas are forwarded
to the emulated resistive touchscreen. The Calibrate control forwards the
device's calibration key; Menu and Back are not supported by this device build.

The emulator's internal EEPROM and cartridge save file are persisted in
browser localStorage. They are local to the current site and browser profile.
Serve the page over HTTPS (or localhost); `file://` is not supported.

Rebuild from the repository root with `make -C engines/uarmpixter/source` and
an Emscripten SDK that provides the SDL2 port.
