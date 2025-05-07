import { Server } from "node:http";
import { WebSocketServer } from "ws";

const wsServer = new WebSocketServer({ noServer: true });

export function setupWebSocketServer(httpServer: Server) {
  httpServer.on("upgrade", (req, socket, head) => {
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws, req);
    });
  });
}
