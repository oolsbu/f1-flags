import { createRequire } from "node:module";

export const NUM_LEDS = 19;

const require = createRequire(import.meta.url);

export const FLAG_COLORS: Record<number, number> = {
  0: 0x000000, // off
  1: 0x00c853, // green
  2: 0xffea00, // yellow
  3: 0xff1744, // red
  4: 0xff9100, // safety car (orange)
  5: 0xe040fb, // VSC (purple)
};

const FLAG_NAME_TO_NUMBER: Record<string, number> = {
  CLEAR: 1,
  GREEN: 1,
  YELLOW: 2,
  "DOUBLE YELLOW": 2,
  RED: 3,
  "SAFETY CAR": 4,
  SC: 4,
  VSC: 5,
  "VIRTUAL SAFETY CAR": 5,
};

let render: (() => void) | null = null;
let reset: (() => void) | null = null;
let pixelData: Uint32Array = new Uint32Array(NUM_LEDS);

export const initLeds = () => {
  // const uid = typeof process.getuid === "function" ? process.getuid() : "n/a";
  const errors: string[] = [];

  try {
    // Preferred maintained driver path.
    const ws281x = require("rpi-ws281x");
    ws281x.configure({ leds: NUM_LEDS, gpio: 18, brightness: 128 });
    pixelData = new Uint32Array(NUM_LEDS);
    render = () => ws281x.render(pixelData);
    reset = () => ws281x.reset();
    console.log(`[LED] Initialized ${NUM_LEDS} LEDs on GPIO 18 via rpi-ws281x`);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`rpi-ws281x: ${message}`);
  }

  try {
    // Legacy fallback path.
    const ws281x = require("rpi-ws281x-native");
    const channel = ws281x(NUM_LEDS, { gpio: 18, brightness: 128 });
    pixelData = channel.array;
    render = () => ws281x.render();
    reset = () => ws281x.reset();
    console.log(
      `[LED] Initialized ${NUM_LEDS} LEDs on GPIO 18 via rpi-ws281x-native`,
    );
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`rpi-ws281x-native: ${message}`);
  }

  console.warn(
    "[LED] No hardware LED driver available — running in simulation mode",
  );
  for (const message of errors) {
    // console.warn(`[LED] Init error (uid=${uid}): ${message}`);
  }
};

/* ── Low-level helpers used by led-animation.ts ── */

/** Set a single LED by index (does NOT render – call renderLeds() after). */
export const setPixel = (index: number, color: number) => {
  if (index >= 0 && index < NUM_LEDS) pixelData[index] = color;
};

/** Push the current pixelData to the hardware. */
export const renderLeds = () => {
  render?.();
};

/** Fill every LED with the same colour and render. */
export const fillAll = (color: number) => {
  pixelData.fill(color);
  render?.();
};

/* ── High-level flag API ── */

const normalizeFlag = (flag: number | string): number => {
  if (typeof flag === "number" && Number.isFinite(flag)) return flag;
  const normalized = String(flag).trim().toUpperCase();
  return FLAG_NAME_TO_NUMBER[normalized] ?? 0;
};

export const setFlag = (flag: number | string) => {
  const normalizedFlag = normalizeFlag(flag);
  const color = FLAG_COLORS[normalizedFlag] ?? 0x000000;
  for (let i = 0; i < NUM_LEDS; i++) {
    pixelData[i] = color;
  }
  render?.();
  console.log(
    `[LED] Flag ${String(flag)} (code ${normalizedFlag}) → 0x${color
      .toString(16)
      .padStart(6, "0")}`,
  );
};

export const resetLeds = () => {
  pixelData.fill(0);
  render?.();
  reset?.();
  console.log("[LED] Reset");
};
