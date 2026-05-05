import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT ?? 3001);
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 90_000);
const VALID_WORD_LENGTHS = new Set([5, 6, 7]);
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_CHAT_MESSAGES = 60;
const MAX_CHAT_MESSAGE_LENGTH = 180;
const MOBILE_APP_ORIGINS = new Set([
  "http://localhost",
  "https://localhost",
  "capacitor://localhost",
  "ionic://localhost",
]);

const parseAllowedOrigins = (rawOrigins) => {
  if (!rawOrigins) {
    return ["http://localhost:5173", "http://127.0.0.1:5173"];
  }

  const origins = rawOrigins
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : ["http://localhost:5173", "http://127.0.0.1:5173"];
};

const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);

const isAllowedOrigin = (origin) => {
  if (!origin) {
    return true;
  }

  if (MOBILE_APP_ORIGINS.has(origin)) {
    return true;
  }

  if (allowedOrigins.includes("*")) {
    return true;
  }

  return allowedOrigins.includes(origin);
};

const corsOriginHandler = (origin, callback) => {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error("Origin not allowed"), false);
};

const sanitizeName = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.length > 0 ? raw.slice(0, 24) : `Joueur-${Math.floor(100 + Math.random() * 900)}`;
};

const sanitizeRoomCode = (value) =>
  (typeof value === "string" ? value : "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

const sanitizeWord = (value, expectedLength) =>
  (typeof value === "string" ? value : "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, expectedLength);

const sanitizeChatMessage = (value) => {
  const raw = typeof value === "string" ? value : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
};

const safeAck = (ack, payload) => {
  if (typeof ack === "function") {
    ack(payload);
  }
};

const createRoomCode = (roomsMap) => {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    let code = "";
    for (let index = 0; index < 6; index += 1) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!roomsMap.has(code)) {
      return code;
    }
  }
  return `${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100).toString(36).toUpperCase()}`.slice(
    0,
    6,
  );
};

