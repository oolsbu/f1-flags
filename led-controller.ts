import { createRequire } from "node:module";

const NUM_LEDS = 19;
const TICK_MS = 120;
const BLINK_TICKS = 4; // blink toggles every 4 ticks (~480 ms)

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SegmentMode = "off" | "static" | "flowing" | "blink";

export interface SegmentConfig {
  color: number;
  mode: SegmentMode;
  /** Segments sharing the same blinkGroup blink in sync; different groups alternate. */
  blinkGroup?: number;
}

export interface FlagConfig {
  /** "per_segment" — each segment has its own config.
   *  "blink_sequential" — segments light one at a time in order. */
  type: "per_segment" | "blink_sequential";
  /** Colour used by blink_sequential mode. */
  color?: number;
  /** Per-segment configs [seg0, seg1, seg2] for per_segment mode. */
  segments?: [SegmentConfig, SegmentConfig, SegmentConfig];
  /** Auto-revert to another flag after this many ms. */
  durationMs?: number;
  /** Flag code to revert to when durationMs expires. */
  revertToFlag?: number;
}

// ---------------------------------------------------------------------------
// Segment definitions
// ---------------------------------------------------------------------------
// Seg 0: LEDs 1-5 (forward) ↔ 16-19 (backward / mirrored)
// Seg 1: LEDs 6-8 (standalone, no mirror)
// Seg 2: LEDs 9-11 (forward) ↔ 12-15 (backward / mirrored)

interface Segment {
  forward: number[];
  backward: number[];
}

const SEGMENTS: Segment[] = [
  { forward: [0, 1, 2, 3, 4], backward: [18, 17, 16, 15] },
  { forward: [5, 6, 7], backward: [] },
  { forward: [8, 9, 10], backward: [14, 13, 12, 11] },
];

// ---------------------------------------------------------------------------
// Flag lookup
// ---------------------------------------------------------------------------

const IGNORED_FLAG = -1;

const FLAG_NAME_TO_NUMBER: Record<string, number> = {
  CLEAR: 0,
  GREEN: 1,
  YELLOW: 2,
  "DOUBLE YELLOW": 2,
  RED: 3,
  "SAFETY CAR": 4,
  SC: 4,
  VSC: 5,
  "VIRTUAL SAFETY CAR": 5,
  BLUE: IGNORED_FLAG,
};

// ---------------------------------------------------------------------------
// Flag → animation config
// ---------------------------------------------------------------------------

export const FLAG_CONFIGS: Record<number, FlagConfig> = {
  // CLEAR / idle — red flowing trails on mirrored segments, white static on center
  0: {
    type: "per_segment",
    segments: [
      { color: 0xff1744, mode: "flowing" },
      { color: 0xffffff, mode: "static" },
      { color: 0xff1744, mode: "flowing" },
    ],
  },
  // GREEN — flowing green for 10 s then revert to CLEAR
  1: {
    type: "per_segment",
    segments: [
      { color: 0x00c853, mode: "flowing" },
      { color: 0x00c853, mode: "flowing" },
      { color: 0x00c853, mode: "flowing" },
    ],
    durationMs: 10_000,
    revertToFlag: 0,
  },
  // YELLOW — flowing
  2: {
    type: "per_segment",
    segments: [
      { color: 0xffea00, mode: "flowing" },
      { color: 0xffea00, mode: "flowing" },
      { color: 0xffea00, mode: "flowing" },
    ],
  },
  // RED — full blink
  3: {
    type: "per_segment",
    segments: [
      { color: 0xff1744, mode: "blink", blinkGroup: 0 },
      { color: 0xff1744, mode: "blink", blinkGroup: 0 },
      { color: 0xff1744, mode: "blink", blinkGroup: 0 },
    ],
  },
  // SAFETY CAR — mirrored segments blink together, standalone blinks on the opposite phase
  4: {
    type: "per_segment",
    segments: [
      { color: 0xff9100, mode: "blink", blinkGroup: 0 },
      { color: 0xff9100, mode: "blink", blinkGroup: 1 },
      { color: 0xff9100, mode: "blink", blinkGroup: 0 },
    ],
  },
  // VSC — each segment blinks one at a time in order
  5: { type: "blink_sequential", color: 0xe040fb },
};

/** Update the animation config for a flag at runtime. */
export const updateFlagConfig = (flagCode: number, config: FlagConfig) => {
  FLAG_CONFIGS[flagCode] = config;
};

// ---------------------------------------------------------------------------
// Hardware init
// ---------------------------------------------------------------------------

let render: (() => void) | null = null;
let reset: (() => void) | null = null;
let pixelData: Uint32Array = new Uint32Array(NUM_LEDS);

