EMCC ?= emcc

COMMON_SOURCES = \
	main.c CPU.c mem.c RAM.c ROM.c gdbstub.c keys.c irqConnector.c \
	lh7xxxx_IC.c lh7xxxx_RCPC.c lh7xxxx_CLCD.c lh7xxxx_Timer.c \
	lh7xxxx_ADC.c lh7xxxx_IOCON.c lh7xxxx_GPIO.c \
	lh7xxxx_UARTtypeB.c lh7xxxx_UARTtypeA.c lh7xxxx_UARTpolymorphism.c \
	lh7xxxx_DMA.c cp15none.c MXU.c lh754xx_SMC.c lh754xx_SSP.c \
	lh754xx_I2S.c devicePixterColor.c gpiodev_PixterBbBex.c \
	gpiodev_MasterI2C.c i2cdev_24C02.c pixterMelodyChip.c \
	pixterMelodyChipXL.c pixterRomFile.c at29lv010a.c

EMFLAGS = -O3 -D_GNU_SOURCE -sUSE_SDL=2 \
	-sMODULARIZE=1 -sEXPORT_NAME=createPixterColorModule \
	-sENVIRONMENT=web --no-entry -sNO_EXIT_RUNTIME=1 \
	-sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 \
	-sFORCE_FILESYSTEM=1 \
	-sEXPORTED_FUNCTIONS=_uarmpixterStart,_uarmpixterTouch,_uarmpixterInput,_uarmpixterStop,_malloc,_free \
	-sEXPORTED_RUNTIME_METHODS=FS,ccall

.PHONY: all clean

all: ../uarmpixter.js

../uarmpixter.js: $(COMMON_SOURCES) $(wildcard *.h) Makefile
	$(EMCC) $(EMFLAGS) $(COMMON_SOURCES) -o $@

clean:
	rm -f ../uarmpixter.js ../uarmpixter.wasm


