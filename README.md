# PixterSuite

PixterSuite is a browser launcher for Pixter Classic and Pixter Color. Both
systems are connected to their upstream C emulators compiled to WebAssembly
with Emscripten and SDL2.

## Running

1. Serve this directory over HTTPS (do not open `index.html` using `file://`).
2. Select **Pixter Classic** or **Pixter Color** in Safari.
3. Choose that system's console `.PCI` ROM and a `.PCI` cartridge.
4. Tap **Start**. Touch input is forwarded to the emulator; **Calibrate** sends
   the device calibration input.

The console ROMs are copyrighted device firmware and are intentionally not
included. The emulator validates selected ROMs when it starts. Selected files
stay in browser memory and are not uploaded.

EEPROM and cartridge save data are stored in the browser's `localStorage`,
scoped to the current site and browser profile. Clearing site data removes
those saves.

## Building the WebAssembly emulators

The generated JavaScript and `.wasm` builds are included. Install Emscripten
with its SDL2 port, then rebuild each emulator:

```sh
make -C engines/uarmpixter/source
make -C engines/upixter/source
```

The uARMpixter Color source is from Dmitry Grinberg's official Pixter downloads
archive. The uPixter Classic source and its GPLv3 license are included in
`engines/upixter/source/`. License notices for Emscripten and SDL2 are included
alongside the emulator sources. PixterSuite's browser-specific entry points,
input handling, and frame schedulers are documented in each engine directory.

Neither emulator includes the console firmware. Menu and Back controls are not
exposed by these device models.

## References

- https://dmitry.gr/?proj=37.+Pixter&r=05.Projects
- https://github.com/uARM-Palm/uARM
- https://wiki.libsdl.org/SDL2/Installation
