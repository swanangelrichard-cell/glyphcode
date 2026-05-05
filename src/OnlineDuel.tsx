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
  phase: DuelPhase;
  winnerId: string | null;
  turnPlayerId: string | null;
  playerOrder: string[];
  players: Record<string, DuelPlayer>;
  guessesByPlayer: Record<string, DuelGuess[]>;
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
      exactCount?: number;
      resumed?: boolean;
      message?: string;
    }
  | { ok: false; message: string };

type DuelSession = {
  roomCode: string;
  playerId: string;
  playerToken: string;
};

const DUEL_SERVER_URL =
  (import.meta.env.VITE_DUEL_SERVER_URL as string | undefined) ?? "http://localhost:3001";
const DUEL_SESSION_STORAGE_KEY = "mememot_duel_session_v1";
const DUEL_NAME_STORAGE_KEY = "mememot_duel_name_v1";
const QUICK_CHAT_MESSAGES = ["Bonne chance", "Bien joue", "A toi", "GG"];

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
  const [roomCodeInput, setRoomCodeInput] = useState("");
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

    socket.emit(
      "duel:create-room",
      { playerName: displayName, wordLength: selectedWordLength },
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
        setStatusMessage(`Salon cree: ${roomCode}. Partage ce code.`);
        setStatusTone("success");
      },
    );
  };

  const joinRoom = () => {
    if (!socket) {
      return;
    }

    const code = sanitizeRoomCode(roomCodeInput);
    if (code.length < 4) {
      setStatusMessage("Entre un code de salon valide.");
      setStatusTone("warn");
      return;
    }

    socket.emit(
      "duel:join-room",
      { roomCode: code, playerName: displayName },
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
        setStatusMessage(`Connecte au salon ${roomCode}.`);
        setStatusTone("success");
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
        setStatusMessage(`Essai envoye: ${response.exactCount}/${duelState.wordLength} bien placees.`);
      } else {
        setStatusMessage("Essai envoye.");
      }
      setStatusTone("info");
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
      setStatusMessage("Tu as quitte le salon.");
      setStatusTone("info");
    });
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
              <div className="duel-actions">
                <select
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
                <button type="button" className="duel-btn" onClick={createRoom}>
                  Creer un salon
                </button>
              </div>

              <div className="duel-actions">
                <input
                  className="duel-input"
                  type="text"
                  placeholder="Code salon"
                  value={roomCodeInput}
                  maxLength={6}
                  onChange={(event) => setRoomCodeInput(sanitizeRoomCode(event.target.value))}
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
                <button type="button" className="duel-btn duel-btn--ghost" onClick={leaveRoom}>
                  Quitter
                </button>
              </div>
              <p className="duel-meta">
                Phase: <strong>{duelState.phase}</strong> | Mot de{" "}
                <strong>{duelState.wordLength}</strong> lettres
              </p>
              <p className="duel-meta">
                Reconnexion auto: <strong>{reconnectSeconds}s</strong> de delai avant retrait.
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
                      {player.ready ? "Pret" : "Pas pret"} | {player.guessesCount} essai(s)
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
                  <p className="duel-note">Ecris directement dans la grille "Mes essais".</p>
                </>
              )}

              {duelState.phase === "finished" && (
                <p className="duel-result">
                  Partie finie. Gagnant: <strong>{winnerName ?? "Inconnu"}</strong>
                </p>
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
