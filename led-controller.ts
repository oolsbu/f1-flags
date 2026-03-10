import { createRequire } from "node:module";

const NUM_LEDS = 19;

const require = createRequire(import.meta.url);

const FLAG_COLORS: Record<number, number> = {
  0: 0x000000, // off
  1: 0x00c853, // green
  2: 0xffea00, // yellow
  3: 0xff1744, // red
  4: 0xff9100, // safety car (orange)
  5: 0xe040fb, // VSC (purple)
};

let render: (() => void) | null = null;
let reset: (() => void) | null = null;
let pixelData: Uint32Array = new Uint32Array(NUM_LEDS);

export const initLeds = () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : "n/a";
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
    console.warn(`[LED] Init error (uid=${uid}): ${message}`);
  }
};

export const setFlag = (flag: number) => {
  const color = FLAG_COLORS[flag] ?? 0x000000;
  for (let i = 0; i < NUM_LEDS; i++) {
    pixelData[i] = color;
  }
  render?.();
  console.log(`[LED] Flag ${flag} → 0x${color.toString(16).padStart(6, "0")}`);
};

export const resetLeds = () => {
  pixelData.fill(0);
  render?.();
  reset?.();
  console.log("[LED] Reset");
};
