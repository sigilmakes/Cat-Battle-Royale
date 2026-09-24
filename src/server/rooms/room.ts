// Server room management, connection handling, and tick broadcasting

import crypto from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  MapId,
  MAX_PLAYERS,
  SERVER_TICK_DT,
  SERVER_TICK_RATE,
  SNAPSHOT_INTERVAL_TICKS,
} from '../../shared/constants.js';
import type {
  JoinRoomPayload,
  JoinRoomSuccess,
  PlayerInput,
} from '../../shared/types.js';
import { GameSimulation } from '../game/simulation.js';

interface ConnectedSession {
  socket: Socket;
  playerId: string;
  name: string;
  reconnectToken: string;
}

export class GameRoom {
  public readonly code: string;
  public readonly simulation: GameSimulation;
  private readonly io: Server;
  private readonly sessions = new Map<string, ConnectedSession>(); // playerId -> session
  private readonly socketToPlayer = new Map<string, string>(); // socket.id -> playerId
  private readonly pendingInputs = new Map<string, PlayerInput>(); // playerId -> latest input
  private tickerInterval: NodeJS.Timeout | null = null;
  private tickCounter = 0;

  constructor(code: string, io: Server) {
    this.code = code;
    this.io = io;
    this.simulation = new GameSimulation();
    this.startLoop();
  }

  private startLoop(): void {
    const msPerTick = 1000 / SERVER_TICK_RATE;
    this.tickerInterval = setInterval(() => {
      this.tick();
    }, msPerTick);
  }

  public stop(): void {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
  }

  private tick(): void {
    // Collect snapshot of inputs
    const inputsToProcess = new Map<string, PlayerInput>(this.pendingInputs);

    // Step simulation deterministically
    this.simulation.step(SERVER_TICK_DT, inputsToProcess);
    this.tickCounter++;

    // Broadcast snapshot at configured rate
    if (this.tickCounter % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.broadcastSnapshot();
    }
  }

  public broadcastSnapshot(): void {
    const snapshot = this.simulation.getSnapshot();
    this.io.to(this.code).emit('room_state_snapshot', snapshot);
  }

  public handleJoin(socket: Socket, payload: JoinRoomPayload): void {
    const playerName = (payload.playerName || 'Cat').trim().slice(0, 15) || 'Cat';
    const preferredMap: MapId = payload.preferredMap || 'atoll';

    // 1. Check if reconnecting with an existing token
    if (payload.reconnectToken) {
      for (const session of this.sessions.values()) {
        if (session.reconnectToken === payload.reconnectToken) {
          // Reconnect successful
          this.socketToPlayer.set(socket.id, session.playerId);
          session.socket = socket;
          this.simulation.reconnectPlayer(session.playerId, session.reconnectToken);
          socket.join(this.code);

          const successPayload: JoinRoomSuccess = {
            playerId: session.playerId,
            reconnectToken: session.reconnectToken,
            roomCode: this.code,
            slot: this.simulation.players.get(session.playerId)?.slot ?? 0,
            mapId: this.simulation.mapId,
            obstacles: this.simulation.obstacles,
          };
          socket.emit('room_joined', successPayload);
          this.broadcastSnapshot();
          return;
        }
      }
    }

    // 2. Reject if room is already at max capacity
    if (this.simulation.players.size >= MAX_PLAYERS) {
      socket.emit('error_message', { message: 'Room is full (maximum 3 players).' });
      return;
    }

    // 3. New player registration
    const playerId = `p-${crypto.randomUUID().slice(0, 8)}`;
    const reconnectToken = crypto.randomUUID();

    const created = this.simulation.addPlayer(playerId, playerName, reconnectToken, preferredMap);
    if (!created) {
      socket.emit('error_message', { message: 'Unable to join room.' });
      return;
    }

    this.sessions.set(playerId, {
      socket,
      playerId,
      name: playerName,
      reconnectToken,
    });
    this.socketToPlayer.set(socket.id, playerId);
    socket.join(this.code);

    const successPayload: JoinRoomSuccess = {
      playerId,
      reconnectToken,
      roomCode: this.code,
      slot: created.slot,
      mapId: this.simulation.mapId,
      obstacles: this.simulation.obstacles,
    };
    socket.emit('room_joined', successPayload);
    this.broadcastSnapshot();
  }

  public handleSetName(socket: Socket, name: unknown): void {
    const playerId = this.socketToPlayer.get(socket.id);
    if (!playerId || typeof name !== 'string') return;
    this.simulation.setPlayerName(playerId, name);
    this.broadcastSnapshot();
  }

  public handleToggleReady(socket: Socket, ready?: unknown): void {
    const playerId = this.socketToPlayer.get(socket.id);
    if (!playerId) return;
    const readyState = typeof ready === 'boolean' ? ready : undefined;
    this.simulation.setPlayerReady(playerId, readyState);
    this.broadcastSnapshot();
  }

  public handleVoteMap(socket: Socket, mapId: unknown): void {
    const playerId = this.socketToPlayer.get(socket.id);
    if (!playerId || typeof mapId !== 'string') return;
    this.simulation.voteMap(playerId, mapId as MapId);
    this.broadcastSnapshot();
  }

  public handleInput(socket: Socket, rawInput: unknown): void {
    const playerId = this.socketToPlayer.get(socket.id);
    if (!playerId) return;

    if (typeof rawInput !== 'object' || rawInput === null) return;
    const inp = rawInput as Partial<PlayerInput>;

    const moveX = Number.isFinite(inp.moveX) ? Math.max(-1, Math.min(1, inp.moveX!)) : 0;
    const moveY = Number.isFinite(inp.moveY) ? Math.max(-1, Math.min(1, inp.moveY!)) : 0;
    const aimAngle = Number.isFinite(inp.aimAngle) ? inp.aimAngle! : 0;
    const fire = Boolean(inp.fire);
    const reload = Boolean(inp.reload);

    this.pendingInputs.set(playerId, {
      seq: typeof inp.seq === 'number' ? inp.seq : 0,
      moveX,
      moveY,
      aimAngle,
      fire,
      reload,
    });
  }

  public handleRematch(socket: Socket): void {
    const playerId = this.socketToPlayer.get(socket.id);
    if (!playerId) return;
    this.simulation.voteRematch(playerId);
    this.broadcastSnapshot();
  }

  public handleLeave(socket: Socket): void {
    this.handleDisconnect(socket);
  }

  public handleDisconnect(socket: Socket): void {
    const playerId = this.socketToPlayer.get(socket.id);
    if (!playerId) return;

    this.socketToPlayer.delete(socket.id);
    this.pendingInputs.delete(playerId);

    if (this.simulation.phase === 'lobby') {
      // In lobby, clean up session completely so another user can join into the free slot
      this.sessions.delete(playerId);
      this.simulation.removePlayer(playerId);
    } else {
      this.simulation.markDisconnected(playerId);
    }

    this.broadcastSnapshot();
  }

  public isEmpty(): boolean {
    return this.socketToPlayer.size === 0 && this.sessions.size === 0;
  }

  public getPlayerCount(): number {
    return this.simulation.players.size;
  }
}
