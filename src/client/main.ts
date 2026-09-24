// Client application: Socket.IO, client-side prediction, cat procedural rendering, map themes, and HUD

import { io, Socket } from 'socket.io-client';
import {
  BASE_PLAYER_SPEED,
  CATNIP_SPEED_MULTIPLIER,
  COLLECTIBLE_RADIUS,
  ISLAND_CENTER_X,
  ISLAND_CENTER_Y,
  ISLAND_RADIUS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAPS,
  MapId,
  ObstacleRect,
  PELLET_RADIUS,
  PLAYER_RADIUS,
} from '../shared/constants.js';
import { clamp, clampToIsland, normalizeVector, resolveCircleObstacle } from '../shared/geom.js';
import type {
  JoinRoomPayload,
  JoinRoomSuccess,
  PlayerInput,
  PlayerState,
  RoomSnapshot,
} from '../shared/types.js';

// DOM elements
const lobbyOverlay = document.getElementById('lobby-overlay') as HTMLDivElement;
const lobbyActivePanel = document.getElementById('lobby-active-panel') as HTMLDivElement;
const hudOverlay = document.getElementById('hud-overlay') as HTMLDivElement;
const finishOverlay = document.getElementById('finish-overlay') as HTMLDivElement;
const playerNameInput = document.getElementById('player-name') as HTMLInputElement;
const roomCodeInput = document.getElementById('room-code') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const readyBtn = document.getElementById('ready-btn') as HTMLButtonElement;
const rematchBtn = document.getElementById('rematch-btn') as HTMLButtonElement;
const leaveBtn = document.getElementById('leave-btn') as HTMLButtonElement;
const finishLeaveBtn = document.getElementById('finish-leave-btn') as HTMLButtonElement;
const lobbyPlayersList = document.getElementById('lobby-players-list') as HTMLDivElement;
const playerCountNum = document.getElementById('player-count-num') as HTMLSpanElement;

const hpPips = document.getElementById('hp-pips') as HTMLDivElement;
const speedBuffBadge = document.getElementById('speed-buff-badge') as HTMLDivElement;
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

const mapOptions = document.querySelectorAll<HTMLDivElement>('.map-option');
const votesAtoll = document.getElementById('votes-atoll') as HTMLDivElement;
const votesTemple = document.getElementById('votes-temple') as HTMLDivElement;
const votesJungle = document.getElementById('votes-jungle') as HTMLDivElement;

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
let currentMapId: MapId = 'atoll';
let obstacles: ObstacleRect[] = [...MAPS.atoll.obstacles];
let currentSnapshot: RoomSnapshot | null = null;
let selectedMapVote: MapId = 'atoll';
let isLocalReady = false;

// Client prediction state for local player (zero-latency feel)
let predictedX = ISLAND_CENTER_X;
let predictedY = ISLAND_CENTER_Y;
let lastFrameTime = performance.now();
let animTimer = 0;

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
    currentMapId = data.mapId;
    obstacles = data.obstacles || MAPS[data.mapId]?.obstacles || MAPS.atoll.obstacles;

    lobbyActivePanel.style.display = 'flex';
    joinBtn.style.display = 'none';
    roomCodeInput.disabled = true;
  });

  socket.on('room_state_snapshot', (snapshot: RoomSnapshot) => {
    // Ignore packets already in flight when the player clicked Leave Match.
    if (!localPlayerId) return;
    currentSnapshot = snapshot;
    currentMapId = snapshot.mapId;
    obstacles = MAPS[snapshot.mapId]?.obstacles || MAPS.atoll.obstacles;

    updateLobbyUI(snapshot);
    updateHUD(snapshot);

    // Reconcile prediction with server state
    const local = snapshot.players.find((p) => p.id === localPlayerId);
    if (local && (local.status === 'alive' || local.status === 'ghost')) {
      if (Math.hypot(predictedX - local.x, predictedY - local.y) > 80) {
        predictedX = local.x;
        predictedY = local.y;
      } else {
        predictedX = predictedX * 0.75 + local.x * 0.25;
        predictedY = predictedY * 0.75 + local.y * 0.25;
      }
    }
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
    preferredMap: selectedMapVote,
  } as JoinRoomPayload);
}

