//(c) uARM project    https://github.com/uARM-Palm/uARM    uARM@dmitry.gr

#include "CPU.h"
#include "MMU.h"
#include "mem.h"
#include "RAM.h"
#include "ROM.h"
#include "cp15.h"

#include <sys/time.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/types.h>
#include <string.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <sys/select.h>
#include <signal.h>
#include <termios.h>
#include <getopt.h>
#include <time.h>

#include "lh7xxxx_IOCON.h"
#include "lh7xxxx_Timer.h"
#include "lh7xxxx_RCPC.h"
#include "lh7xxxx_DMA.h"
#include "lh7xxxx_SMC.h"
#include "lh7xxxx_ADC.h"
#include "lh7xxxx_CLCD.h"
#include "lh7xxxx_IC.h"
#include "lh7xxxx_I2S.h"

#include "soc_UART.h"
#include "soc_GPIO.h"
#include "soc_SSP.h"
#include "soc_DMA.h"
#include "soc_I2C.h"
#include "soc_I2S.h"
#include "soc_IC.h"

#include "pixterMelodyChipXL.h"
#include "pixterMelodyChip.h"
#include "pixterRomFile.h"
#include "at29lv010a.h"
#include "SDL2/SDL.h"
#include "device.h"
#include "keys.h"
#include "util.h"
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif


#define ROM_BASE			0x48000000		//external memory permanent address for nCS2 (our rom)

#define TCM_BASE			0x80000000
#define TCM_SIZE			0x00004004

#define SRAM_BASE			0x60000000
#define SRAM_SIZE			0x00004000

struct SoC {

	struct Lh7xxxxIocon* iocon;
	struct Lh7xxxxTimer *tmr[3];
	struct SocUart *uart[3];
	struct Lh7xxxxSmc *smc;
	struct Lh7xxxxLcd *lcd;
	struct Lh7xxxxAdc *adc;
	struct Lh7xxxxRcpc *rcpc;
	struct SocGpio *gpio;
	struct SocDma *dma;
	struct SocSsp *ssp;
	struct SocI2s *i2s;
	struct SocIc *ic;
	
	struct ArmRam *externalRam;		//on my board, variable size
	struct ArmRam *tcm;				//in CPU: 16KB, not usable for DMA or LCDC
	struct ArmRam *internalSram;	//in CPU, usable for DMA and LCDC
	struct ArmRom *externalRom;
	struct ArmMem *mem;
	struct ArmCpu *cpu;
	
	struct Device *dev;

	struct MelodyChip *cartMelodyChip, *consoleMelodyChip;
	struct MelodyChipXL *cartMelodyChipXL;

	struct AT29LV010A *classicCartSavegameNor;

	bool mouseDown;

	uint32_t crystalHz, pllHz, hclkHz, cpuHz;
	uint32_t cycles;
	FILE *eepromFile, *savegameFile;
	struct timespec nextDispUpdate, nextAdcTick, nextUartTick;
	struct timespec nextMelodyChipTick, nextUiPollTick, nextTimersTick;
};

#ifdef __EMSCRIPTEN__
static struct SoC *g_soc;
#endif



static struct SoC* socInit(struct PixterRomFile *consoleRom, struct PixterRomFile *cartRom, FILE* eepromFile, FILE* savegameFile, int gdbPort)
{
	SDL_AudioSpec gotten, desiredSpecMusic = {
		.freq = 22050,
		.format = 0x8010,	//S16
		.channels = 1,
	};
	struct SoC *soc = (struct SoC*)calloc(1, sizeof(struct SoC));
	SDL_AudioDeviceID audioDev;
	struct SocPeriphs sp = {};
	static uint32_t zero = 0;
	void *buffer;
	uint32_t i;
	
	soc->mem = memInit();
	if (!soc->mem)
		ERR("Cannot init physical memory manager");

