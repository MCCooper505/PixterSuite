Pixter Classic browser emulator

The browser adapter connects the upstream uPixter Pixter Classic emulator to
PixterSuite. The source, authored by Dmitry Grinberg and obtained from the
official Pixter downloads archive, and its GPLv3 license are included in
source/. The build uses Emscripten and its SDL2 port; their license notices
are also in source/.

Build from the repository root with:

    make -C engines/upixter/source

The build produces upixter.js and upixter.wasm beside this file. The adapter
requires a user-supplied Pixter Classic console ROM and a .PCI cartridge. It
stores the console EEPROM and cartridge flash file in localStorage. The console
firmware is not included.

PixterSuite's browser changes add an animation-frame scheduler, exported start,
stop, touch, and calibration functions, and direct pointer input. The original
SDL mouse and keyboard polling is retained for native builds and bypassed for
the browser build.
