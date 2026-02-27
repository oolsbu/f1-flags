export type TimelineEvent = {
  flag: number;
  position: number; // 0–1
};

export type ReplayTimeline = {
  events: TimelineEvent[];
  firstTimestamp: number; // epoch ms of first flag
  realSpanMs: number; // real wall-clock span between first and last flag
  totalDurationMs: number; // replay playback duration (compressed or realtime)
};

export type ReplayStatus = {
  running: boolean;
  mode?: "live" | "replay";
  replayPlaying?: boolean;
};

export interface clientToServerEvents {
  response: (data: number) => void;
  status: (data?: number) => void;
  "poller:start": (data?: {
    mode?: "live" | "replay";
    sessionKey?: string;
    pollIntervalMs?: number;
    liveDelayMs?: number;
    replayDurationMs?: number;
  }) => void;
  "poller:stop": () => void;
  "poller:pause": () => void;
  "poller:play": () => void;
  "poller:seek": (position: number) => void;
}

export interface serverToClientEvents {
  flag: (data: number) => void;
  "poller:status": (data: ReplayStatus) => void;
  "replay:timeline": (data: ReplayTimeline) => void;
  "replay:progress": (position: number) => void;
}
