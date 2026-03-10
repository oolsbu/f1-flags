import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { Server } from "socket.io";
import { setIO } from "./socket.ts";
import { initLeds, resetLeds } from "./led-controller.ts";
import {
  startHttpPoller,
  stopHttpPoller,
  pauseReplayPoller,
  playReplayPoller,
  seekReplayPoller,
} from "./http-poller.ts";
import { setLiveDelay } from "./signalr-client.ts";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const srv = createServer((req, res) => {
    handle(req, res, parse(req.url!, true));
  });

  const io = new Server(srv);
  setIO(io);
  initLeds();

  io.on("connection", (socket) => {
    console.log("[IO] Client connected");

    socket.on("poller:start", (opts) => {
      startHttpPoller(opts);
      io.emit("poller:status", {
        running: true,
        replayPlaying: opts.mode === "replay",
      });
    });

    socket.on("poller:stop", () => {
      stopHttpPoller();
      io.emit("poller:status", { running: false, replayPlaying: false });
    });

    socket.on("poller:pause", () => {
      pauseReplayPoller();
      io.emit("poller:status", { running: true, replayPlaying: false });
    });

    socket.on("poller:play", () => {
      playReplayPoller();
      io.emit("poller:status", { running: true, replayPlaying: true });
    });

    socket.on("poller:seek", (pos: number) => {
      seekReplayPoller(pos);
    });

    socket.on("live:setDelay", (ms: number) => {
      if (typeof ms === "number" && ms >= 0) {
        setLiveDelay(ms);
        console.log(`[IO] Broadcast delay set to ${ms}ms`);
      }
    });

    socket.on("status", () => {
      /* reserved for future status queries */
    });

    socket.on("disconnect", () => {
      console.log("[IO] Client disconnected");
    });
  });

  const port = Number(process.env.PORT ?? 3000);
  srv.listen(port, () => {
    console.log(`> F1 Flags ready on http://localhost:${port}`);
  });

  const cleanup = () => {
    stopHttpPoller();
    resetLeds();
    process.exit();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
});