const app = express();
app.use(
  cors({
    origin: corsOriginHandler,
    credentials: true,
  }),
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mememot-duel-server",
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.json({
    name: "MemeMot Duel Server",
    status: "running",
    health: "/health",
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOriginHandler,
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

const rooms = new Map();
const playerSessionsByToken = new Map();
const socketMembership = new Map();

const getOpponentId = (room, playerId) => room.playerOrder.find((id) => id !== playerId) ?? null;

const buildRoomState = (room) => {
  const players = {};
  for (const playerId of room.playerOrder) {
    const player = room.players[playerId];
    if (!player) {
      continue;
    }
    players[playerId] = {
      id: player.id,
      name: player.name,
      connected: player.connected,
      ready: player.ready,
      hasSecret: player.hasSecret,
      guessesCount: player.guessesCount,
    };
  }

  const guessesByPlayer = {};
  for (const playerId of room.playerOrder) {
    guessesByPlayer[playerId] = room.guessesByPlayer[playerId] ?? [];
  }

  return {
    code: room.code,
    wordLength: room.wordLength,
    phase: room.phase,
    winnerId: room.winnerId,
    turnPlayerId: room.turnPlayerId,
    playerOrder: [...room.playerOrder],
    players,
    guessesByPlayer,
    chat: room.chat,
    reconnectGraceMs: RECONNECT_GRACE_MS,
  };
};

const emitRoomState = (room) => {
  io.to(room.code).emit("duel:state", buildRoomState(room));
};

const pushChatMessage = (room, message) => {
  room.chat.push(message);
  if (room.chat.length > MAX_CHAT_MESSAGES) {
    room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  }
};

const pushSystemMessage = (room, text) => {
  pushChatMessage(room, {
    id: randomUUID(),
    senderId: null,
    senderName: "Systeme",
    text,
    createdAt: new Date().toISOString(),
  });
};

const maybeDeleteEmptyRoom = (room) => {
  if (room.playerOrder.length === 0) {
    rooms.delete(room.code);
  }
};

const attachSocketToPlayer = (socket, room, player, reconnecting) => {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }

  if (player.socketId && player.socketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(player.socketId);
    previousSocket?.disconnect(true);
    socketMembership.delete(player.socketId);
  }

  player.socketId = socket.id;
  player.connected = true;
  socket.join(room.code);
  socketMembership.set(socket.id, {
    roomCode: room.code,
    playerId: player.id,
    playerToken: player.token,
  });

  if (reconnecting) {
    pushSystemMessage(room, `${player.name} est reconnecte.`);
  }
};

const setWinnerFromRemainingPlayer = (room, departingPlayerName) => {
  if (room.playerOrder.length !== 1) {
    return;
  }

  const remainingPlayerId = room.playerOrder[0];
  const remainingPlayer = room.players[remainingPlayerId];
  if (!remainingPlayer) {
    return;
  }

  if (room.phase === "waiting") {
    remainingPlayer.ready = false;
    remainingPlayer.hasSecret = false;
    room.secretsByPlayer[remainingPlayerId] = null;
    room.turnPlayerId = null;
    room.winnerId = null;
    return;
  }

  if (room.phase !== "finished") {
    room.phase = "finished";
    room.winnerId = remainingPlayerId;
    room.turnPlayerId = null;
    pushSystemMessage(room, `${departingPlayerName} a quitte. ${remainingPlayer.name} gagne.`);
  }
};

const removePlayerFromRoom = (room, playerId) => {
  const player = room.players[playerId];
  if (!player) {
    return;
  }

  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }

  if (player.socketId) {
    const playerSocket = io.sockets.sockets.get(player.socketId);
    playerSocket?.leave(room.code);
    socketMembership.delete(player.socketId);
  }

  delete room.players[playerId];
  delete room.secretsByPlayer[playerId];
  delete room.guessesByPlayer[playerId];
  room.playerOrder = room.playerOrder.filter((id) => id !== playerId);
  playerSessionsByToken.delete(player.token);

  setWinnerFromRemainingPlayer(room, player.name);
  maybeDeleteEmptyRoom(room);

  if (rooms.has(room.code)) {
    emitRoomState(room);
  }
};

const maybeStartPlaying = (room) => {
  if (room.playerOrder.length !== 2) {
    return;
  }

  const everyoneReady = room.playerOrder.every((playerId) => room.players[playerId]?.ready);
  if (!everyoneReady) {
    return;
  }

  room.phase = "playing";
  room.winnerId = null;
  room.turnPlayerId = room.playerOrder[0];
};

const getRoomAndPlayerFromSocket = (socket) => {
  const membership = socketMembership.get(socket.id);
  if (!membership) {
    return null;
  }

  const room = rooms.get(membership.roomCode);
  if (!room) {
    socketMembership.delete(socket.id);
    playerSessionsByToken.delete(membership.playerToken);
    return null;
  }

  const player = room.players[membership.playerId];
  if (!player) {
    socketMembership.delete(socket.id);
    playerSessionsByToken.delete(membership.playerToken);
    return null;
  }

  return { room, player, membership };
};

const scheduleDisconnectGrace = (room, playerId) => {
  const player = room.players[playerId];
  if (!player) {
    return;
  }

  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
  }

  player.disconnectTimer = setTimeout(() => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom) {
      return;
    }

    const livePlayer = liveRoom.players[playerId];
    if (!livePlayer || livePlayer.connected) {
      return;
    }

    pushSystemMessage(
      liveRoom,
      `${livePlayer.name} ne s'est pas reconnecte a temps (${Math.round(RECONNECT_GRACE_MS / 1000)}s).`,
    );
    removePlayerFromRoom(liveRoom, playerId);
  }, RECONNECT_GRACE_MS);
};

