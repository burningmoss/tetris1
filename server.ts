import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;
  const LEADERBOARD_FILE = path.join(process.cwd(), "leaderboard.json");

  // Leaderboard state (persisted to file)
  let leaderboard: { name: string; score: number }[] = [];
  
  try {
    const fs = await import("fs/promises");
    const data = await fs.readFile(LEADERBOARD_FILE, "utf-8");
    leaderboard = JSON.parse(data);
  } catch (e) {
    console.log("No existing leaderboard found, starting fresh.");
  }

  const saveLeaderboard = async () => {
    try {
      const fs = await import("fs/promises");
      await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(leaderboard, null, 2));
    } catch (e) {
      console.error("Failed to save leaderboard:", e);
    }
  };

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join_game", ({ nickname }) => {
      socket.data.nickname = nickname;
      socket.emit("leaderboard_update", leaderboard);
    });

    socket.on("submit_score", async ({ name, score }) => {
      leaderboard.push({ name, score });
      leaderboard.sort((a, b) => b.score - a.score);
      leaderboard = leaderboard.slice(0, 10); // Top 10
      io.emit("leaderboard_update", leaderboard);
      await saveLeaderboard();
    });

    // Multiplayer PK logic
    socket.on("find_match", () => {
      const rooms = io.sockets.adapter.rooms;
      let joined = false;

      for (const [roomName, room] of rooms) {
        if (roomName.startsWith("pk_") && room.size === 1) {
          socket.join(roomName);
          io.to(roomName).emit("match_found", { room: roomName });
          joined = true;
          break;
        }
      }

      if (!joined) {
        const newRoom = `pk_${socket.id}`;
        socket.join(newRoom);
        socket.emit("waiting_for_opponent");
      }
    });

    socket.on("game_state_sync", ({ room, state }) => {
      socket.to(room).emit("opponent_state", state);
    });

    socket.on("game_over", ({ room }) => {
      socket.to(room).emit("opponent_game_over");
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
