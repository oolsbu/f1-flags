import type { Server } from "socket.io";
import type {
  clientToServerEvents,
  serverToClientEvents,
  ReplayTimeline,
} from "./types/socket.ts";
import {
  getHttpPollerStatus,
  pauseReplayPoller,
  playReplayPoller,
  seekReplayPoller,
  startHttpPoller,
  stopHttpPoller,
} from "./http-poller.ts";

type TypedServer = Server<clientToServerEvents, serverToClientEvents>;

let ioInstance: TypedServer | null = null;

export const setSocketServer = (io: TypedServer): void => {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log(` connected: ${socket.id}`);

    socket.on("status", () => {
      socket.emit("poller:status", getHttpPollerStatus());
    });

    socket.on("poller:start", (data) => {
      startHttpPoller({
        mode: data?.mode ?? "live",
        sessionKey: data?.sessionKey,
        pollIntervalMs: data?.pollIntervalMs,
        liveDelayMs: data?.liveDelayMs,
        replayDurationMs: data?.replayDurationMs,
      });

      io.emit("poller:status", getHttpPollerStatus());
    });

    socket.on("poller:stop", () => {
      stopHttpPoller();
      io.emit("poller:status", getHttpPollerStatus());
    });

    socket.on("poller:pause", () => {
      pauseReplayPoller();
      io.emit("poller:status", getHttpPollerStatus());
    });

    socket.on("poller:play", () => {
      playReplayPoller();
      io.emit("poller:status", getHttpPollerStatus());
    });

    socket.on("poller:seek", (position) => {
      seekReplayPoller(position);
      io.emit("poller:status", getHttpPollerStatus());
    });
  });
};

export const broadcastFlag = (flag: number): void => {
  if (!ioInstance) return;
  ioInstance.emit("flag", flag);
};

export const broadcastTimeline = (data: ReplayTimeline): void => {
  if (!ioInstance) return;
  ioInstance.emit("replay:timeline", data);
};

export const broadcastProgress = (position: number): void => {
  if (!ioInstance) return;
  ioInstance.emit("replay:progress", position);
};
