This directory contains the Pixter Color emulator source from Dmitry Grinberg's
official Pixter downloads archive:
https://dmitry.gr/?proj=37.+Pixter&r=05.Projects

The upstream emulator is licensed under GNU GPL version 3; see LICENSE.txt.
The browser entry point and frame scheduler in main.c are PixterSuite changes.
SDL2 and Emscripten license notices for the generated runtime are included in
SDL2-LICENSE.txt and EMSCRIPTEN-LICENSE.txt. The Multimedia device is not
included in this browser build. The browser build shares one audio device for
console and cartridge melodies; timer PWM audio is omitted because SDL's
browser backend supports only one open audio device.

Build the Emscripten output from the repository root with:

  make -C engines/uarmpixter/source

This writes uarmpixter.js and uarmpixter.wasm into the parent directory.
The console ROM is copyrighted firmware and is not included. Select a Pixter
Color console ROM in PixterSuite before starting a cartridge.
