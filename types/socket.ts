export interface TimelineEvent {
  flag: number;
  position: number; // 0–1
}

export interface ReplayTimeline {
  events: TimelineEvent[];
  firstTimestamp: number;
  realSpanMs: number;
  totalDurationMs: number;
}
