const express = require("express");
const http = require("http");
const { randomUUID } = require("crypto");
const { WebSocketServer } = require("ws");

const app = express();
const port = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

// Read TURN settings from environment variables.
// This is easier to deploy safely than hardcoding credentials into HTML files.
const turnUrls = process.env.TURN_URLS
  ? process.env.TURN_URLS.split(",").map((url) => url.trim()).filter(Boolean)
  : [];
const turnUsername = process.env.TURN_USERNAME || "";
const turnCredential = process.env.TURN_CREDENTIAL || "";

// Serve the browser client from the "public" folder.
app.use(express.static("public"));

// This endpoint creates a tiny JavaScript config object for the browser.
// Important note: anything sent to the browser can still be seen by users in
// DevTools, so this protects credentials from your git repo, not from the
// browser itself.
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(
    `window.APP_CONFIG = ${JSON.stringify({
      turn: {
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential
      }
    }, null, 2)};`
  );
});

// Simple health endpoint that hosting platforms can check.
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

function sendJson(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }

  return rooms.get(roomId);
}

function leaveRoom(socket) {
  const { roomId } = socket;

  if (!roomId || !rooms.has(roomId)) {
    return;
  }

  const room = rooms.get(roomId);
  room.delete(socket);

  for (const peer of room) {
    sendJson(peer, {
      type: "peer-left",
      peerId: socket.peerId
    });
  }

  if (room.size === 0) {
    rooms.delete(roomId);
  }
}

function relayToPeers(socket, message) {
  if (!socket.roomId || !rooms.has(socket.roomId)) {
    sendJson(socket, {
      type: "error",
      message: "Join a room before sending signaling messages."
    });
    return;
  }

  const room = rooms.get(socket.roomId);

  for (const peer of room) {
    if (peer !== socket) {
      sendJson(peer, {
        ...message,
        peerId: socket.peerId
      });
    }
  }
}

wss.on("connection", (socket) => {
  socket.peerId = randomUUID();

  sendJson(socket, {
    type: "welcome",
    peerId: socket.peerId
  });

  socket.on("message", (rawMessage) => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      sendJson(socket, {
        type: "error",
        message: "Invalid JSON message."
      });
      return;
    }

    if (message.type === "join") {
      if (!message.roomId) {
        sendJson(socket, {
          type: "error",
          message: "A roomId is required to join."
        });
        return;
      }

      leaveRoom(socket);
      socket.roomId = message.roomId;
      const room = getRoom(message.roomId);

      // This demo is intentionally 1-to-1, so we keep each room limited to
      // two browser clients.
      if (room.size >= 2) {
        socket.roomId = undefined;
        sendJson(socket, {
          type: "error",
          message: "This room already has two people."
        });
        return;
      }

      room.add(socket);

      const peers = [...room]
        .filter((peer) => peer !== socket)
        .map((peer) => peer.peerId);

      sendJson(socket, {
        type: "joined",
        roomId: message.roomId,
        peerId: socket.peerId,
        peers
      });

      for (const peer of room) {
        if (peer !== socket) {
          sendJson(peer, {
            type: "peer-joined",
            peerId: socket.peerId
          });
        }
      }

      return;
    }

    if (message.type === "leave") {
      leaveRoom(socket);
      socket.roomId = undefined;
      sendJson(socket, {
        type: "left"
      });
      return;
    }

    if (["offer", "answer", "ice-candidate"].includes(message.type)) {
      relayToPeers(socket, message);
      return;
    }

    sendJson(socket, {
      type: "error",
      message: `Unsupported message type: ${message.type}`
    });
  });

  socket.on("close", () => {
    leaveRoom(socket);
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