	//ARM7TDMI-S
	soc->cpu = cpuInit(0, soc->mem, (deviceGetSocRev() ? CPU_CORE_FTR_CAN_CONFIG_ALIGN_CHECK : 0) | CPU_CORE_ARM_V4 | CPU_CORE_FTR_T | CPU_CORE_FTR_BASE_UPDATED_EXC_MODEL | CPU_SOC_TYPE_ARM | CPU_CORE_FTR_PC_BIT_1_IMPL, gdbPort, 0, 0);
	if (!soc->cpu)
		ERR("Cannot init CPU");
	
	if (deviceGetSocRev() == 0) {
	
		buffer = (uint32_t*)malloc(TCM_SIZE);
		if (!buffer)
			ERR("cannot alloc TCM space\n");

		soc->tcm = ramInit(soc->mem, TCM_BASE, TCM_SIZE * 2, buffer);	//one wrap around
		if (!soc->tcm)
			ERR("Cannot init TCM");
	}

	buffer = (uint32_t*)malloc(SRAM_SIZE);
	if (!buffer)
		ERR("cannot alloc SRAM space\n");

	soc->internalSram = ramInitEx(soc->mem, SRAM_BASE, SRAM_SIZE, 0x20000000, buffer);
	if (!soc->internalSram)
		ERR("Cannot init internal SRAM");
	
	soc->externalRom = romInitWithPixterCartRom(soc->mem, ROM_BASE, 16 << 20, (cartRom && (cartRom->romType == PixterRomColor || cartRom->romType == PixterRomMultimedia)) ? cartRom : NULL, 0, RomJedecFlashX16);
	if (!soc->externalRom)
		ERR("Cannot init ROM1");

	soc->ic = socIcInit(soc->cpu, soc->mem, deviceGetSocRev());
	if (!soc->ic)
		ERR("Cannot init IC");

	soc->rcpc = lh7xxxxRcpcInit(soc->cpu, soc->mem, soc->ic, soc);
	if (!soc->rcpc)
		ERR("Cannot init RCPC");

	soc->iocon = lh7xxxxIoconInit(soc->mem, true);
	if (!soc->iocon)
		ERR("Cannot init IOCON");

	soc->smc = lh7xxxxSmcInit(soc->mem, true);
	if (!soc->smc)
		ERR("Cannot init SMC");

	soc->lcd = lh7xxxxClcdInit(soc->mem, soc->ic, false);
	if (!soc->lcd)
		ERR("Cannot init LCDC");

	soc->adc = lh7xxxxAdcInit(soc->mem, soc->ic);
	if (!soc->adc)
		ERR("Cannot init ADC");

	soc->gpio = socGpioInit(soc->mem, soc->ic, deviceGetSocRev());
	if (!soc->gpio)
		ERR("Cannot init GPIO");

	soc->dma = socDmaInit(soc->mem, soc->ic);
	if (!soc->dma)
		ERR("Cannot init DMA");

	soc->ssp = socSspInit(soc->mem, soc->ic, soc->dma, 0 /* knows own base */, 0 /* knows own irq nums */, deviceGetSocRev() ? 0 : -1);
	if (!soc->ssp)
		ERR("Cannot init SSP");

	if (deviceGetSocRev()) {
		soc->i2s = socI2sInit(soc->mem, soc->ic, soc->dma);
		if (!soc->i2s)
			ERR("Cannot init I2S");
		lh795xxI2sSetSSP(soc->i2s, soc->ssp);
	}

	for (i = 0; i < sizeof(soc->tmr) / sizeof(*soc->tmr); i++) {
		soc->tmr[i] = lh7xxxxTimerInit(soc->mem, soc->ic, 0xfffc4000 + (i ? 0x30 + 0x20 * (i - 1) : 0x00), LH7xxxx_I_TMR0 + i, !i);

		if (!soc->tmr[i])
			ERR("Cannot init TMR%u", i);
	}

