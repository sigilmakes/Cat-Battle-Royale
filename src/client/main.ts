// Client application entry point: Socket.IO, input management, interpolation, and rendering

import { io, Socket } from 'socket.io-client';
import {
  COLLECTIBLE_RADIUS,
  DEFAULT_OBSTACLES,
  ISLAND_CENTER_X,
  ISLAND_CENTER_Y,
  ISLAND_RADIUS,
  MAP_HEIGHT,
  MAP_WIDTH,
  ObstacleRect,
  PELLET_RADIUS,
  PLAYER_RADIUS,
} from '../shared/constants.js';
import type {
  JoinRoomPayload,
  JoinRoomSuccess,
  PlayerInput,
  RoomSnapshot,
} from '../shared/types.js';

// DOM elements
const lobbyOverlay = document.getElementById('lobby-overlay') as HTMLDivElement;
const hudOverlay = document.getElementById('hud-overlay') as HTMLDivElement;
const finishOverlay = document.getElementById('finish-overlay') as HTMLDivElement;
const waitingOverlay = document.getElementById('waiting-overlay') as HTMLDivElement;
const playerNameInput = document.getElementById('player-name') as HTMLInputElement;
const roomCodeInput = document.getElementById('room-code') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const rematchBtn = document.getElementById('rematch-btn') as HTMLButtonElement;

const hpPips = document.getElementById('hp-pips') as HTMLDivElement;
const stormStatus = document.getElementById('storm-status') as HTMLDivElement;
const stormCountdown = document.getElementById('storm-countdown') as HTMLDivElement;
const dreamiesCount = document.getElementById('dreamies-count') as HTMLDivElement;
const weaponTier = document.getElementById('weapon-tier') as HTMLDivElement;
const ammoDisplay = document.getElementById('ammo-display') as HTMLDivElement;
const reloadBarContainer = document.getElementById('reload-bar-container') as HTMLDivElement;
const reloadBarFill = document.getElementById('reload-bar-fill') as HTMLDivElement;
const ghostIndicator = document.getElementById('ghost-indicator') as HTMLDivElement;
const finishTitle = document.getElementById('finish-title') as HTMLHeadingElement;
const finishDesc = document.getElementById('finish-desc') as HTMLParagraphElement;

// Canvas setup
const container = document.getElementById('game-container') as HTMLDivElement;
const canvas = document.createElement('canvas');
canvas.width = 1000;
canvas.height = 750;
container.prepend(canvas);
const ctx = canvas.getContext('2d')!;

// Client state
let socket: Socket;
let localPlayerId: string | null = null;
let currentRoomCode = 'main';
let obstacles: ObstacleRect[] = [...DEFAULT_OBSTACLES];
let currentSnapshot: RoomSnapshot | null = null;
// Input tracking
const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  fire: false,
  reload: false,
};
let mouseX = 0;
let mouseY = 0;
let inputSequence = 0;

// URL parameter parsing for auto-join
const urlParams = new URLSearchParams(window.location.search);
const queryRoom = urlParams.get('room');
const queryName = urlParams.get('name');
if (queryRoom) roomCodeInput.value = queryRoom;
if (queryName) playerNameInput.value = queryName;

function initSocket(): void {
  socket = io({
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    const cachedToken = sessionStorage.getItem(`reconnectToken_${currentRoomCode}`);
    if (cachedToken && localPlayerId) {
      socket.emit('join_room', {
        roomCode: currentRoomCode,
        playerName: playerNameInput.value || 'Cat',
        reconnectToken: cachedToken,
      } as JoinRoomPayload);
    }
  });

  socket.on('room_joined', (data: JoinRoomSuccess) => {
    localPlayerId = data.playerId;
    sessionStorage.setItem(`reconnectToken_${data.roomCode}`, data.reconnectToken);
    obstacles = data.obstacles || DEFAULT_OBSTACLES;

    lobbyOverlay.style.display = 'none';
    hudOverlay.style.display = 'flex';
  });

  socket.on('room_state_snapshot', (snapshot: RoomSnapshot) => {
    currentSnapshot = snapshot;
    updateHUD(snapshot);
  });

  socket.on('error_message', (err: { message: string }) => {
    alert(err.message || 'Error joining room');
  });
}

