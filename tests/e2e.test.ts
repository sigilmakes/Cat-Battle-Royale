// Automated End-to-End Multi-Client Integration Test Suite

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { Server, Socket as ServerSocket } from 'socket.io';
import { io as ClientIO, Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameRoom } from '../src/server/rooms/room.js';
import type {
  JoinRoomPayload,
  JoinRoomSuccess,
  PlayerInput,
  RoomSnapshot,
} from '../src/shared/types.js';

describe('Automated Multi-Client E2E Test Suite', () => {
  let server: http.Server;
  let ioServer: Server;
  let serverUrl: string;
  const rooms = new Map<string, GameRoom>();

  function getOrCreateRoom(rawCode: string): GameRoom {
    const code = (rawCode || 'main').trim().toLowerCase().slice(0, 32) || 'main';
    let room = rooms.get(code);
    if (!room) {
      room = new GameRoom(code, ioServer);
      rooms.set(code, room);
    }
    return room;
  }

  beforeAll(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new Server(server, {
      cors: { origin: '*' },
    });

    ioServer.on('connection', (socket: ServerSocket) => {
      let currentRoom: GameRoom | null = null;

      socket.on('join_room', (payload: JoinRoomPayload) => {
        const roomCode = payload?.roomCode || 'main';
        currentRoom = getOrCreateRoom(roomCode);
        currentRoom.handleJoin(socket, payload);
      });

      socket.on('set_name', (name: unknown) => {
        if (currentRoom) currentRoom.handleSetName(socket, name);
      });

      socket.on('toggle_ready', (ready: unknown) => {
        if (currentRoom) currentRoom.handleToggleReady(socket, ready);
      });

      socket.on('vote_map', (mapId: unknown) => {
        if (currentRoom) currentRoom.handleVoteMap(socket, mapId);
      });

      socket.on('player_input', (input: unknown) => {
        if (currentRoom) currentRoom.handleInput(socket, input);
      });

      socket.on('request_rematch', () => {
        if (currentRoom) currentRoom.handleRematch(socket);
      });

      socket.on('leave_room', () => {
        if (currentRoom) {
          currentRoom.handleLeave(socket);
          currentRoom = null;
        }
      });

      socket.on('disconnect', () => {
        if (currentRoom) {
          currentRoom.handleDisconnect(socket);
          if (currentRoom.isEmpty()) {
            currentRoom.stop();
            rooms.delete(currentRoom.code);
          }
        }
      });
    });

    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      serverUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    await promise;
  });

  afterAll(async () => {
    for (const r of rooms.values()) {
      r.stop();
    }
    ioServer.close();
    const { promise, resolve } = Promise.withResolvers<void>();
    server.close(() => resolve());
    await promise;
  });

  function createTestClient(): ClientSocket {
    return ClientIO(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
    });
  }

  function waitForEvent<T>(client: ClientSocket, event: string): Promise<T> {
    const { promise, resolve } = Promise.withResolvers<T>();
    client.once(event, (data: T) => {
      resolve(data);
    });
    return promise;
  }

  function waitForSnapshot(client: ClientSocket, predicate: (snap: RoomSnapshot) => boolean): Promise<RoomSnapshot> {
    const { promise, resolve } = Promise.withResolvers<RoomSnapshot>();
    const handler = (snap: RoomSnapshot) => {
      if (predicate(snap)) {
        client.off('room_state_snapshot', handler);
        resolve(snap);
      }
    };
    client.on('room_state_snapshot', handler);
    return promise;
  }

  it('handles lobby lifecycle, name updates, map voting, and ready gate (Issues #19, #21)', async () => {
    const c1 = createTestClient();
    const c2 = createTestClient();
    const c3 = createTestClient();

    try {
      // 1. Client 1 joins
      c1.emit('join_room', { roomCode: 'e2e-lobby', playerName: 'Whiskers' });
      const join1 = await waitForEvent<JoinRoomSuccess>(c1, 'room_joined');
      expect(join1.slot).toBe(0);

      // 2. Client 1 updates name to "Tiger" (Issue #19)
      c1.emit('set_name', 'Tiger');
      let snap = await waitForSnapshot(c1, (s) => s.players[0]?.name === 'Tiger');
      expect(snap.players[0].name).toBe('Tiger');

      // 3. Client 2 and 3 join
      c2.emit('join_room', { roomCode: 'e2e-lobby', playerName: 'Felix' });
      await waitForEvent<JoinRoomSuccess>(c2, 'room_joined');

      c3.emit('join_room', { roomCode: 'e2e-lobby', playerName: 'Garfield' });
      await waitForEvent<JoinRoomSuccess>(c3, 'room_joined');

      // 4. Verify 3 players connected in lobby, game is NOT automatically started!
      snap = await waitForSnapshot(c1, (s) => s.players.length === 3);
      expect(snap.players.length).toBe(3);
      expect(snap.phase).toBe('lobby');

      // 5. Map voting (Issue #21): C1 and C2 vote 'temple', C3 votes 'jungle'
      c1.emit('vote_map', 'temple');
      c2.emit('vote_map', 'temple');
      c3.emit('vote_map', 'jungle');

      snap = await waitForSnapshot(c1, (s) => s.mapVotes.temple === 2 && s.mapVotes.jungle === 1);
      expect(snap.mapVotes.temple).toBe(2);
      expect(snap.mapVotes.jungle).toBe(1);

      // 6. Ready gate: C1 and C2 ready up -> match remains in lobby
      c1.emit('toggle_ready', true);
      c2.emit('toggle_ready', true);
      snap = await waitForSnapshot(c1, (s) => s.players.filter((p) => p.ready).length === 2);
      expect(snap.phase).toBe('lobby');

      // 7. C3 readies up -> all ready! Transitions to 'playing' with 'temple' map!
      c3.emit('toggle_ready', true);
      snap = await waitForSnapshot(c1, (s) => s.phase === 'playing');

      expect(snap.phase).toBe('playing');
      expect(snap.mapId).toBe('temple');
    } finally {
      c1.disconnect();
      c2.disconnect();
      c3.disconnect();
    }
  });

  it.each(['lobby', 'playing'] as const)(
    'leaves a %s room without receiving its snapshots after joining another room',
    async (phase) => {
      const clients = [createTestClient(), createTestClient(), createTestClient()];
      const [leaver, remaining] = clients;
      const oldCode = `leave-${phase}`;
      const newCode = `next-${phase}`;
      const received: RoomSnapshot[] = [];
      try {
        for (const [index, client] of clients.entries()) {
          const joined = waitForEvent<JoinRoomSuccess>(client, 'room_joined');
          client.emit('join_room', { roomCode: oldCode, playerName: `Old-${index}` });
          await joined;
        }
        if (phase === 'playing') {
          const started = waitForSnapshot(leaver, (s) => s.phase === 'playing');
          clients.forEach((client) => client.emit('toggle_ready', true));
          await started;
        }

        rooms.get(oldCode)!.stop();
        const settled = waitForSnapshot(leaver, (s) =>
          s.players.some((p) => p.name === 'Old-sync'));
        remaining.emit('set_name', 'Old-sync');
        await settled;

        leaver.on('room_state_snapshot', (snapshot: RoomSnapshot) => received.push(snapshot));
        leaver.emit('leave_room');
        const joinedNewRoom = waitForEvent<JoinRoomSuccess>(leaver, 'room_joined');
        leaver.emit('join_room', { roomCode: newCode, playerName: 'New-room-cat' });
        await joinedNewRoom;

        // Generate a known old-room broadcast, then a new-room broadcast.
        // Socket.IO preserves packet order on the leaving client's connection;
        // observing the latter is a barrier, so no arbitrary sleep is needed.
        const oldUpdated = waitForSnapshot(remaining, (s) =>
          s.players.some((p) => p.name === 'Old-room-update'));
        remaining.emit('set_name', 'Old-room-update');
        await oldUpdated;
        const newUpdated = waitForSnapshot(leaver, (s) =>
          s.players.some((p) => p.name === 'New-room-update'));
        leaver.emit('set_name', 'New-room-update');
        await newUpdated;

        expect(received.length).toBeGreaterThan(0);
        expect(received.every((s) => s.players.length === 1 &&
          s.players.every((p) => p.name.startsWith('New-room-')))).toBe(true);
      } finally {
        clients.forEach((client) => client.disconnect());
      }
    }
  );

  it('boots user and frees slot cleanly when tab closes in lobby (Issue #14)', async () => {
    const c1 = createTestClient();
    try {
      c1.emit('join_room', { roomCode: 'e2e-close-tab', playerName: 'CatToLeave' });
      const join1 = await waitForEvent<JoinRoomSuccess>(c1, 'room_joined');
      expect(join1.slot).toBe(0);

      const room = rooms.get('e2e-close-tab')!;
      expect(room.getPlayerCount()).toBe(1);

      // Simulates closing browser tab
      c1.disconnect();
      // Wait for server tick to process disconnect
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (room.getPlayerCount() === 0) {
            clearInterval(interval);
            resolve();
          }
        }, 10);
      });

      // Player slot is freed cleanly in lobby
      expect(room.getPlayerCount()).toBe(0);

      // Another user can now join into slot 0
      const c2 = createTestClient();
      c2.emit('join_room', { roomCode: 'e2e-close-tab', playerName: 'NewCat' });
      const join2 = await waitForEvent<JoinRoomSuccess>(c2, 'room_joined');
      expect(join2.slot).toBe(0);
      c2.disconnect();
    } finally {
      c1.disconnect();
    }
  });

  it('runs complete multiplayer match: movement, catnip speed buff, shooting, elimination, and rematch (Issues #8, #9, #10, #18, #21)', async () => {
    const c1 = createTestClient();
    const c2 = createTestClient();
    const c3 = createTestClient();

    try {
      c1.emit('join_room', { roomCode: 'e2e-match', playerName: 'Player1' });
      await waitForEvent<JoinRoomSuccess>(c1, 'room_joined');

      c2.emit('join_room', { roomCode: 'e2e-match', playerName: 'Player2' });
      await waitForEvent<JoinRoomSuccess>(c2, 'room_joined');

      c3.emit('join_room', { roomCode: 'e2e-match', playerName: 'Player3' });
      await waitForEvent<JoinRoomSuccess>(c3, 'room_joined');

      // Ready all 3 players
      c1.emit('toggle_ready', true);
      c2.emit('toggle_ready', true);
      c3.emit('toggle_ready', true);

      const snapPlaying = await waitForSnapshot(c1, (s) => s.phase === 'playing');
      expect(snapPlaying.phase).toBe('playing');

      const room = rooms.get('e2e-match')!;

      // 1. Send movement inputs
      const moveInput: PlayerInput = {
        seq: 1,
        moveX: 1,
        moveY: 0,
        aimAngle: 0,
        fire: false,
        reload: false,
      };
      c1.emit('player_input', moveInput);

      const p1 = Array.from(room.simulation.players.values())[0];
      expect(p1).toBeDefined();

      // 2. Pick up Catnip collectible -> grants speed boost!
      room.simulation.collectibles.push({
        id: 'test-catnip',
        x: p1.x,
        y: p1.y,
        type: 'catnip',
        value: 1,
        isDeathDrop: false,
      });

      // Advance 1 tick
      room.simulation.step(0.016, new Map());
      expect(p1.speedBoostSeconds).toBeGreaterThan(0);

      // 3. Combat: Player 1 shoots at Player 2
      const p2 = Array.from(room.simulation.players.values())[1];
      p1.x = 500;
      p1.y = 500;
      p1.aimAngle = 0;
      p2.x = 580;
      p2.y = 500;
      p2.hp = 4;
      c1.emit('player_input', {
        seq: 2,
        moveX: 0,
        moveY: 0,
        aimAngle: 0,
        fire: true,
        reload: false,
      });

      // Await snapshot confirming pellet hit target
      const hitSnap = await waitForSnapshot(c1, (s) => s.players[1]?.hp < 4);
      expect(hitSnap.players[1].hp).toBeLessThan(4);
      // 4. Eliminate Player 2 and Player 3 to trigger victory
      p2.hp = 0;
      p2.status = 'ghost';
      const p3 = Array.from(room.simulation.players.values())[2];
      p3.hp = 0;
      p3.status = 'ghost';

      room.simulation.step(0.016, new Map());
      expect(room.simulation.phase).toBe('finished');
      expect(room.simulation.winnerSlot).toBe(p1.slot);

      // 5. Vote Rematch from all clients -> resets match!
      c1.emit('request_rematch');
      c2.emit('request_rematch');
      c3.emit('request_rematch');

      const snapRematch = await waitForSnapshot(c1, (s) => s.phase === 'playing');
      expect(snapRematch.phase).toBe('playing');
      expect(p1.hp).toBe(4);
      expect(p2.hp).toBe(4);
      expect(p3.hp).toBe(4);
    } finally {
      c1.disconnect();
      c2.disconnect();
      c3.disconnect();
    }
  });
});
