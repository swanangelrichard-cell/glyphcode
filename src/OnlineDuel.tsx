import { CSSProperties, FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { SupportedWordLength, VALID_WORDS_BY_LENGTH } from "./wordBank";
import WordGridInput from "./WordGridInput";

type DuelPhase = "waiting" | "choosing" | "playing" | "finished";

type DuelPlayer = {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  hasSecret: boolean;
  guessesCount: number;
};

type DuelGuess = {
  guess: string;
  exactCount: number;
  wordLength: number;
  createdAt?: string;
};

type DuelChatMessage = {
  id: string;
  senderId: string | null;
  senderName: string;
  text: string;
  createdAt: string;
};

type DuelState = {
  code: string;
  wordLength: SupportedWordLength;
  maxAttemptsPerPlayer: number;
  hasPassword: boolean;
  phase: DuelPhase;
  winnerId: string | null;
  turnPlayerId: string | null;
  playerOrder: string[];
  players: Record<string, DuelPlayer>;
  guessesByPlayer: Record<string, DuelGuess[]>;
  rematchRequestsByPlayer: Record<string, boolean>;
  chat: DuelChatMessage[];
  reconnectGraceMs?: number;
};

type AckResponse =
  | {
      ok: true;
      roomCode?: string;
      playerId?: string;
      playerToken?: string;
      wordLength?: SupportedWordLength;
      maxAttemptsPerPlayer?: number;
      hasPassword?: boolean;
      exactCount?: number;
      remainingAttempts?: number;
      resumed?: boolean;
      started?: boolean;
      message?: string;
    }
  | { ok: false; message: string };

type DuelSession = {
  roomCode: string;
  playerId: string;
  playerToken: string;
};

const ENV_DUEL_SERVER_URL = (import.meta.env.VITE_DUEL_SERVER_URL as string | undefined)?.trim();
const DEFAULT_DEV_DUEL_SERVER_URL = "http://localhost:3001";
const DEFAULT_PROD_DUEL_SERVER_URL = "https://mememot-duel-server.onrender.com";
const DUEL_SERVER_URL =
  ENV_DUEL_SERVER_URL && ENV_DUEL_SERVER_URL.length > 0
    ? ENV_DUEL_SERVER_URL
    : import.meta.env.DEV
      ? DEFAULT_DEV_DUEL_SERVER_URL
      : DEFAULT_PROD_DUEL_SERVER_URL;
const DUEL_SESSION_STORAGE_KEY = "mememot_duel_session_v1";
const DUEL_NAME_STORAGE_KEY = "mememot_duel_name_v1";
const QUICK_CHAT_MESSAGES = ["Bonne chance", "Bien joue", "A toi", "GG"];
const MIN_MAX_ATTEMPTS_PER_PLAYER = 4;
const MAX_MAX_ATTEMPTS_PER_PLAYER = 12;

const sanitizeWord = (rawWord: string, maxLength: number) =>
  rawWord
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, maxLength);

const toTiles = (value: string, wordLength: number) =>
  Array.from({ length: wordLength }, (_, index) => value[index] ?? "");

const sanitizeRoomCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

const sanitizeRoomPassword = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);

const createDefaultName = () => `Joueur-${Math.floor(100 + Math.random() * 900)}`;

const loadStoredSession = (): DuelSession | null => {
  try {
    const rawValue = localStorage.getItem(DUEL_SESSION_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as Partial<DuelSession>;
    if (
      typeof parsed.roomCode !== "string" ||
      typeof parsed.playerId !== "string" ||
      typeof parsed.playerToken !== "string"
    ) {
      return null;
    }
    return {
      roomCode: sanitizeRoomCode(parsed.roomCode),
      playerId: parsed.playerId,
      playerToken: parsed.playerToken.trim(),
    };
  } catch {
    return null;
  }
};

const saveStoredSession = (session: DuelSession) => {
  localStorage.setItem(DUEL_SESSION_STORAGE_KEY, JSON.stringify(session));
};

const clearStoredSession = () => {
  localStorage.removeItem(DUEL_SESSION_STORAGE_KEY);
};

const loadStoredName = () => {
  const rawName = localStorage.getItem(DUEL_NAME_STORAGE_KEY);
  if (!rawName) {
    return null;
  }
  const trimmed = rawName.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 24) : null;
};