function handleJoin(): void {
  const name = playerNameInput.value.trim() || 'Cat';
  const code = roomCodeInput.value.trim().toLowerCase() || 'main';
  currentRoomCode = code;

  if (!socket) {
    initSocket();
  }

  const cachedToken = sessionStorage.getItem(`reconnectToken_${code}`) || undefined;
  socket.emit('join_room', {
    roomCode: code,
    playerName: name,
    reconnectToken: cachedToken,
  } as JoinRoomPayload);
}

joinBtn.addEventListener('click', handleJoin);
rematchBtn.addEventListener('click', () => {
  if (socket) {
    socket.emit('request_rematch');
  }
});

// Input Listeners
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = true;
  if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = true;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = true;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = true;
  if (e.code === 'Space') keys.fire = true;
  if (e.code === 'KeyR') keys.reload = true;
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.up = false;
  if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.down = false;
  if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.left = false;
  if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.right = false;
  if (e.code === 'Space') keys.fire = false;
  if (e.code === 'KeyR') keys.reload = false;
});

window.addEventListener('blur', () => {
  keys.up = false;
  keys.down = false;
  keys.left = false;
  keys.right = false;
  keys.fire = false;
  keys.reload = false;
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) keys.fire = true;
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) keys.fire = false;
});

// Fixed 30Hz network input loop
setInterval(() => {
  if (!socket || !localPlayerId || !currentSnapshot) return;

  const localPlayer = currentSnapshot.players.find((p) => p.id === localPlayerId);
  if (!localPlayer) return;

  // Calculate aim angle from local player screen position to mouse
  const cam = getCameraOffset(localPlayer.x, localPlayer.y);
  const screenX = localPlayer.x - cam.x;
  const screenY = localPlayer.y - cam.y;
  const aimAngle = Math.atan2(mouseY - screenY, mouseX - screenX);

  let moveX = 0;
  let moveY = 0;
  if (keys.left) moveX -= 1;
  if (keys.right) moveX += 1;
  if (keys.up) moveY -= 1;
  if (keys.down) moveY += 1;

  const inputPayload: PlayerInput = {
    seq: ++inputSequence,
    moveX,
    moveY,
    aimAngle,
    fire: keys.fire,
    reload: keys.reload,
  };

  socket.emit('player_input', inputPayload);
}, 1000 / 30);

function getCameraOffset(targetX: number, targetY: number): { x: number; y: number } {
  // Center camera on target player within arena bounds
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  const camX = Math.max(0, Math.min(MAP_WIDTH - canvas.width, targetX - halfW));
  const camY = Math.max(0, Math.min(MAP_HEIGHT - canvas.height, targetY - halfH));
  return { x: camX, y: camY };
}