io.on("connection", (socket) => {
  socket.on("duel:create-room", (payload, ack) => {
    if (socketMembership.has(socket.id)) {
      safeAck(ack, { ok: false, message: "Tu es deja dans une salle." });
      return;
    }

    const requestedLength = Number(payload?.wordLength);
    const wordLength = VALID_WORD_LENGTHS.has(requestedLength) ? requestedLength : 5;
    const roomCode = createRoomCode(rooms);
    const playerName = sanitizeName(payload?.playerName);
    const playerId = randomUUID();
    const playerToken = randomUUID();

    const room = {
      code: roomCode,
      wordLength,
      phase: "waiting",
      winnerId: null,
      turnPlayerId: null,
      playerOrder: [playerId],
      players: {
        [playerId]: {
          id: playerId,
          token: playerToken,
          name: playerName,
          connected: true,
          ready: false,
          hasSecret: false,
          guessesCount: 0,
          socketId: socket.id,
          disconnectTimer: null,
        },
      },
      secretsByPlayer: {
        [playerId]: null,
      },
      guessesByPlayer: {
        [playerId]: [],
      },
      chat: [],
    };

    rooms.set(roomCode, room);
    playerSessionsByToken.set(playerToken, { roomCode, playerId });
    attachSocketToPlayer(socket, room, room.players[playerId], false);
    pushSystemMessage(room, `${playerName} a cree la salle.`);
    emitRoomState(room);

    safeAck(ack, { ok: true, roomCode, playerId, playerToken, wordLength });
  });

  socket.on("duel:join-room", (payload, ack) => {
    if (socketMembership.has(socket.id)) {
      safeAck(ack, { ok: false, message: "Tu es deja dans une salle." });
      return;
    }

    const roomCode = sanitizeRoomCode(payload?.roomCode);
    const room = rooms.get(roomCode);
    if (!room) {
      safeAck(ack, { ok: false, message: "Salle introuvable." });
      return;
    }

    if (room.playerOrder.length >= 2) {
      safeAck(ack, { ok: false, message: "La salle est deja complete." });
      return;
    }

    if (room.phase === "finished") {
      safeAck(ack, { ok: false, message: "Partie deja terminee dans cette salle." });
      return;
    }

    const playerName = sanitizeName(payload?.playerName);
    const playerId = randomUUID();
    const playerToken = randomUUID();

    room.players[playerId] = {
      id: playerId,
      token: playerToken,
      name: playerName,
      connected: true,
      ready: false,
      hasSecret: false,
      guessesCount: 0,
      socketId: socket.id,
      disconnectTimer: null,
    };
    room.playerOrder.push(playerId);
    room.secretsByPlayer[playerId] = null;
    room.guessesByPlayer[playerId] = [];
    room.phase = "choosing";
    room.winnerId = null;
    room.turnPlayerId = null;

    playerSessionsByToken.set(playerToken, { roomCode, playerId });
    attachSocketToPlayer(socket, room, room.players[playerId], false);
    pushSystemMessage(room, `${playerName} a rejoint la salle.`);
    emitRoomState(room);

    safeAck(ack, {
      ok: true,
      roomCode,
      playerId,
      playerToken,
      wordLength: room.wordLength,
    });
  });

  socket.on("duel:resume", (payload, ack) => {
    const playerToken =
      typeof payload?.playerToken === "string" ? payload.playerToken.trim() : "";

    if (!playerToken) {
      safeAck(ack, { ok: false, message: "Token de session manquant." });
      return;
    }

    const session = playerSessionsByToken.get(playerToken);
    if (!session) {
      safeAck(ack, { ok: false, message: "Session introuvable ou expiree." });
      return;
    }

    const room = rooms.get(session.roomCode);
    if (!room) {
      playerSessionsByToken.delete(playerToken);
      safeAck(ack, { ok: false, message: "Salle introuvable pour cette session." });
      return;
    }

    const player = room.players[session.playerId];
    if (!player) {
      playerSessionsByToken.delete(playerToken);
      safeAck(ack, { ok: false, message: "Joueur introuvable pour cette session." });
      return;
    }

    attachSocketToPlayer(socket, room, player, true);
    emitRoomState(room);
    safeAck(ack, {
      ok: true,
      roomCode: room.code,
      playerId: player.id,
      playerToken: player.token,
      wordLength: room.wordLength,
      resumed: true,
    });
  });

  socket.on("duel:set-secret-word", (payload, ack) => {
    const resolved = getRoomAndPlayerFromSocket(socket);
    if (!resolved) {
      safeAck(ack, { ok: false, message: "Tu n'es dans aucune salle." });
      return;
    }

    const { room, player } = resolved;

    if (room.phase === "waiting") {
      safeAck(ack, { ok: false, message: "Attends un deuxieme joueur." });
      return;
    }

    if (room.phase !== "choosing") {
      safeAck(ack, { ok: false, message: "Tu ne peux plus changer ton mot secret." });
      return;
    }

    const sanitizedWord = sanitizeWord(payload?.word, room.wordLength);
    if (sanitizedWord.length !== room.wordLength) {
      safeAck(ack, {
        ok: false,
        message: `Le mot secret doit contenir ${room.wordLength} lettres.`,
      });
      return;
    }

    room.secretsByPlayer[player.id] = sanitizedWord;
    player.ready = true;
    player.hasSecret = true;
    maybeStartPlaying(room);
    emitRoomState(room);
    safeAck(ack, { ok: true });
  });

  socket.on("duel:submit-guess", (payload, ack) => {
    const resolved = getRoomAndPlayerFromSocket(socket);
    if (!resolved) {
      safeAck(ack, { ok: false, message: "Tu n'es dans aucune salle." });
      return;
    }

    const { room, player } = resolved;

    if (room.phase !== "playing") {
      safeAck(ack, { ok: false, message: "La partie n'est pas en phase de jeu." });
      return;
    }

    if (room.turnPlayerId !== player.id) {
      safeAck(ack, { ok: false, message: "Ce n'est pas ton tour." });
      return;
    }

    const guess = sanitizeWord(payload?.guess, room.wordLength);
    if (guess.length !== room.wordLength) {
      safeAck(ack, {
        ok: false,
        message: `Ton essai doit contenir ${room.wordLength} lettres.`,
      });
      return;
    }

    const opponentId = getOpponentId(room, player.id);
    if (!opponentId) {
      safeAck(ack, { ok: false, message: "Adversaire introuvable." });
      return;
    }

    const opponentSecret = room.secretsByPlayer[opponentId];
    if (!opponentSecret) {
      safeAck(ack, { ok: false, message: "Le mot adverse n'est pas pret." });
      return;
    }

    let exactCount = 0;
    for (let index = 0; index < room.wordLength; index += 1) {
      if (guess[index] === opponentSecret[index]) {
        exactCount += 1;
      }
    }

    room.guessesByPlayer[player.id].push({
      guess,
      exactCount,
      wordLength: room.wordLength,
      createdAt: new Date().toISOString(),
    });
    player.guessesCount += 1;

    if (guess === opponentSecret) {
      room.phase = "finished";
      room.winnerId = player.id;
      room.turnPlayerId = null;
      pushSystemMessage(room, `${player.name} a trouve le mot adverse et gagne.`);
    } else {
      room.turnPlayerId = opponentId;
    }

    emitRoomState(room);
    safeAck(ack, { ok: true, exactCount, wordLength: room.wordLength });
  });

  socket.on("duel:chat-send", (payload, ack) => {
    const resolved = getRoomAndPlayerFromSocket(socket);
    if (!resolved) {
      safeAck(ack, { ok: false, message: "Tu n'es dans aucune salle." });
      return;
    }

    const { room, player } = resolved;
    const text = sanitizeChatMessage(payload?.message);
    if (!text) {
      safeAck(ack, { ok: false, message: "Message vide." });
      return;
    }

    pushChatMessage(room, {
      id: randomUUID(),
      senderId: player.id,
      senderName: player.name,
      text,
      createdAt: new Date().toISOString(),
    });
    emitRoomState(room);
    safeAck(ack, { ok: true });
  });

  socket.on("duel:leave-room", (_payload, ack) => {
    const resolved = getRoomAndPlayerFromSocket(socket);
    if (!resolved) {
      safeAck(ack, { ok: true });
      return;
    }

    const { room, player } = resolved;
    pushSystemMessage(room, `${player.name} a quitte la salle.`);
    removePlayerFromRoom(room, player.id);
    safeAck(ack, { ok: true });
  });

  socket.on("disconnect", () => {
    const membership = socketMembership.get(socket.id);
    if (!membership) {
      return;
    }

    socketMembership.delete(socket.id);
    const room = rooms.get(membership.roomCode);
    if (!room) {
      return;
    }

    const player = room.players[membership.playerId];
    if (!player) {
      return;
    }

    if (player.socketId !== socket.id) {
      return;
    }

    player.connected = false;
    player.socketId = null;
    pushSystemMessage(
      room,
      `${player.name} est hors ligne. Reconnexion possible pendant ${Math.round(RECONNECT_GRACE_MS / 1000)}s.`,
    );
    emitRoomState(room);
    scheduleDisconnectGrace(room, player.id);
  });
});

httpServer.listen(PORT, () => {
  console.log(
    `[duel-server] listening on :${PORT} | allowed origins: ${allowedOrigins.join(", ")}`,
  );
});