joinBtn.addEventListener('click', handleJoin);

// Player name input auto-sync
playerNameInput.addEventListener('input', () => {
  const name = playerNameInput.value.trim() || 'Cat';
  if (socket && localPlayerId) {
    socket.emit('set_name', name);
  }
});

// Map selection click listeners
mapOptions.forEach((opt) => {
  opt.addEventListener('click', () => {
    const map = opt.getAttribute('data-map') as MapId;
    if (!map) return;
    selectedMapVote = map;
    mapOptions.forEach((o) => o.classList.toggle('selected', o.getAttribute('data-map') === map));
    if (socket && localPlayerId) {
      socket.emit('vote_map', map);
    }
  });
});

// Ready toggle button
readyBtn.addEventListener('click', () => {
  isLocalReady = !isLocalReady;
  readyBtn.textContent = isLocalReady ? 'UNREADY' : 'READY UP';
  readyBtn.classList.toggle('is-ready', isLocalReady);
  if (socket && localPlayerId) {
    socket.emit('toggle_ready', isLocalReady);
  }
});

// Leave buttons
function leaveRoom(): void {
  if (socket) {
    socket.emit('leave_room');
  }
  sessionStorage.removeItem(`reconnectToken_${currentRoomCode}`);
  localPlayerId = null;
  currentSnapshot = null;
  isLocalReady = false;

  lobbyOverlay.style.display = 'flex';
  lobbyActivePanel.style.display = 'none';
  joinBtn.style.display = 'block';
  roomCodeInput.disabled = false;
  hudOverlay.style.display = 'none';
  finishOverlay.style.display = 'none';
  readyBtn.textContent = 'READY UP';
  readyBtn.classList.remove('is-ready');
}

leaveBtn.addEventListener('click', leaveRoom);
finishLeaveBtn.addEventListener('click', leaveRoom);

rematchBtn.addEventListener('click', () => {
  if (socket) {
    socket.emit('request_rematch');
  }
});