export const initLeds = () => {
  const uid = typeof process.getuid === "function" ? process.getuid() : "n/a";
  const errors: string[] = [];

  try {
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

// ---------------------------------------------------------------------------
// Animation engine
// ---------------------------------------------------------------------------

let animationTimer: ReturnType<typeof setInterval> | null = null;
let revertTimer: ReturnType<typeof setTimeout> | null = null;
let animationStep = 0;

const stopAnimation = () => {
  if (animationTimer !== null) {
    clearInterval(animationTimer);
    animationTimer = null;
  }
  if (revertTimer !== null) {
    clearTimeout(revertTimer);
    revertTimer = null;
  }
  animationStep = 0;
};

/** Dim an RGB colour by a 0-1 factor. */
const dimColor = (color: number, factor: number): number => {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
};

// ---- per_segment ----------------------------------------------------------

const animatePerSegment = (
  segConfigs: [SegmentConfig, SegmentConfig, SegmentConfig],
) => {
  let blinkOn = true;

  const tick = () => {
    if (animationStep > 0 && animationStep % BLINK_TICKS === 0) {
      blinkOn = !blinkOn;
    }

    for (let i = 0; i < SEGMENTS.length; i++) {
      const cfg = segConfigs[i];
      const seg = SEGMENTS[i];
      const allLeds = [...seg.forward, ...seg.backward];

      switch (cfg.mode) {
        case "static":
          for (const led of allLeds) pixelData[led] = cfg.color;
          break;

        case "off":
          for (const led of allLeds) pixelData[led] = 0x000000;
          break;

        case "flowing": {
          const trail = dimColor(cfg.color, 0.25);
          for (const arr of [seg.forward, seg.backward]) {
            if (arr.length === 0) continue;
            for (const led of arr) pixelData[led] = 0x000000;
            const idx = animationStep % arr.length;
            const prevIdx = (animationStep - 1 + arr.length) % arr.length;
            pixelData[arr[idx]] = cfg.color;
            pixelData[arr[prevIdx]] = trail;
          }
          break;
        }

        case "blink": {
          const group = cfg.blinkGroup ?? 0;
          const isOn = group === 0 ? blinkOn : !blinkOn;
          for (const led of allLeds) {
            pixelData[led] = isOn ? cfg.color : 0x000000;
          }
          break;
        }
      }
    }

    render?.();
    animationStep++;
  };

  tick();
  animationTimer = setInterval(tick, TICK_MS);
};

// ---- blink_sequential -----------------------------------------------------

const animateBlinkSequential = (color: number) => {
  const tick = () => {
    pixelData.fill(0x000000);
    const segIdx = animationStep % SEGMENTS.length;
    const seg = SEGMENTS[segIdx];
    for (const led of [...seg.forward, ...seg.backward]) {
      pixelData[led] = color;
    }
    render?.();
    animationStep++;
  };

  tick();
  animationTimer = setInterval(tick, 400);
};

// ---------------------------------------------------------------------------
// Start a flag config
// ---------------------------------------------------------------------------

const startConfig = (config: FlagConfig) => {
  stopAnimation();

  switch (config.type) {
    case "per_segment":
      if (config.segments) animatePerSegment(config.segments);
      break;
    case "blink_sequential":
      animateBlinkSequential(config.color ?? 0xffffff);
      break;
  }

  if (config.durationMs != null && config.revertToFlag != null) {
    const revertFlag = config.revertToFlag;
    revertTimer = setTimeout(() => {
      revertTimer = null;
      setFlag(revertFlag);
    }, config.durationMs);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const normalizeFlag = (flag: number | string): number => {
  if (typeof flag === "number" && Number.isFinite(flag)) return flag;
  const normalized = String(flag).trim().toUpperCase();
  return FLAG_NAME_TO_NUMBER[normalized] ?? 0;
};

export const setFlag = (flag: number | string) => {
  const normalizedFlag = normalizeFlag(flag);

  if (normalizedFlag === IGNORED_FLAG) {
    console.log(`[LED] Flag ${String(flag)} → ignored`);
    return;
  }

  const config: FlagConfig = FLAG_CONFIGS[normalizedFlag] ?? {
    type: "per_segment" as const,
    segments: [
      { color: 0x000000, mode: "static" as const },
      { color: 0x000000, mode: "static" as const },
      { color: 0x000000, mode: "static" as const },
    ],
  };

  startConfig(config);
  console.log(
    `[LED] Flag ${String(flag)} (code ${normalizedFlag}) → type=${config.type}`,
  );
};

export const resetLeds = () => {
  stopAnimation();
  pixelData.fill(0);
  render?.();
  reset?.();
  console.log("[LED] Reset");
};
