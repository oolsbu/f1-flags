import {
  broadcastFlag,
  broadcastProgress,
  broadcastTimeline,
} from "./socket.ts";
import { setFlag as setLedFlag } from "./led-controller.ts";
import { startSignalR, stopSignalR } from "./signalr-client.ts";
import type { RaceControl } from "./types/race_control.ts";
import type { ReplayTimeline } from "./types/socket.ts";

const API = "https://api.openf1.org/v1/race_control";

type Mode = "live" | "replay";

let mode: Mode | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let lastFlag: number | null = null;

// Replay state
let replayEvents: { flag: number; delayMs: number }[] = [];
let replayTotalMs = 0;
let replayFirstTimestamp = 0;
let replayRealSpanMs = 0;
let replayIndex = 0;
let replayStartMs = 0;
let replayElapsedMs = 0;
let replayPlaying = false;

const emitIfChanged = (flag: number) => {
  if (flag !== lastFlag) {
    lastFlag = flag;
    broadcastFlag(flag);
    setLedFlag(flag);
  }
};

const clear = () => {
  if (timerId) clearInterval(timerId);
  timerId = null;
  stopSignalR();
  mode = null;
  lastFlag = null;
  replayEvents = [];
  replayIndex = 0;
  replayPlaying = false;
  replayTotalMs = 0;
  replayFirstTimestamp = 0;
  replayRealSpanMs = 0;
  setLedFlag(0);
};

const tickReplay = () => {
  if (!replayPlaying) return;
  const elapsed = Date.now() - replayStartMs;

  while (
    replayIndex < replayEvents.length &&
    replayEvents[replayIndex].delayMs <= elapsed
  ) {
    emitIfChanged(replayEvents[replayIndex].flag);
    replayIndex++;
  }

  // Broadcast progress (0–1)
  if (replayTotalMs > 0) {
    broadcastProgress(Math.min(1, elapsed / replayTotalMs));
  }

  if (replayIndex >= replayEvents.length) {
    if (timerId) clearInterval(timerId);
    timerId = null;
    replayPlaying = false;
    mode = null;
    broadcastProgress(1);
  }
};

/* ── Live mode: SignalR WebSocket with broadcast delay buffer ── */

const startLive = (liveDelayMs: number) => {
  mode = "live";
  startSignalR({
    delayMs: liveDelayMs,
    onFlag: (flag) => emitIfChanged(flag),
  });
};

/* ── Replay mode: OpenF1 API with time-scaled playback ── */

const startReplay = async (sessionKey: string, durationMs?: number) => {
  mode = "replay";

  try {
    const res = await fetch(
      `${API}?session_key=${encodeURIComponent(sessionKey)}`,
    );
    if (!res.ok) return;

    const items = (await res.json()) as RaceControl[];
    const flags = items
      .filter((i): i is RaceControl & { flag: number } => i.flag !== null)
      .map((i) => ({ flag: i.flag, ts: Date.parse(i.date) }))
      .sort((a, b) => a.ts - b.ts);

    if (!flags.length) return;

    const span = flags[flags.length - 1].ts - flags[0].ts || 1;
    const target = durationMs && durationMs > 0 ? durationMs : span;
    replayTotalMs = target;
    replayFirstTimestamp = flags[0].ts;
    replayRealSpanMs = span;

    replayEvents = flags.map((e) => ({
      flag: e.flag,
      delayMs: ((e.ts - flags[0].ts) / span) * target,
    }));

    const timeline: ReplayTimeline = {
      events: replayEvents.map((e) => ({
        flag: e.flag,
        position: replayTotalMs > 0 ? e.delayMs / replayTotalMs : 0,
      })),
      firstTimestamp: replayFirstTimestamp,
      realSpanMs: replayRealSpanMs,
      totalDurationMs: replayTotalMs,
    };
    broadcastTimeline(timeline);

    replayIndex = 0;
    replayStartMs = Date.now();
    replayElapsedMs = 0;
    replayPlaying = true;

    tickReplay();
    timerId = setInterval(tickReplay, 100);
  } catch (err) {
    console.error("Replay fetch failed:", err);
  }
};

export const startHttpPoller = ({
  mode: m,
  sessionKey,
  liveDelayMs = 30000,
  replayDurationMs,
}: {
  mode: Mode;
  sessionKey?: string;
  liveDelayMs?: number;
  replayDurationMs?: number;
}) => {
  clear();
  if (m === "replay" && sessionKey) {
    startReplay(sessionKey, replayDurationMs);
  } else {
    startLive(liveDelayMs);
  }
};

export const stopHttpPoller = clear;

export const pauseReplayPoller = () => {
  if (!replayPlaying) return;
  replayElapsedMs = Date.now() - replayStartMs;
  replayPlaying = false;
};

export const playReplayPoller = () => {
  if (replayPlaying || !replayEvents.length) return;
  replayStartMs = Date.now() - replayElapsedMs;
  replayPlaying = true;
  mode = "replay";
  if (!timerId) timerId = setInterval(tickReplay, 100);
};

export const seekReplayPoller = (position: number) => {
  if (!replayEvents.length || replayTotalMs <= 0) return;

  const targetMs = Math.max(0, Math.min(1, position)) * replayTotalMs;
  replayElapsedMs = targetMs;
  replayStartMs = Date.now() - targetMs;

  // Find the right index
  replayIndex = 0;
  lastFlag = null;
  for (let i = 0; i < replayEvents.length; i++) {
    if (replayEvents[i].delayMs <= targetMs) {
      replayIndex = i + 1;
      lastFlag = replayEvents[i].flag;
    } else break;
  }

  if (lastFlag !== null) {
    broadcastFlag(lastFlag);
    setLedFlag(lastFlag);
  }
  broadcastProgress(position);
};

// If was playing, keep ticking
if (replayPlaying) {
  tickReplay();
}

export const getHttpPollerStatus = () => ({
  running: mode !== null,
  mode: mode ?? undefined,
  replayPlaying: mode === "replay" ? replayPlaying : undefined,
});