function updateHUD(snapshot: RoomSnapshot): void {
  const localPlayer = snapshot.players.find((p) => p.id === localPlayerId);

  // Phase overlays
  if (snapshot.phase === 'lobby') {
    waitingOverlay.style.display = 'block';
    waitingOverlay.textContent = `Waiting for 3 players to connect (${snapshot.players.length}/3)...`;
    finishOverlay.style.display = 'none';
  } else if (snapshot.phase === 'playing') {
    waitingOverlay.style.display = 'none';
    finishOverlay.style.display = 'none';
  } else if (snapshot.phase === 'finished') {
    waitingOverlay.style.display = 'none';
    finishOverlay.style.display = 'flex';
    if (snapshot.isDraw) {
      finishTitle.textContent = 'Draw!';
      finishDesc.textContent = 'No survivors in the cat tornado!';
    } else {
      const isWinner = localPlayer && localPlayer.slot === snapshot.winnerSlot;
      finishTitle.textContent = isWinner ? 'Victory!' : 'Game Over';
      finishDesc.textContent = `${snapshot.winnerName} wins the match!`;
    }
    rematchBtn.textContent = `Vote Rematch (${snapshot.rematchVotes}/${snapshot.requiredVotes})`;
  }

  if (!localPlayer) return;

  // HP pips
  const pips = hpPips.children;
  for (let i = 0; i < pips.length; i++) {
    if (i < localPlayer.hp) {
      pips[i].className = 'health-pip';
    } else {
      pips[i].className = 'health-pip lost';
    }
  }

  // Ghost status
  ghostIndicator.style.display = localPlayer.status === 'ghost' ? 'block' : 'none';

  // Weapon ammo & tier
  const tierNames = ['Tier 1: Starter Gun', 'Tier 2: Fast Watergun', 'Tier 3: Mega Super-Soaker'];
  weaponTier.textContent = tierNames[localPlayer.tier] || 'Watergun';
  ammoDisplay.textContent = `${localPlayer.ammo} / ${localPlayer.maxAmmo}`;

  if (localPlayer.isReloading) {
    reloadBarContainer.style.display = 'block';
    reloadBarFill.style.width = `${Math.min(100, Math.round(localPlayer.reloadProgress * 100))}%`;
  } else {
    reloadBarContainer.style.display = 'none';
  }

  // Dreamies count
  const nextTarget = localPlayer.tier === 0 ? 5 : (localPlayer.tier === 1 ? 12 : 12);
  dreamiesCount.textContent = `${localPlayer.dreamies} / ${nextTarget}`;

  // Storm HUD
  const storm = snapshot.storm;
  if (storm.phase === 'waiting') {
    stormStatus.textContent = 'Tornado Eye Safe';
    stormStatus.className = 'storm-title';
    stormCountdown.textContent = `${Math.ceil(storm.timeUntilShrink)}s`;
    stormCountdown.className = 'storm-timer';
  } else if (storm.phase === 'shrinking') {
    stormStatus.textContent = 'Tornado Shrinking!';
    stormStatus.className = 'storm-title';
    stormCountdown.textContent = `Radius: ${Math.round(storm.currentRadius)}m`;
    stormCountdown.className = 'storm-timer';
  } else {
    stormStatus.textContent = 'Tornado Fully Closed!';
    stormStatus.className = 'storm-title storm-warning';
    stormCountdown.textContent = 'DANGER!';
    stormCountdown.className = 'storm-timer storm-warning';
  }

  if (localPlayer.stormExposureSeconds > 0) {
    stormStatus.textContent = `TORNADO EXPOSURE: ${localPlayer.stormExposureSeconds.toFixed(1)}s`;
    stormStatus.className = 'storm-title storm-warning';
  }
}

