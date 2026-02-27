import { createServer, IncomingMessage, ServerResponse } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { broadcastFlag, setSocketServer } from "./socket.ts";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  console.log("Starting server...");

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    return handle(req, res);
  });

  const io = new SocketIOServer(server);
  setSocketServer(io);

  server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
  });
});
