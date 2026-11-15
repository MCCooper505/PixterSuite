# PixterSuite Safari frontend

This package is a working Safari front-end shell for a combined Pixter Classic / Pixter Color project. It supports choosing a `.PCI` file from the iPad Files picker and reading its bytes locally in the browser.

## Important status

**Implemented in this package**
- Responsive Safari-friendly interface
- Classic / Color selector
- iOS file picker for `.PCI` files
- Local file read into browser memory
- Adapter detection and guarded Start / Stop controls
- Touch-control event forwarding contract

**Not implemented or verified**
- uPixter compiled to WebAssembly
- uARMpixter compiled to WebAssembly
- Pixter console ROM and internal EEPROM provisioning
- `.PCI` format validation and hardware-specific cartridge mounting
- Actual emulator execution, display rendering, sound, touchscreen/stylus emulation
- EEPROM persistence and cartridge save persistence

The original Pixter emulators are SDL2 programs. The maintainer describes uARMpixter as the Pixter Color / Multimedia ARM emulator and uPixter as the Pixter Classic / Plus / 2.0 6502 emulator. The documented command-line programs require console ROM and EEPROM files and do not provide a documented browser adapter API. A generic uARM Linux-in-browser port is not the Pixter Color emulator.

## Run / host

Serve this directory from an HTTPS static host. Do not open `index.html` using a `file://` URL. On iPad, open the HTTPS site in Safari, tap **Choose .PCI from Files**, and select a cartridge.

The page can be smoke-tested without emulator files: the file picker should populate the filename, size, and local-read status. Start remains disabled until a real adapter is installed.

## Integrating the real emulator builds

1. Build each upstream emulator for the browser with Emscripten and SDL2, or use an existing build only after confirming its origin and exports.
2. Put the Classic build and adapter in `engines/upixter/`.
3. Put the Color build and adapter in `engines/uarmpixter/`.
4. Implement the adapter contracts in the corresponding README files.
5. Ensure each adapter supplies the correct console ROM and persistent internal EEPROM.
6. Verify cartridge format and mounting separately for Classic and Color. Do not assume every `.PCI` file is compatible with both systems.
7. Test display, touch/stylus, buttons, sound, and save persistence on iPad Safari.

## Upstream technical references

- https://dmitry.gr/?proj=37.+Pixter&r=05.Projects
- https://github.com/TonyLianLong/uARM.wasm
- https://wiki.libsdl.org/SDL2/Installation

## Privacy

The frontend does not upload cartridge bytes. File data is held in memory for the current page session. Persistent saves are not implemented in this package.