	soc->uart[0] = socUartInit(soc->mem, soc->ic, soc->dma, 0xFFFC0000, deviceGetSocRev() ? LH795xx_I_UART0 : LH754xx_I_UART0_INTR, LH7XXXX_DMA_STRM_UART0TX_M2M, LH7XXXX_DMA_STRM_UART0RX_DREQ);
	if (!soc->uart[0])
		ERR("Cannot init UART0");

	soc->uart[1] = socUartInit(soc->mem, soc->ic, soc->dma, 0xFFFC1000, deviceGetSocRev() ? LH795xx_I_UART1 : LH754xx_I_UART1_INTR, deviceGetSocRev() ? -1 : LH754XX_DMA_STRM_UART1TX, deviceGetSocRev() ? -1 : LH754XX_DMA_STRM_UART1RX);
	if (!soc->uart[1])
		ERR("Cannot init UART1");

	soc->uart[2] = socUartInit(soc->mem, soc->ic, soc->dma, 0xFFFC2000, LH7xxxx_I_UART2, -1, -1);
	if (!soc->uart[2])
		ERR("Cannot init UART");

	for (i = 0; i < sizeof(soc->uart) / sizeof(*soc->uart) && i < sizeof(sp.uarts) / sizeof(*sp.uarts); i++)
		sp.uarts[i] = soc->uart[i];

	
	if (cartRom) {

		audioDev = SDL_OpenAudioDevice(NULL, false, &desiredSpecMusic, &gotten, 0);
		if (!audioDev) {

			fprintf(stderr, "SDL audio (cart melody) error: %s\n", SDL_GetError());
			abort();
		}
		SDL_PauseAudioDevice(audioDev, false);
		
		if (melodyChipXLisXLromFile(cartRom)) {

			soc->cartMelodyChip = NULL;
			soc->cartMelodyChipXL = melodyChipXLinit(cartRom, audioDev);
		}
		else {

			soc->cartMelodyChip = melodyChipInit(cartRom, audioDev);
			soc->cartMelodyChipXL = NULL;
		}

		if (!soc->cartMelodyChip && !soc->cartMelodyChipXL) {

			fprintf(stderr, "Failed to instantiate cart's melody chip\n");
			abort();
		}
	}

