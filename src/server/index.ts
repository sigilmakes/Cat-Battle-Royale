// Express and Socket.IO server entry point

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, Socket } from 'socket.io';
import type { JoinRoomPayload } from '../shared/types.js';
import { GameRoom } from './rooms/room.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map<string, GameRoom>();

function getOrCreateRoom(rawCode: string): GameRoom {
  const code = (rawCode || 'main').trim().toLowerCase().slice(0, 10) || 'main';
  let room = rooms.get(code);
  if (!room) {
    room = new GameRoom(code, io);
    rooms.set(code, room);
  }
  return room;
}

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    activeRooms: rooms.size,
  });
});

// Serve static client files in production
const clientDist = path.resolve(__dirname, '../../dist/client');
app.use(express.static(clientDist));

// Fallback to index.html for SPA routing
app.get('*', (_req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(200).send('Cat Battle Royale server is running. Client assets not built yet.');
    }
  });
});

// Socket.IO event wiring
io.on('connection', (socket: Socket) => {
  let currentRoom: GameRoom | null = null;

  socket.on('join_room', (payload: JoinRoomPayload) => {
    const roomCode = payload?.roomCode || 'main';
    currentRoom = getOrCreateRoom(roomCode);
    currentRoom.handleJoin(socket, payload);
  });

  socket.on('player_input', (input: unknown) => {
    if (currentRoom) {
      currentRoom.handleInput(socket, input);
    }
  });

  socket.on('request_rematch', () => {
    if (currentRoom) {
      currentRoom.handleRematch(socket);
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      currentRoom.handleDisconnect(socket);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cat Battle Royale server listening on http://0.0.0.0:${PORT}`);
});

function gracefulShutdown(): void {
  console.log('Shutting down server...');
  for (const room of rooms.values()) {
    room.stop();
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
