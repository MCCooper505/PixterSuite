EMCC ?= emcc

SOURCES = \
	6502.c main.c rom.c melodyChip.c gpioMasterI2C.c i2cdev_24C02.c \
	at29lv010a.c almostSST39SF010A.c

EMFLAGS = -O2 -D_GNU_SOURCE -DPIXTER_CLASSIC -sUSE_SDL=2 \
	-sMODULARIZE=1 -sEXPORT_NAME=createPixterClassicModule \
	-sENVIRONMENT=web --no-entry -sNO_EXIT_RUNTIME=1 \
	-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
	-sFORCE_FILESYSTEM=1 \
	-sEXPORTED_FUNCTIONS=_upixterStart,_upixterTouch,_upixterCalibration,_upixterStop,_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=FS,ccall

.PHONY: all clean

all: ../upixter.js

../upixter.js: $(SOURCES) $(wildcard *.h) Makefile
	$(EMCC) $(EMFLAGS) $(SOURCES) -o $@

clean:
	rm -f ../upixter.js ../upixter.wasm