// 60fps Rendering Loop with Interpolation
function render(): void {
  requestAnimationFrame(render);

  if (!currentSnapshot) {
    // Render blank background before joining
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const localPlayer = currentSnapshot.players.find((p) => p.id === localPlayerId);
  const cam = getCameraOffset(localPlayer?.x ?? ISLAND_CENTER_X, localPlayer?.y ?? ISLAND_CENTER_Y);

  // 1. Clear background (Ocean)
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  // 2. Draw Sandy Beach & Grassy Island
  ctx.beginPath();
  ctx.arc(ISLAND_CENTER_X, ISLAND_CENTER_Y, ISLAND_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#fde68a'; // Sand
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ISLAND_CENTER_X, ISLAND_CENTER_Y, ISLAND_RADIUS - 30, 0, Math.PI * 2);
  ctx.fillStyle = '#4ade80'; // Grass
  ctx.fill();

  // 3. Draw Solid Cover Obstacles
  for (const obs of obstacles) {
    const left = obs.x - obs.width / 2;
    const top = obs.y - obs.height / 2;

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(left + 4, top + 4, obs.width, obs.height);

    // Stone / Crate body
    ctx.fillStyle = obs.width === obs.height ? '#78716c' : '#57534e';
    ctx.fillRect(left, top, obs.width, obs.height);

    ctx.strokeStyle = '#292524';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, obs.width, obs.height);

    // Inner highlight
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 3, top + 3, obs.width - 6, obs.height - 6);
  }

  // 4. Draw Collectibles (Dreamies)
  for (const item of currentSnapshot.collectibles) {
    ctx.save();
    ctx.translate(item.x, item.y);

    if (item.isDeathDrop) {
      // Golden death drop pile
      ctx.beginPath();
      ctx.arc(0, 0, COLLECTIBLE_RADIUS + 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#d97706';
      ctx.stroke();

      ctx.fillStyle = '#78350f';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${item.value}`, 0, 0);
    } else {
      // Golden fish/star treat
      ctx.beginPath();
      ctx.arc(0, 0, COLLECTIBLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#b45309';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-2, -2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 5. Draw Watergun Pellets
  for (const pellet of currentSnapshot.pellets) {
    ctx.beginPath();
    ctx.arc(pellet.x, pellet.y, PELLET_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0284c7';
    ctx.stroke();

    // Subtle glow
    ctx.beginPath();
    ctx.arc(pellet.x, pellet.y, PELLET_RADIUS + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.fill();
  }

  // 6. Draw Tornado Storm Ring
  const storm = currentSnapshot.storm;
  if (storm.currentRadius < ISLAND_RADIUS) {
    ctx.save();
    // Swirling storm vortex
    ctx.beginPath();
    ctx.arc(storm.centerX, storm.centerY, storm.currentRadius, 0, Math.PI * 2);
    ctx.rect(MAP_WIDTH, 0, -MAP_WIDTH, MAP_HEIGHT); // Invert clipping mask
    ctx.fillStyle = 'rgba(88, 28, 135, 0.45)'; // Purple storm hazard
    ctx.fill();

    // Eye boundary ring
    ctx.beginPath();
    ctx.arc(storm.centerX, storm.centerY, storm.currentRadius, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.8)';
    ctx.stroke();
    ctx.restore();
  }

  // 7. Draw Cats (Players)
  const catColors = [
    { body: '#f97316', inner: '#ffedd5', name: 'Ginger' }, // Slot 0: Ginger
    { body: '#e2e8f0', inner: '#f97316', name: 'Calico' }, // Slot 1: Calico
    { body: '#334155', inner: '#64748b', name: 'Shadow' }, // Slot 2: Black
  ];

  for (const player of currentSnapshot.players) {
    const isGhost = player.status === 'ghost';
    const isLocal = player.id === localPlayerId;
    const catStyle = catColors[player.slot % 3];

    ctx.save();
    ctx.translate(player.x, player.y);

    if (isGhost) {
      ctx.globalAlpha = 0.45;
    }

    // Aim Indicator / Watergun nozzle
    ctx.save();
    ctx.rotate(player.aimAngle);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(PLAYER_RADIUS - 4, -4, 16, 8);
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2;
    ctx.strokeRect(PLAYER_RADIUS - 4, -4, 16, 8);
    ctx.restore();

    // Cat Body
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isGhost ? '#a855f7' : catStyle.body;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isLocal ? '#38bdf8' : '#1e293b';
    ctx.stroke();

    // Cat Ears
    const earAngle1 = player.aimAngle - Math.PI / 4;
    const earAngle2 = player.aimAngle + Math.PI / 4;
    for (const ea of [earAngle1, earAngle2]) {
      const ex = Math.cos(ea) * (PLAYER_RADIUS - 2);
      const ey = Math.sin(ea) * (PLAYER_RADIUS - 2);
      ctx.beginPath();
      ctx.arc(ex, ey, 6, 0, Math.PI * 2);
      ctx.fillStyle = isGhost ? '#c084fc' : catStyle.inner;
      ctx.fill();
    }

    // Whisker / Eye Face
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = isGhost ? '#ffffff' : '#ffffff';
    ctx.fill();

    // Player Name & Mini HP Tag
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    const tag = isGhost ? `👻 ${player.name}` : player.name;
    ctx.fillText(tag, 0, -PLAYER_RADIUS - 10);
    ctx.shadowBlur = 0;

    // Mini HP dots above cat
    if (!isGhost) {
      for (let h = 0; h < player.maxHp; h++) {
        ctx.beginPath();
        ctx.arc(-12 + h * 8, -PLAYER_RADIUS - 4, 3, 0, Math.PI * 2);
        ctx.fillStyle = h < player.hp ? '#22c55e' : '#475569';
        ctx.fill();
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

// Start rendering loop
requestAnimationFrame(render);

// If URL params exist, auto-join immediately
if (queryRoom || queryName) {
  handleJoin();
}