	//The browser SDL audio backend supports one open device; share the cart's.
#ifdef __EMSCRIPTEN__
	if (!cartRom) {
#else
	{
#endif
		audioDev = SDL_OpenAudioDevice(NULL, false, &desiredSpecMusic, &gotten, 0);
		if (!audioDev) {

			fprintf(stderr, "SDL audio (console melody) error: %s\n", SDL_GetError());
			abort();
		}
		SDL_PauseAudioDevice(audioDev, false);
	}
	
	soc->consoleMelodyChip = melodyChipInit(consoleRom, audioDev);
	if (!soc->consoleMelodyChip) {

		fprintf(stderr, "Failed to instantiate colsole's melody chip\n");
		abort();
	}

	sp.mem = soc->mem;
	sp.ssp = soc->ssp;
	sp.i2s = soc->i2s;
	sp.gpio = soc->gpio;
	sp.soc = soc;
	sp.adc = (void*)soc->adc;
	sp.cartMelodyChip = (cartRom && cartRom->romType != PixterRomClassic) ? soc->cartMelodyChip : NULL;
	sp.consoleMelodyChip = soc->consoleMelodyChip;
	sp.cartMelodyChipXL = soc->cartMelodyChipXL;
	sp.consoleRom = consoleRom;
	sp.cartRom = cartRom;
	sp.eepromFile = eepromFile;
	sp.savegameFile = savegameFile;
	soc->dev = deviceSetup(&sp);
	if (!soc->dev)
		ERR("Cannot init device\n");

	if (cartRom && cartRom->romType == PixterRomClassic && sp.bbBexExternalBus) {
		
		//carts have melody chips
		pixterBbBexAttachMelodyChip(sp.bbBexExternalBus, soc->cartMelodyChip);
	
		//attach the game main rom
		if (!romInitWithPixterCartRom(pixterBbBexGetBbBus(sp.bbBexExternalBus), BB_BUS_EXTERNAL_CART_ROM_ADR, 1 << 20, cartRom, 0, RomWriteError)) {

			fprintf(stderr, "failed to add classic rom\n");
			abort();
		}

		//if this rom has a "special" region, we attach it as a separate rom
		if (cartRom->code[1] && cartRom->code[1]->length) {

			if (!romInitWithPixterCartRom(pixterBbBexGetBbBus(sp.bbBexExternalBus), BB_BUS_EXTERNAL_CART_ROM_ADR + BB_BUS_ADDEND_SPECIAL_REGION, 0x2000, cartRom, 1, RomWriteError)) {

				fprintf(stderr, "failed to add classic rom's special region\n");
				abort();
			}
		}

		//attach classic game's savegame NOR
		soc->classicCartSavegameNor = at29lv010aInit(pixterBbBexGetBbBus(sp.bbBexExternalBus), BB_BUS_EXTERNAL_CART_NOR_ADDR, 1 << 20, savegameFile);
	}

	//color games' i2c eeprom to file?

	return soc;
}

void socReportSpeeds(void *speedReportCbkData, uint32_t crystalHz, uint32_t pllHz, uint32_t hclkHz, uint32_t cpuHz)
{
	struct SoC *soc = (struct SoC*)speedReportCbkData;

	soc->crystalHz = crystalHz;
	soc->pllHz = pllHz;
	soc->hclkHz = hclkHz;
	soc->cpuHz = cpuHz;
}


static void prvTimeNormalize(struct timespec *ts)
{
	if (ts->tv_nsec >= 1000000000) {
		ts->tv_nsec -= 1000000000;
		ts->tv_sec++;
	}
}

static void prvTimeAddNsec(struct timespec *ts, uint64_t nsec)
{
	ts->tv_nsec += nsec;
	prvTimeNormalize(ts);
}

static bool prvTimeGe(const struct timespec *lhs, const struct timespec *rhs)
{
	if (lhs->tv_sec > rhs->tv_sec)
		return true;
	if (lhs->tv_sec < rhs->tv_sec)
		return false;
	return lhs->tv_nsec >= rhs->tv_nsec;
}

static bool prvTimeHasPassed(struct timespec *nextExpected, uint64_t nsTillNext, const struct timespec *nowTime)
{
	if (!prvTimeGe(nowTime, nextExpected))
		return false;

	prvTimeAddNsec(nextExpected, nsTillNext);
	return true;
}

static void socRunFrame(struct SoC* soc, uint32_t cycleBudget)
{
	uint32_t i, j, timerTicksPerTime = 32;
		
	while (cycleBudget--) {
		cpuCycle(soc->cpu);
		soc->cycles++;

		if (!(soc->cycles & 0x3FF)) {
			struct timespec nowTime;

			clock_gettime(CLOCK_MONOTONIC, &nowTime);

			socDmaPeriodic(soc->dma);
			devicePeriodic(soc->dev);

			while (prvTimeHasPassed(&soc->nextDispUpdate, 1e9 / 32768, &nowTime)) {
				lh7xxxxClcdPeriodic(soc->lcd);
				if (soc->classicCartSavegameNor)
					at29lv010aPeriodic(soc->classicCartSavegameNor);
			}

			while (prvTimeHasPassed(&soc->nextAdcTick, 1e9 / 40000, &nowTime))
				lh7xxxxAdcPeriodic(soc->adc);

			while (prvTimeHasPassed(&soc->nextUartTick, 1e9 / 20000, &nowTime)) {
				for (i = 0; i < sizeof(soc->uart) / sizeof(*soc->uart); i++)
					socUartProcess(soc->uart[i]);
				socSspPeriodic(soc->ssp);
				if (soc->i2s)
					socI2sPeriodic(soc->i2s);
			}

			while (prvTimeHasPassed(&soc->nextMelodyChipTick, MELODY_XL_PERIODIC_RATE_NSEC, &nowTime)) {
				if (soc->cartMelodyChipXL) {
					melodyChipXLperiodic(soc->cartMelodyChipXL);
					deviceReportMelodyChipActive(soc->dev, false, melodyChipXLisPlaying(soc->cartMelodyChipXL));
				}
				else if (soc->cartMelodyChip) {
					melodyChipPeriodic(soc->cartMelodyChip);
					deviceReportMelodyChipActive(soc->dev, false, melodyChipIsPlaying(soc->cartMelodyChip));
				}
				if (soc->consoleMelodyChip) {
					melodyChipPeriodic(soc->consoleMelodyChip);
					deviceReportMelodyChipActive(soc->dev, true, melodyChipIsPlaying(soc->consoleMelodyChip));
				}
			}

			while (prvTimeHasPassed(&soc->nextUiPollTick, 1e9 / 64, &nowTime)) {
				SDL_Event event;

				if (SDL_PollEvent(&event)) switch (event.type) {
					case SDL_QUIT:
						exit(0);
						break;

					case SDL_MOUSEBUTTONDOWN:
						if (event.button.button != SDL_BUTTON_LEFT)
							break;
						soc->mouseDown = true;
						deviceTouch(soc->dev, event.button.x, event.button.y);
						break;

					case SDL_MOUSEBUTTONUP:
						if (event.button.button != SDL_BUTTON_LEFT)
							break;
						soc->mouseDown = false;
						deviceTouch(soc->dev, -1, -1);
						break;

					case SDL_MOUSEMOTION:
						if (!soc->mouseDown)
							break;
						deviceTouch(soc->dev, event.motion.x, event.motion.y);
						break;

					case SDL_KEYDOWN:
						deviceKey(soc->dev, event.key.keysym.sym, true);
						break;

					case SDL_KEYUP:
						deviceKey(soc->dev, event.key.keysym.sym, false);
						break;
				}
			}

			if (prvTimeHasPassed(&soc->nextTimersTick, 1e9 * 2 * timerTicksPerTime / soc->hclkHz, &nowTime)) {

				for (j = 0; j < timerTicksPerTime; j++) {
					for (i = 0; i < sizeof(soc->tmr) / sizeof(*soc->tmr); i++)
						lh7xxxxTimerPeriodic(soc->tmr[i]);
				}
			}
		}
	}
}

#ifdef __EMSCRIPTEN__
static void socRunBrowserFrame(void)
{
	uint32_t cyclesPerFrame;

	if (!g_soc)
		return;

	cyclesPerFrame = g_soc->cpuHz / 60;
	if (!cyclesPerFrame)
		cyclesPerFrame = 250000;
	socRunFrame(g_soc, cyclesPerFrame);
}
#endif

static void socRun(struct SoC* soc)
{
	clock_gettime(CLOCK_MONOTONIC, &soc->nextDispUpdate);
	soc->nextAdcTick = soc->nextDispUpdate;
	soc->nextUartTick = soc->nextDispUpdate;
	soc->nextMelodyChipTick = soc->nextDispUpdate;
	soc->nextUiPollTick = soc->nextDispUpdate;
	soc->nextTimersTick = soc->nextDispUpdate;

#ifdef __EMSCRIPTEN__
	g_soc = soc;
	emscripten_set_main_loop(socRunBrowserFrame, 0, 0);
#else
	while (1) {
		socRunFrame(soc, UINT32_MAX);
	}
#endif
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE void uarmpixterTouch(int x, int y, int down)
{
	if (g_soc)
		deviceTouch(g_soc->dev, down ? x : -1, down ? y : -1);
}

EMSCRIPTEN_KEEPALIVE void uarmpixterInput(int control, int down)
{
	if (g_soc && control == 0)
		deviceKey(g_soc->dev, SDLK_RETURN, down != 0);
}

EMSCRIPTEN_KEEPALIVE void uarmpixterStop(void)
{
	if (!g_soc)
		return;

	emscripten_cancel_main_loop();
	if (g_soc->eepromFile) {
		fflush(g_soc->eepromFile);
		fclose(g_soc->eepromFile);
	}
	if (g_soc->savegameFile) {
		fflush(g_soc->savegameFile);
		fclose(g_soc->savegameFile);
	}
	SDL_Quit();
	g_soc = NULL;
}
#endif

static void usage(const char *self)
{
	fprintf(stderr, "USAGE: %s ConsoleROM.pci eeprom.bin [[CartROM.pci] cartSavegame.bin]\n", self);
	exit(-1);
}

static int startEmulator(const char *consolePath, const char *eepromPath, const char *cartPath, const char *savegamePath)
{
	struct PixterRomFile *cartRom = NULL, *consoleRom;
	FILE *f, *eepromFile, *savegameFile = NULL;
	int gdbPort = -1;
	struct SoC *soc;

	if (!consolePath || !consolePath[0] || !eepromPath || !eepromPath[0]) {
		fprintf(stderr, "Console ROM and EEPROM paths are required\n");
		return 1;
	}

	f = fopen(consolePath, "rb");
	if (!f || !(consoleRom = romRead(f)) || !consoleRom->code[0] || !consoleRom->code[0]->length) {
		fprintf(stderr, "Failed to process Console ROM '%s'\n", consolePath);
		if (f)
			fclose(f);
		return 1;
	}
	fclose(f);

	eepromFile = fopen(eepromPath, "r+b");
	if (!eepromFile)
		eepromFile = fopen(eepromPath, "wb");
	if (!eepromFile) {
		fprintf(stderr, "Failed open eeprom file '%s'\n", eepromPath);
		return 1;
	}

	if (cartPath && cartPath[0]) {
	
		f = fopen(cartPath, "rb");
		if (!f || !(cartRom = romRead(f))){
			fprintf(stderr, "Failed to process CART ROM '%s'\n", cartPath);
			if (f)
				fclose(f);
			fclose(eepromFile);
			return 1;
		}
		fclose(f);

		if (savegamePath && savegamePath[0]) {

			savegameFile = fopen(savegamePath, "r+b");
			if (!savegameFile)
				savegameFile = fopen(savegamePath, "wb");
			if (!savegameFile) {
				fprintf(stderr, "Failed open savegame file '%s'\n", savegamePath);
				fclose(eepromFile);
				return 1;
			}
		}

		switch (cartRom->romType) {
			case PixterRomClassic:
				fprintf(stderr, "Pixter Classic Cart detected (via adapter)\n");
				break;

			case PixterRomColor:
				fprintf(stderr, "Pixter Color Cart detected\n");
				break;

			case PixterRomMultimedia:
				fprintf(stderr, "Pixter Multimedia Cart detected\n");
				break;

			default:
				fprintf(stderr, "Cart type unknown\n");
				fclose(eepromFile);
				if (savegameFile)
					fclose(savegameFile);
				return -1;
		}
	}

	if (SDL_Init(SDL_INIT_AUDIO | SDL_INIT_VIDEO | SDL_INIT_EVENTS)) {
		fprintf(stderr, "SDL initialization failed: %s\n", SDL_GetError());
		fclose(eepromFile);
		if (savegameFile)
			fclose(savegameFile);
		return 1;
	}
	
	soc = socInit(consoleRom, cartRom, eepromFile, savegameFile, gdbPort);
	soc->eepromFile = eepromFile;
	soc->savegameFile = savegameFile;
	socRun(soc);

	return 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE int uarmpixterStart(const char *consolePath, const char *eepromPath, const char *cartPath, const char *savegamePath)
{
	return startEmulator(consolePath, eepromPath, cartPath, savegamePath);
}
#endif

int main(int argc, char** argv)
{
	if (argc < 3)
		usage(argv[0]);

	return startEmulator(argv[1], argv[2], argc >= 4 ? argv[3] : NULL, argc >= 5 ? argv[4] : NULL);
}