const formatClock = (isoDate: string) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.valueOf())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

function OnlineDuel() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState(() => loadStoredName() ?? createDefaultName());
  const [selectedWordLength, setSelectedWordLength] = useState<SupportedWordLength>(5);
  const [selectedMaxAttempts, setSelectedMaxAttempts] = useState(8);
  const [useRoomPassword, setUseRoomPassword] = useState(false);
  const [createRoomPassword, setCreateRoomPassword] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [joinRoomPassword, setJoinRoomPassword] = useState("");
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [duelState, setDuelState] = useState<DuelState | null>(null);
  const [secretWordInput, setSecretWordInput] = useState("");
  const [guessInput, setGuessInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Connecte-toi a un salon pour commencer le duel.",
  );
  const [statusTone, setStatusTone] = useState<"info" | "warn" | "success">("info");
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const myGuessInputRef = useRef<HTMLInputElement | null>(null);

  const pulseHaptic = (duration = 20) => {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(duration);
    }
  };

  useEffect(() => {
    const trimmed = displayName.trim();
    if (trimmed.length > 0) {
      localStorage.setItem(DUEL_NAME_STORAGE_KEY, trimmed.slice(0, 24));
    }
  }, [displayName]);

  useEffect(() => {
    const nextSocket = io(DUEL_SERVER_URL, {
      transports: ["websocket", "polling"],
    });

    setSocket(nextSocket);

    nextSocket.on("connect", () => {
      setConnected(true);

      const storedSession = loadStoredSession();
      if (!storedSession?.playerToken) {
        setStatusMessage("Connecte au serveur de duel.");
        setStatusTone("success");
        return;
      }

      setStatusMessage("Connexion etablie. Tentative de reprise de partie...");
      setStatusTone("info");
      nextSocket.emit(
        "duel:resume",
        { playerToken: storedSession.playerToken },
        (response: AckResponse) => {
          if (!response?.ok) {
            clearStoredSession();
            setMyPlayerId(null);
            setDuelState(null);
            setStatusMessage(
              response.message ?? "Session introuvable. Cree ou rejoins une nouvelle salle.",
            );
            setStatusTone("warn");
            return;
          }

          const nextRoomCode = response.roomCode ?? storedSession.roomCode;
          const nextPlayerId = response.playerId ?? storedSession.playerId;
          const nextPlayerToken = response.playerToken ?? storedSession.playerToken;

          saveStoredSession({
            roomCode: nextRoomCode,
            playerId: nextPlayerId,
            playerToken: nextPlayerToken,
          });
          setRoomCodeInput(nextRoomCode);
          setMyPlayerId(nextPlayerId);
          setStatusMessage(`Partie reprise dans la salle ${nextRoomCode}.`);
          setStatusTone("success");
        },
      );
    });

    nextSocket.on("disconnect", () => {
      setConnected(false);
      setStatusMessage("Connexion perdue. Reconnexion automatique en cours...");
      setStatusTone("warn");
    });

    nextSocket.on("duel:state", (nextState: DuelState) => {
      setDuelState(nextState);
      setRoomCodeInput(nextState.code);
      setSelectedWordLength(nextState.wordLength);
      setSelectedMaxAttempts(nextState.maxAttemptsPerPlayer);
    });

    nextSocket.on("duel:error", (payload: { message?: string }) => {
      setStatusMessage(payload.message ?? "Erreur serveur.");
      setStatusTone("warn");
    });

    return () => {
      nextSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!duelState || !myPlayerId) {
      return;
    }

    if (!duelState.players[myPlayerId]) {
      clearStoredSession();
      setMyPlayerId(null);
      setDuelState(null);
      setStatusMessage("Ta session n'est plus active dans cette salle.");
      setStatusTone("warn");
    }
  }, [duelState, myPlayerId]);

  useEffect(() => {
    if (!chatLogRef.current) {
      return;
    }
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [duelState?.chat.length]);

  const wordLength = duelState?.wordLength ?? selectedWordLength;
  const validWordSet = useMemo(() => new Set(VALID_WORDS_BY_LENGTH[wordLength]), [wordLength]);

  const players = useMemo(() => {
    if (!duelState) {
      return [];
    }
    return duelState.playerOrder
      .map((playerId) => duelState.players[playerId])
      .filter(Boolean);
  }, [duelState]);

  const myPlayer = useMemo(
    () => (myPlayerId && duelState ? duelState.players[myPlayerId] : undefined),
    [duelState, myPlayerId],
  );

  const opponentPlayer = useMemo(() => {
    if (!duelState || !myPlayerId) {
      return undefined;
    }
    const opponentId = duelState.playerOrder.find((playerId) => playerId !== myPlayerId);
    return opponentId ? duelState.players[opponentId] : undefined;
  }, [duelState, myPlayerId]);

  const isMyTurn =
    Boolean(duelState) &&
    duelState?.phase === "playing" &&
    duelState.turnPlayerId === myPlayerId;

  const myGuesses = myPlayerId && duelState ? duelState.guessesByPlayer[myPlayerId] ?? [] : [];
  const chatMessages = duelState?.chat ?? [];
  const reconnectSeconds = duelState?.reconnectGraceMs
    ? Math.round(duelState.reconnectGraceMs / 1000)
    : 90;
  const maxAttemptsPerPlayer = duelState?.maxAttemptsPerPlayer ?? selectedMaxAttempts;
  const myRemainingAttempts = Math.max(0, maxAttemptsPerPlayer - myGuesses.length);
  const myRematchRequested =
    Boolean(myPlayerId && duelState?.rematchRequestsByPlayer?.[myPlayerId]);
  const opponentRematchRequested = Boolean(
    myPlayerId &&
      duelState?.playerOrder
        ?.filter((id) => id !== myPlayerId)
        .some((id) => duelState.rematchRequestsByPlayer?.[id]),
  );
  const rowTilesStyle = {
    ["--letters" as string]: duelState?.wordLength ?? selectedWordLength,
  } as CSSProperties;

  useEffect(() => {
    if (!isMyTurn) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      myGuessInputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timeoutId);
  }, [isMyTurn, myGuesses.length, duelState?.phase, duelState?.wordLength]);

  const createRoom = () => {
    if (!socket) {
      return;
    }

    const roomPassword = useRoomPassword ? sanitizeRoomPassword(createRoomPassword) : "";
    if (useRoomPassword && roomPassword.length < 4) {
      setStatusMessage("Le mot de passe de la salle doit faire au moins 4 caracteres.");
      setStatusTone("warn");
      return;
    }

    socket.emit(
      "duel:create-room",
      {
        playerName: displayName,
        wordLength: selectedWordLength,
        maxAttemptsPerPlayer: selectedMaxAttempts,
        roomPassword,
      },
      (response: AckResponse) => {
        if (!response?.ok) {
          setStatusMessage(response.message);
          setStatusTone("warn");
          return;
        }

        const roomCode = response.roomCode ?? "";
        const playerId = response.playerId ?? "";
        const playerToken = response.playerToken ?? "";

        if (roomCode && playerId && playerToken) {
          saveStoredSession({ roomCode, playerId, playerToken });
        }

        setMyPlayerId(playerId || null);
        setRoomCodeInput(roomCode);
        setSecretWordInput("");
        setGuessInput("");
        setChatInput("");
        setJoinRoomPassword("");
        setStatusMessage(
          `Salon prive cree: ${roomCode}. ${response.hasPassword ? "Mot de passe actif." : "Partage le code."}`,
        );
        setStatusTone("success");
        pulseHaptic(24);
      },
    );
  };

  const joinRoom = () => {
    if (!socket) {
      return;
    }

    const code = sanitizeRoomCode(roomCodeInput);
    const roomPassword = sanitizeRoomPassword(joinRoomPassword);
    if (code.length < 4) {
      setStatusMessage("Entre un code de salon valide.");
      setStatusTone("warn");
      return;
    }

    socket.emit(
      "duel:join-room",
      { roomCode: code, playerName: displayName, roomPassword },
      (response: AckResponse) => {
        if (!response?.ok) {
          setStatusMessage(response.message);
          setStatusTone("warn");
          return;
        }

        const roomCode = response.roomCode ?? code;
        const playerId = response.playerId ?? "";
        const playerToken = response.playerToken ?? "";

        if (roomCode && playerId && playerToken) {
          saveStoredSession({ roomCode, playerId, playerToken });
        }

        setMyPlayerId(playerId || null);
        setRoomCodeInput(roomCode);
        setSecretWordInput("");
        setGuessInput("");
        setChatInput("");
        setCreateRoomPassword("");
        setUseRoomPassword(false);
        setStatusMessage(`Connecte au salon ${roomCode}.`);
        setStatusTone("success");
        pulseHaptic(16);
      },
    );
  };

  const submitSecretWordAction = () => {
    if (!socket || !duelState) {
      return;
    }

    const sanitized = sanitizeWord(secretWordInput, duelState.wordLength);
    if (sanitized.length !== duelState.wordLength) {
      setStatusMessage(`Ton mot secret doit faire ${duelState.wordLength} lettres.`);
      setStatusTone("warn");
      return;
    }

    if (!validWordSet.has(sanitized)) {
      setStatusMessage("Ce mot n'existe pas dans le dictionnaire.");
      setStatusTone("warn");
      return;
    }

    socket.emit("duel:set-secret-word", { word: sanitized }, (response: AckResponse) => {
      if (!response?.ok) {
        setStatusMessage(response.message);
        setStatusTone("warn");
        return;
      }

      setStatusMessage("Mot secret enregistre. En attente de l'autre joueur.");
      setStatusTone("success");
      pulseHaptic(10);
    });
  };

  const submitSecretWord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitSecretWordAction();
  };

  const submitGuessAction = () => {
    if (!socket || !duelState) {
      return;
    }

    if (!isMyTurn) {
      setStatusMessage("Ce n'est pas ton tour.");
      setStatusTone("warn");
      return;
    }

    const sanitized = sanitizeWord(guessInput, duelState.wordLength);
    if (sanitized.length !== duelState.wordLength) {
      setStatusMessage(`Ton essai doit faire ${duelState.wordLength} lettres.`);
      setStatusTone("warn");
      return;
    }

    if (!validWordSet.has(sanitized)) {
      setStatusMessage("Mot invalide pour le dictionnaire.");
      setStatusTone("warn");
      return;
    }

    socket.emit("duel:submit-guess", { guess: sanitized }, (response: AckResponse) => {
      if (!response?.ok) {
        setStatusMessage(response.message);
        setStatusTone("warn");
        return;
      }

      setGuessInput("");
      if (typeof response.exactCount === "number") {
        const remainingText =
          typeof response.remainingAttempts === "number"
            ? ` | Essais restants: ${response.remainingAttempts}/${response.maxAttemptsPerPlayer ?? duelState.maxAttemptsPerPlayer}`
            : "";
        setStatusMessage(
          `Essai envoye: ${response.exactCount}/${duelState.wordLength} bien placees.${remainingText}`,
        );
      } else {
        setStatusMessage("Essai envoye.");
      }
      setStatusTone("info");
      pulseHaptic(12);
    });
  };

  const onGuessInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!duelState || duelState.phase !== "playing" || !isMyTurn || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitGuessAction();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setGuessInput("");
      return;
    }
  };

  const focusGuessInput = () => {
    if (duelState?.phase === "playing" && isMyTurn) {
      myGuessInputRef.current?.focus();
    }
  };

  const requestRematch = () => {
    if (!socket || !duelState) {
      return;
    }

    socket.emit("duel:request-rematch", {}, (response: AckResponse) => {
      if (!response?.ok) {
        setStatusMessage(response.message);
        setStatusTone("warn");
        return;
      }

      if (response.started) {
        setStatusMessage("Revanche lancee. Choisissez vos mots secrets.");
        setStatusTone("success");
        pulseHaptic(30);
      } else {
        setStatusMessage("Demande de revanche envoyee. En attente de l'adversaire.");
        setStatusTone("info");
      }
    });
  };

  const cancelRematch = () => {
    if (!socket || !duelState) {
      return;
    }

    socket.emit("duel:cancel-rematch", {}, (response: AckResponse) => {
      if (!response?.ok) {
        setStatusMessage(response.message);
        setStatusTone("warn");
        return;
      }

      setStatusMessage("Demande de revanche annulee.");
      setStatusTone("info");
    });
  };

  const sendChatMessage = (rawMessage: string) => {
    if (!socket || !duelState) {
      return;
    }

    const text = rawMessage.replace(/\s+/g, " ").trim().slice(0, 180);
    if (text.length === 0) {
      return;
    }

    socket.emit("duel:chat-send", { message: text }, (response: AckResponse) => {
      if (!response?.ok) {
        setStatusMessage(response.message);
        setStatusTone("warn");
        return;
      }

      setChatInput("");
    });
  };

  const submitChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendChatMessage(chatInput);
  };

  const leaveRoom = () => {
    if (!socket) {
      return;
    }

    socket.emit("duel:leave-room", {}, () => {
      clearStoredSession();
      setDuelState(null);
      setMyPlayerId(null);
      setSecretWordInput("");
      setGuessInput("");
      setChatInput("");
      setCreateRoomPassword("");
      setJoinRoomPassword("");
      setUseRoomPassword(false);
      setStatusMessage("Tu as quitte le salon.");
      setStatusTone("info");
    });
  };

  const copyRoomCode = async () => {
    if (!duelState?.code) {
      return;
    }

    try {
      await navigator.clipboard.writeText(duelState.code);
      setStatusMessage(`Code ${duelState.code} copie dans le presse-papiers.`);
      setStatusTone("success");
      pulseHaptic(14);
    } catch {
      setStatusMessage("Impossible de copier le code automatiquement.");
      setStatusTone("warn");
    }
  };

  const winnerName = duelState?.winnerId ? duelState.players[duelState.winnerId]?.name : null;
  const turnPlayerName = duelState?.turnPlayerId
    ? duelState.players[duelState.turnPlayerId]?.name
    : null;

  return (
    <div className="app duel-app">
      <header className="hero">
        <p className="hero__eyebrow">Multijoueur en ligne</p>
        <h1 className="hero__title">Duel MemeMot</h1>
        <p className="hero__subtitle">
          Chaque joueur choisit son mot secret. Vous jouez chacun votre tour,
          et le premier qui trouve gagne.
        </p>
      </header>

      <main className="duel-layout">
        <section className="duel-card">
          <h2>Connexion</h2>
          <p className={`duel-status duel-status--${statusTone}`}>{statusMessage}</p>
          <p className="duel-meta">
            Serveur: <strong>{DUEL_SERVER_URL}</strong> | Etat:{" "}
            <strong>{connected ? "connecte" : "deconnecte"}</strong>
          </p>

          <label className="duel-label" htmlFor="player-name">
            Ton pseudo
          </label>
          <input
            id="player-name"
            className="duel-input"
            type="text"
            value={displayName}
            maxLength={24}
            onChange={(event) => setDisplayName(event.target.value)}
          />

          {!duelState && (
            <>
              <label className="duel-label" htmlFor="create-word-length">
                Regles custom (partie privee)
              </label>
              <div className="duel-actions">
                <select
                  id="create-word-length"
                  className="duel-select"
                  value={selectedWordLength}
                  onChange={(event) =>
                    setSelectedWordLength(Number(event.target.value) as SupportedWordLength)
                  }
                >
                  <option value={5}>Mots de 5 lettres</option>
                  <option value={6}>Mots de 6 lettres</option>
                  <option value={7}>Mots de 7 lettres</option>
                </select>
                <select
                  className="duel-select"
                  value={selectedMaxAttempts}
                  onChange={(event) =>
                    setSelectedMaxAttempts(
                      Math.max(
                        MIN_MAX_ATTEMPTS_PER_PLAYER,
                        Math.min(
                          MAX_MAX_ATTEMPTS_PER_PLAYER,
                          Number(event.target.value) || MIN_MAX_ATTEMPTS_PER_PLAYER,
                        ),
                      ),
                    )
                  }
                >
                  {Array.from(
                    {
                      length:
                        MAX_MAX_ATTEMPTS_PER_PLAYER - MIN_MAX_ATTEMPTS_PER_PLAYER + 1,
                    },
                    (_, index) => MIN_MAX_ATTEMPTS_PER_PLAYER + index,
                  ).map((attemptCount) => (
                    <option key={attemptCount} value={attemptCount}>
                      {attemptCount} essais max / joueur
                    </option>
                  ))}
                </select>
              </div>

              <label className="toggle">
                <input
                  type="checkbox"
                  checked={useRoomPassword}
                  onChange={(event) => setUseRoomPassword(event.target.checked)}
                />
                <span>Activer un mot de passe de salle</span>
              </label>

              {useRoomPassword && (
                <input
                  className="duel-input"
                  type="text"
                  placeholder="Mot de passe (4-12 caracteres)"
                  value={createRoomPassword}
                  maxLength={12}
                  onChange={(event) =>
                    setCreateRoomPassword(sanitizeRoomPassword(event.target.value))
                  }
                />
              )}

              <div className="duel-actions duel-actions--single">
                <button type="button" className="duel-btn" onClick={createRoom}>
                  Creer une partie privee
                </button>
              </div>

              <label className="duel-label">Rejoindre une partie privee</label>
              <div className="duel-actions duel-actions--triple">
                <input
                  className="duel-input"
                  type="text"
                  placeholder="Code salon"
                  value={roomCodeInput}
                  maxLength={6}
                  onChange={(event) => setRoomCodeInput(sanitizeRoomCode(event.target.value))}
                />
                <input
                  className="duel-input"
                  type="text"
                  placeholder="Mot de passe (si active)"
                  value={joinRoomPassword}
                  maxLength={12}
                  onChange={(event) =>
                    setJoinRoomPassword(sanitizeRoomPassword(event.target.value))
                  }
                />
                <button type="button" className="duel-btn duel-btn--secondary" onClick={joinRoom}>
                  Rejoindre
                </button>
              </div>
            </>
          )}
        </section>

        {duelState && (
          <>
            <section className="duel-card">
              <div className="duel-room-head">
                <h2>Salle {duelState.code}</h2>
                <div className="duel-room-actions">
                  <button type="button" className="duel-btn duel-btn--ghost" onClick={copyRoomCode}>
                    Copier code
                  </button>
                  <button type="button" className="duel-btn duel-btn--ghost" onClick={leaveRoom}>
                    Quitter
                  </button>
                </div>
              </div>
              <p className="duel-meta">
                Phase: <strong>{duelState.phase}</strong> | Mot de{" "}
                <strong>{duelState.wordLength}</strong> lettres | Essais max:{" "}
                <strong>{duelState.maxAttemptsPerPlayer}</strong> / joueur
              </p>
              <p className="duel-meta">
                Reconnexion auto: <strong>{reconnectSeconds}s</strong> de delai avant retrait.
                {duelState.hasPassword ? " | Salle protegee par mot de passe." : ""}
              </p>

              <ul className="duel-players">
                {players.map((player) => (
                  <li key={player.id}>
                    <span>
                      {player.name}
                      {player.id === myPlayerId ? " (toi)" : ""}
                    </span>
                    <strong>
                      {player.connected ? "En ligne" : "Hors ligne"} |{" "}
                      {player.ready ? "Pret" : "Pas pret"} | {player.guessesCount}/
                      {duelState.maxAttemptsPerPlayer} essai(s)
                    </strong>
                  </li>
                ))}
              </ul>

              {duelState.phase === "waiting" && (
                <p className="duel-note">En attente d'un deuxieme joueur.</p>
              )}

              {duelState.phase === "choosing" && (
                <form className="duel-form" onSubmit={submitSecretWord}>
                  <label className="duel-label" htmlFor="secret-word">
                    Choisis ton mot secret ({duelState.wordLength} lettres)
                  </label>
                  <div className="duel-actions">
                    <WordGridInput
                      id="secret-word"
                      value={secretWordInput}
                      onChange={setSecretWordInput}
                      length={duelState.wordLength}
                      placeholder={`Mot de ${duelState.wordLength} lettres`}
                      onSubmit={submitSecretWordAction}
                      disabled={Boolean(myPlayer?.ready)}
                      autoFocus={!myPlayer?.ready}
                    />
                    <button type="submit" className="duel-btn" disabled={myPlayer?.ready}>
                      {myPlayer?.ready ? "Deja valide" : "Valider mon mot"}
                    </button>
                  </div>
                </form>
              )}

              {duelState.phase === "playing" && (
                <>
                  <p className="duel-turn">
                    Tour de: <strong>{turnPlayerName ?? "-"}</strong>{" "}
                    {isMyTurn ? "(a toi de jouer)" : ""}
                  </p>
                  <p className="duel-note">
                    Ecris directement dans la grille "Mes essais". Tes essais restants:{" "}
                    <strong>{myRemainingAttempts}</strong> / {duelState.maxAttemptsPerPlayer}
                  </p>
                </>
              )}

              {duelState.phase === "finished" && (
                <div className="duel-finished">
                  <p className="duel-result">
                    Partie finie.{" "}
                    {winnerName ? (
                      <>
                        Gagnant: <strong>{winnerName}</strong>
                      </>
                    ) : (
                      <>
                        Resultat: <strong>Egalite</strong>
                      </>
                    )}
                  </p>

                  <div className="duel-rematch">
                    <button
                      type="button"
                      className="duel-btn"
                      onClick={requestRematch}
                      disabled={myRematchRequested}
                    >
                      {myRematchRequested ? "Revanche demandee" : "Demander revanche"}
                    </button>
                    {myRematchRequested && (
                      <button
                        type="button"
                        className="duel-btn duel-btn--ghost"
                        onClick={cancelRematch}
                      >
                        Annuler
                      </button>
                    )}
                  </div>

                  <p className="duel-note">
                    Etat revanche: toi {myRematchRequested ? "pret" : "en attente"} | adversaire{" "}
                    {opponentRematchRequested ? "pret" : "en attente"}
                  </p>
                </div>
              )}
            </section>

            <section className="duel-card">
              <h2>Historique</h2>
              <p className="duel-meta">
                Tu affrontes <strong>{opponentPlayer?.name ?? "..."}</strong>
              </p>

              <div
                className="duel-grid-board"
                onMouseDown={focusGuessInput}
                onTouchStart={focusGuessInput}
              >
                <h3>Mes essais</h3>
                <input
                  ref={myGuessInputRef}
                  className="grid-capture-input"
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={wordLength}
                  value={guessInput}
                  onChange={(event) => setGuessInput(sanitizeWord(event.target.value, wordLength))}
                  onKeyDown={onGuessInputKeyDown}
                  disabled={!isMyTurn || duelState.phase !== "playing"}
                  aria-label="Saisie de mes essais en ligne"
                />
                <div className="grid">
                  {myGuesses.map((guess, rowIndex) => (
                    <div className="row row--past" key={`${guess.guess}-${rowIndex}`}>
                      <div className="row__tiles" style={rowTilesStyle}>
                        {toTiles(guess.guess, duelState.wordLength).map((letter, index) => (
                          <div className="tile tile--masked" key={`${rowIndex}-${index}`}>
                            {letter}
                          </div>
                        ))}
                      </div>
                      <span className="row__score">
                        {guess.exactCount}/{guess.wordLength}
                      </span>
                    </div>
                  ))}

                  {duelState.phase === "playing" && (
                    <div className="row row--current">
                      <div className="row__tiles" style={rowTilesStyle}>
                        {toTiles(guessInput, duelState.wordLength).map((letter, index) => (
                          <div
                            className={`tile ${letter ? "tile--typing" : "tile--idle"}`}
                            key={`online-current-${index}`}
                          >
                            {letter}
                          </div>
                        ))}
                      </div>
                      <span className="row__score">en cours</span>
                    </div>
                  )}
                </div>

                {myGuesses.length === 0 && duelState.phase !== "playing" && (
                  <p className="duel-note">Aucun essai pour l'instant.</p>
                )}

                {duelState.phase === "playing" && (
                  <button
                    type="button"
                    className="floating-validate-btn floating-validate-btn--duel"
                    onClick={submitGuessAction}
                    disabled={!isMyTurn}
                  >
                    Valider
                  </button>
                )}
              </div>

              {duelState.phase === "playing" && (
                <div className="duel-mobile-actions">
                  <button
                    type="button"
                    className="duel-btn"
                    onClick={submitGuessAction}
                    disabled={!isMyTurn}
                  >
                    Valider
                  </button>
                  <button
                    type="button"
                    className="duel-btn duel-btn--ghost"
                    onClick={focusGuessInput}
                  >
                    Ecrire
                  </button>
                </div>
              )}
            </section>

            <section className="duel-card duel-chat">
              <h2>Chat rapide</h2>
              <div className="duel-chat__log" ref={chatLogRef}>
                {chatMessages.length === 0 ? (
                  <p className="duel-note">Aucun message pour le moment.</p>
                ) : (
                  <ul className="duel-chat__list">
                    {chatMessages.map((message) => {
                      const mine = message.senderId === myPlayerId;
                      const system = message.senderId === null;
                      return (
                        <li
                          key={message.id}
                          className={`duel-chat__item ${
                            system
                              ? "duel-chat__item--system"
                              : mine
                                ? "duel-chat__item--mine"
                                : "duel-chat__item--other"
                          }`}
                        >
                          <div className="duel-chat__meta">
                            <strong>{system ? "Systeme" : message.senderName}</strong>
                            <span>{formatClock(message.createdAt)}</span>
                          </div>
                          <p>{message.text}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="duel-chat__quick">
                {QUICK_CHAT_MESSAGES.map((text) => (
                  <button
                    key={text}
                    type="button"
                    className="duel-btn duel-btn--ghost"
                    onClick={() => sendChatMessage(text)}
                  >
                    {text}
                  </button>
                ))}
              </div>

              <form className="duel-form" onSubmit={submitChat}>
                <div className="duel-actions">
                  <input
                    className="duel-input"
                    type="text"
                    placeholder="Ecrire un message rapide"
                    value={chatInput}
                    maxLength={180}
                    onChange={(event) => setChatInput(event.target.value)}
                  />
                  <button type="submit" className="duel-btn">
                    Envoyer
                  </button>
                </div>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default OnlineDuel;
