const NUM_LEDS = 19;

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
  try {
    // Dynamic require — only succeeds on Raspberry Pi with native bindings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws281x = require("rpi-ws281x-native");
    const channel = ws281x(NUM_LEDS, { gpio: 18, brightness: 128 });
    pixelData = channel.array;
    render = () => ws281x.render();
    reset = () => ws281x.reset();
    console.log(`[LED] Initialized ${NUM_LEDS} LEDs on GPIO 18`);
  } catch {
    console.warn(
      "[LED] rpi-ws281x-native unavailable — running in simulation mode",
    );
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