// Input Listeners
window.addEventListener('keydown', (e) => {
  if (document.activeElement === playerNameInput || document.activeElement === roomCodeInput) return;
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

// Fixed 60Hz network input transmission loop
setInterval(() => {
  if (!socket || !localPlayerId || !currentSnapshot || currentSnapshot.phase !== 'playing') return;

  const cam = getCameraOffset(predictedX, predictedY);
  const screenX = predictedX - cam.x;
  const screenY = predictedY - cam.y;
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
}, 1000 / 60);

function getCameraOffset(targetX: number, targetY: number): { x: number; y: number } {
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  const camX = Math.max(0, Math.min(MAP_WIDTH - canvas.width, targetX - halfW));
  const camY = Math.max(0, Math.min(MAP_HEIGHT - canvas.height, targetY - halfH));
  return { x: camX, y: camY };
}

function updateLobbyUI(snapshot: RoomSnapshot): void {
  if (snapshot.phase !== 'lobby') {
    lobbyOverlay.style.display = 'none';
    hudOverlay.style.display = 'flex';
    return;
  }

  lobbyOverlay.style.display = 'flex';
  hudOverlay.style.display = 'none';
  playerCountNum.textContent = String(snapshot.players.length);

  // Update map vote counts
  votesAtoll.textContent = `${snapshot.mapVotes.atoll || 0} votes`;
  votesTemple.textContent = `${snapshot.mapVotes.temple || 0} votes`;
  votesJungle.textContent = `${snapshot.mapVotes.jungle || 0} votes`;

  // Render players in lobby
  const catColors = ['#f97316', '#e2e8f0', '#334155'];
  lobbyPlayersList.innerHTML = '';
  for (const p of snapshot.players) {
    const isMe = p.id === localPlayerId;
    const row = document.createElement('div');
    row.className = 'player-row';

    const left = document.createElement('div');
    left.className = 'player-name-badge';

    const dot = document.createElement('div');
    dot.className = 'cat-avatar-dot';
    dot.style.background = catColors[p.slot % 3];

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name + (isMe ? ' (You)' : '');

    left.appendChild(dot);
    left.appendChild(nameSpan);

    const right = document.createElement('div');
    right.className = `ready-pill ${p.ready ? 'ready' : 'waiting'}`;
    right.textContent = p.ready ? 'Ready' : 'Not Ready';

    row.appendChild(left);
    row.appendChild(right);
    lobbyPlayersList.appendChild(row);
  }
}

function updateHUD(snapshot: RoomSnapshot): void {
  const localPlayer = snapshot.players.find((p) => p.id === localPlayerId);

  // Phase overlays
  if (snapshot.phase === 'finished') {
    finishOverlay.style.display = 'flex';
    if (snapshot.isDraw) {
      finishTitle.textContent = 'Draw!';
      finishDesc.textContent = 'No survivors left in the cat tornado!';
    } else {
      const isWinner = localPlayer && localPlayer.slot === snapshot.winnerSlot;
      finishTitle.textContent = isWinner ? 'Victory! 🏆' : 'Game Over';
      finishDesc.textContent = `${snapshot.winnerName} wins the match!`;
    }
    rematchBtn.textContent = `Vote Rematch (${snapshot.rematchVotes}/${snapshot.requiredVotes})`;
  } else {
    finishOverlay.style.display = 'none';
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

  // Speed buff indicator
  speedBuffBadge.style.display = localPlayer.speedBoostSeconds > 0 ? 'block' : 'none';

  // Ghost status
  ghostIndicator.style.display = localPlayer.status === 'ghost' ? 'block' : 'none';

  // Weapon ammo & tier
  const tierNames = ['Tier 1: Starter Watergun', 'Tier 2: Rapid Sprayer', 'Tier 3: Mega Super-Soaker'];
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
    stormStatus.textContent = `STORM EXPOSURE: ${localPlayer.stormExposureSeconds.toFixed(1)}s`;
    stormStatus.className = 'storm-title storm-warning';
  }
}

// Draw a realistic, expressive 2D cat
function drawCat(
  p: PlayerState,
  isLocal: boolean,
  x: number,
  y: number,
  aimAngle: number,
  time: number
): void {
  ctx.save();
  ctx.translate(x, y);

  const isGhost = p.status === 'ghost';
  if (isGhost) {
    ctx.globalAlpha = 0.55;
  }

  // Cat Breed Palette
  // 0: Ginger Tabby | 1: Calico | 2: Midnight Black
  const breedStyles = [
    {
      coat: '#f97316',
      belly: '#ffedd5',
      stripe: '#c2410c',
      earInner: '#fca5a5',
      eye: '#22c55e',
      nose: '#f43f5e',
    },
    {
      coat: '#f8fafc',
      belly: '#ffffff',
      stripe: '#ea580c',
      patch: '#1e293b',
      earInner: '#fda4af',
      eye: '#38bdf8',
      nose: '#fb7185',
    },
    {
      coat: '#1e293b',
      belly: '#334155',
      stripe: '#0f172a',
      earInner: '#64748b',
      eye: '#fbbf24',
      nose: '#475569',
    },
  ];
  const b = breedStyles[p.slot % 3];

  // Rotate cat according to aim/movement direction
  ctx.rotate(aimAngle);

  // 1. Animated Wagging Tail
  const tailWag = Math.sin(time * 6) * 0.35;
  ctx.save();
  ctx.translate(-PLAYER_RADIUS + 2, 0);
  ctx.rotate(Math.PI + tailWag);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(12, 10 + tailWag * 10, 24, 6);
  ctx.strokeStyle = isGhost ? '#a855f7' : b.coat;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Tail tip
  ctx.beginPath();
  ctx.arc(24, 6, 3, 0, Math.PI * 2);
  ctx.fillStyle = isGhost ? '#d8b4fe' : (p.slot === 0 ? '#ffedd5' : b.stripe);
  ctx.fill();
  ctx.restore();

  // 2. Animated Paws (4 paws stepping)
  const walkOffset = Math.sin(time * 10) * 4;
  const pawOffsets = [
    { x: 8, y: -PLAYER_RADIUS + 2 + walkOffset },
    { x: 8, y: PLAYER_RADIUS - 2 - walkOffset },
    { x: -10, y: -PLAYER_RADIUS + 3 - walkOffset },
    { x: -10, y: PLAYER_RADIUS - 3 + walkOffset },
  ];

  for (const paw of pawOffsets) {
    ctx.beginPath();
    ctx.arc(paw.x, paw.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = isGhost ? '#c084fc' : '#ffffff'; // white cat paws
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 3. Cat Body (Oval)
  ctx.beginPath();
  ctx.ellipse(-2, 0, PLAYER_RADIUS - 1, PLAYER_RADIUS - 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = isGhost ? '#8b5cf6' : b.coat;
  ctx.fill();
  ctx.strokeStyle = isLocal ? '#38bdf8' : '#0f172a';
  ctx.lineWidth = isLocal ? 3 : 2;
  ctx.stroke();

  // Tabby Stripes or Calico patches on body
  if (!isGhost) {
    if (p.slot === 0) {
      // Tabby stripes
      ctx.strokeStyle = b.stripe;
      ctx.lineWidth = 2.5;
      for (let s = -10; s <= 4; s += 6) {
        ctx.beginPath();
        ctx.moveTo(s, -12);
        ctx.lineTo(s - 2, 12);
        ctx.stroke();
      }
    } else if (p.slot === 1) {
      // Calico orange & black patches
      ctx.fillStyle = b.stripe;
      ctx.beginPath();
      ctx.arc(-4, -6, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(-6, 6, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 4. Cat Head
  ctx.beginPath();
  ctx.arc(8, 0, 14, 0, Math.PI * 2);
  ctx.fillStyle = isGhost ? '#9333ea' : b.coat;
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 5. Pointed Cat Ears (Triangles with pink inner ear)
  const ears = [
    { base1: { x: 4, y: -12 }, tip: { x: 12, y: -20 }, base2: { x: 14, y: -8 } },
    { base1: { x: 4, y: 12 }, tip: { x: 12, y: 20 }, base2: { x: 14, y: 8 } },
  ];

  for (const ear of ears) {
    ctx.beginPath();
    ctx.moveTo(ear.base1.x, ear.base1.y);
    ctx.lineTo(ear.tip.x, ear.tip.y);
    ctx.lineTo(ear.base2.x, ear.base2.y);
    ctx.closePath();
    ctx.fillStyle = isGhost ? '#7c3aed' : b.coat;
    ctx.fill();
    ctx.stroke();

    // Pink inner ear
    ctx.beginPath();
    ctx.moveTo(ear.base1.x + 2, ear.base1.y * 0.85);
    ctx.lineTo(ear.tip.x - 1, ear.tip.y * 0.85);
    ctx.lineTo(ear.base2.x - 1, ear.base2.y * 0.85);
    ctx.closePath();
    ctx.fillStyle = isGhost ? '#d8b4fe' : b.earInner;
    ctx.fill();
  }

  // 6. Expressive Almond Cat Eyes with vertical slit pupils
  const eyes = [{ x: 13, y: -5 }, { x: 13, y: 5 }];
  for (const eye of eyes) {
    // Sclera
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 4, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = isGhost ? '#ffffff' : b.eye;
    ctx.fill();

    // Vertical slit pupil
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 1.2, 2.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();

    // Catchlight twinkle
    ctx.beginPath();
    ctx.arc(eye.x - 1, eye.y - 1, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  // 7. Cute Pink Nose & Mouth (:3)
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(17, -2);
  ctx.lineTo(17, 2);
  ctx.closePath();
  ctx.fillStyle = isGhost ? '#ffffff' : b.nose;
  ctx.fill();

  // Whiskers! (3 on each cheek)
  ctx.strokeStyle = isGhost ? '#e9d5ff' : '#ffffff';
  ctx.lineWidth = 1.2;
  // Left whiskers
  ctx.beginPath();
  ctx.moveTo(17, -3);
  ctx.lineTo(26, -11);
  ctx.moveTo(17, -2);
  ctx.lineTo(27, -4);
  ctx.moveTo(17, -1);
  ctx.lineTo(25, 3);
  // Right whiskers
  ctx.moveTo(17, 3);
  ctx.lineTo(26, 11);
  ctx.moveTo(17, 2);
  ctx.lineTo(27, 4);
  ctx.moveTo(17, 1);
  ctx.lineTo(25, -3);
  ctx.stroke();

  // 8. Watergun Blaster held in paws
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(PLAYER_RADIUS - 2, 2, 14, 6);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(PLAYER_RADIUS - 2, 2, 14, 6);
  // Water bottle reservoir on top
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(PLAYER_RADIUS + 1, -2, 8, 4);

  ctx.restore();

  // 9. Floating Name Tag & Mini HP Bar (Unrotated)
  ctx.save();
  ctx.translate(x, y);
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 5;
  const tag = isGhost ? `👻 ${p.name}` : p.name;
  ctx.fillText(tag, 0, -PLAYER_RADIUS - 14);
  ctx.shadowBlur = 0;

  // Mini HP pips
  if (!isGhost) {
    for (let h = 0; h < p.maxHp; h++) {
      ctx.beginPath();
      ctx.arc(-12 + h * 8, -PLAYER_RADIUS - 6, 3, 0, Math.PI * 2);
      ctx.fillStyle = h < p.hp ? '#22c55e' : '#475569';
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// 60fps Rendering Loop with Client-Side Prediction
function render(now: number): void {
  requestAnimationFrame(render);
  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  animTimer += dt;

  // 1. Advance Client-Side Local Prediction
  if (currentSnapshot && currentSnapshot.phase === 'playing' && localPlayerId) {
    const local = currentSnapshot.players.find((p) => p.id === localPlayerId);
    if (local && (local.status === 'alive' || local.status === 'ghost')) {
      let moveX = 0;
      let moveY = 0;
      if (keys.left) moveX -= 1;
      if (keys.right) moveX += 1;
      if (keys.up) moveY -= 1;
      if (keys.down) moveY += 1;

      const norm = normalizeVector(moveX, moveY);
      const speed =
        local.speedBoostSeconds > 0
          ? BASE_PLAYER_SPEED * CATNIP_SPEED_MULTIPLIER
          : BASE_PLAYER_SPEED;

      if (norm.x !== 0 || norm.y !== 0) {
        let nX = predictedX + norm.x * speed * dt;
        let nY = predictedY + norm.y * speed * dt;

        if (local.status === 'alive') {
          for (const obs of obstacles) {
            const res = resolveCircleObstacle(nX, nY, PLAYER_RADIUS, obs);
            nX = res.x;
            nY = res.y;
          }
          const bounded = clampToIsland(
            nX,
            nY,
            PLAYER_RADIUS,
            ISLAND_CENTER_X,
            ISLAND_CENTER_Y,
            ISLAND_RADIUS
          );
          nX = bounded.x;
          nY = bounded.y;
        } else {
          nX = clamp(nX, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
          nY = clamp(nY, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
        }

        predictedX = nX;
        predictedY = nY;
      }
    }
  }

  // 2. Camera Setup
  const cam = getCameraOffset(predictedX, predictedY);

  // 3. Clear Screen & Draw Ocean
  const mapConfig = MAPS[currentMapId] || MAPS.atoll;
  ctx.fillStyle = currentMapId === 'temple' ? '#0f766e' : (currentMapId === 'jungle' ? '#064e3b' : '#0284c7');
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-cam.x, -cam.y);

  // 4. Draw Circular Island Beach & Interior
  ctx.beginPath();
  ctx.arc(ISLAND_CENTER_X, ISLAND_CENTER_Y, ISLAND_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = mapConfig.beachColor;
  ctx.fill();
  ctx.lineWidth = 12;
  ctx.strokeStyle = currentMapId === 'temple' ? '#b45309' : '#d97706';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ISLAND_CENTER_X, ISLAND_CENTER_Y, ISLAND_RADIUS - 32, 0, Math.PI * 2);
  ctx.fillStyle = mapConfig.groundColor;
  ctx.fill();

  // 5. Draw Obstacles (Themed)
  for (const obs of obstacles) {
    const left = obs.x - obs.width / 2;
    const top = obs.y - obs.height / 2;

    // Drop Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(left + 6, top + 6, obs.width, obs.height);

    // Body
    ctx.fillStyle = mapConfig.obstacleColor;
    ctx.fillRect(left, top, obs.width, obs.height);

    ctx.strokeStyle = '#1c1917';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, obs.width, obs.height);

    // Highlights
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 2, top + 2, obs.width - 4, obs.height - 4);
  }

  if (currentSnapshot) {
    // 6. Draw Collectibles (Dreamies, Catnip, Tuna)
    for (const item of currentSnapshot.collectibles) {
      ctx.save();
      ctx.translate(item.x, item.y);

      if (item.isDeathDrop) {
        // Glowing Golden Drop Pile
        ctx.beginPath();
        ctx.arc(0, 0, COLLECTIBLE_RADIUS + 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#b45309';
        ctx.stroke();

        ctx.fillStyle = '#78350f';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`+${item.value}`, 0, 0);
      } else if (item.type === 'catnip') {
        // Emerald Catnip Leaf
        ctx.beginPath();
        ctx.arc(0, 0, COLLECTIBLE_RADIUS + 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(0, 0, COLLECTIBLE_RADIUS - 2, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#059669';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('NIP', 0, 0);
      } else if (item.type === 'tuna') {
        // Tuna Bowl (+1 HP)
        ctx.beginPath();
        ctx.arc(0, 0, COLLECTIBLE_RADIUS - 1, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.strokeStyle = '#b91c1c';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('♥', 0, 0);
      } else {
        // Golden Dreamies Treat
        ctx.beginPath();
        ctx.arc(0, 0, COLLECTIBLE_RADIUS - 2, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', 0, 0);
      }

      ctx.restore();
    }

    // 7. Draw Watergun Pellets
    for (const pellet of currentSnapshot.pellets) {
      ctx.beginPath();
      ctx.arc(pellet.x, pellet.y, PELLET_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = '#38bdf8';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0284c7';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pellet.x, pellet.y, PELLET_RADIUS + 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.fill();
    }

    // 8. Draw Tornado Storm Hazard Ring
    const storm = currentSnapshot.storm;
    if (storm.currentRadius < ISLAND_RADIUS) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(storm.centerX, storm.centerY, storm.currentRadius, 0, Math.PI * 2);
      ctx.rect(MAP_WIDTH, 0, -MAP_WIDTH, MAP_HEIGHT);
      ctx.fillStyle = 'rgba(88, 28, 135, 0.5)';
      ctx.fill();

      // Swirling boundary
      ctx.beginPath();
      ctx.arc(storm.centerX, storm.centerY, storm.currentRadius, 0, Math.PI * 2);
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(192, 132, 252, 0.85)';
      ctx.stroke();
      ctx.restore();
    }

    // 9. Draw Cats (Players)
    for (const player of currentSnapshot.players) {
      const isLocal = player.id === localPlayerId;
      const posX = isLocal ? predictedX : player.x;
      const posY = isLocal ? predictedY : player.y;

      let aim = player.aimAngle;
      if (isLocal) {
        const screenX = predictedX - cam.x;
        const screenY = predictedY - cam.y;
        aim = Math.atan2(mouseY - screenY, mouseX - screenX);
      }

      drawCat(player, isLocal, posX, posY, aim, animTimer);
    }
  }

  ctx.restore();
}

// Start 60fps rendering loop
requestAnimationFrame(render);

// If URL query parameters exist, auto-fill room and name
if (queryRoom || queryName) {
  handleJoin();
}
