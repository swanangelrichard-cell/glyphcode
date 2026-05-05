import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  SECRET_WORDS_BY_LENGTH,
  SupportedWordLength,
  VALID_WORDS_BY_LENGTH,
} from "./wordBank";

const STATS_STORAGE_KEY = "mememot_stats_v1";

type GameState = "playing" | "won" | "lost";
type BannerTone = "info" | "success" | "warn";
type Difficulty = "normal" | "expert" | "long";

type DifficultyConfig = {
  label: string;
  maxAttempts: number;
  wordLength: SupportedWordLength;
  description: string;
  lockExactHints: boolean;
};

type Attempt = {
  guess: string;
  matchMask: boolean[];
  exactCount: number;
};

type RowModel = {
  id: number;
  letters: string[];
  kind: "past" | "current" | "future";
  matchMask: boolean[];
  scoreLabel: string;
};

type PlayerStats = {
  played: number;
  wins: number;
  streak: number;
  bestStreak: number;
};

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  normal: {
    label: "Normal",
    maxAttempts: 8,
    wordLength: 5,
    description: "8 essais et mots de 5 lettres.",
    lockExactHints: false,
  },
  expert: {
    label: "Expert",
    maxAttempts: 6,
    wordLength: 5,
    description: "6 essais et indices visuels desactives.",
    lockExactHints: true,
  },
  long: {
    label: "Long",
    maxAttempts: 8,
    wordLength: 7,
    description: "Mots plus longs (7 lettres) avec 8 essais.",
    lockExactHints: false,
  },
};

const DEFAULT_STATS: PlayerStats = {
  played: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
};

const DIFFICULTY_ORDER: Difficulty[] = ["normal", "expert", "long"];

const VALID_GUESS_SETS: Record<SupportedWordLength, ReadonlySet<string>> = {
  5: new Set(VALID_WORDS_BY_LENGTH[5]),
  6: new Set(VALID_WORDS_BY_LENGTH[6]),
  7: new Set(VALID_WORDS_BY_LENGTH[7]),
};

const pickSecretWord = (wordLength: SupportedWordLength) => {
  const preferredPool = SECRET_WORDS_BY_LENGTH[wordLength];
  const fullPool = VALID_WORDS_BY_LENGTH[wordLength];
  const pool = preferredPool.length > 0 ? preferredPool : fullPool;

  return pool[Math.floor(Math.random() * pool.length)];
};

const sanitizeTyping = (raw: string) =>
  raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();

const toTiles = (value: string, wordLength: number) =>
  Array.from({ length: wordLength }, (_, index) => value[index] ?? "");

const evaluateGuess = (guess: string, secretWord: string, wordLength: number): Attempt => {
  const matchMask = Array.from(
    { length: wordLength },
    (_, index) => guess[index] === secretWord[index],
  );
  const exactCount = matchMask.filter(Boolean).length;
  return { guess, matchMask, exactCount };
};

const readStatsFromStorage = (): PlayerStats => {
  if (typeof window === "undefined") {
    return DEFAULT_STATS;
  }

  try {
    const raw = window.localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STATS;
    }

    const parsed = JSON.parse(raw) as Partial<PlayerStats>;
    const played = Number.isInteger(parsed.played) && parsed.played! >= 0 ? parsed.played! : 0;
    const winsRaw = Number.isInteger(parsed.wins) && parsed.wins! >= 0 ? parsed.wins! : 0;
    const wins = Math.min(winsRaw, played);
    const streak = Number.isInteger(parsed.streak) && parsed.streak! >= 0 ? parsed.streak! : 0;
    const bestStreakRaw =
      Number.isInteger(parsed.bestStreak) && parsed.bestStreak! >= 0 ? parsed.bestStreak! : 0;
    const bestStreak = Math.max(bestStreakRaw, streak);

    return { played, wins, streak, bestStreak };
  } catch {
    return DEFAULT_STATS;
  }
};

function SoloGame() {
  const boardInputRef = useRef<HTMLInputElement | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [secretWord, setSecretWord] = useState<string>(() =>
    pickSecretWord(DIFFICULTY_CONFIG.normal.wordLength),
  );
  const [currentGuess, setCurrentGuess] = useState("");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [showExactHints, setShowExactHints] = useState(false);
  const [stats, setStats] = useState<PlayerStats>(() => readStatsFromStorage());
  const [gameState, setGameState] = useState<GameState>("playing");
  const [statusMessage, setStatusMessage] = useState(
    "Trouve le mot de 5 lettres puis valide avec Entree.",
  );
  const [bannerTone, setBannerTone] = useState<BannerTone>("info");
  const [recentValidatedRow, setRecentValidatedRow] = useState<number | null>(null);
  const [isShakingInvalidGuess, setIsShakingInvalidGuess] = useState(false);

  const difficultyMeta = DIFFICULTY_CONFIG[difficulty];
  const wordLength = difficultyMeta.wordLength;
  const maxAttempts = difficultyMeta.maxAttempts;
  const remainingAttempts = maxAttempts - attempts.length;
  const progress = (attempts.length / maxAttempts) * 100;
  const winRate = stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
  const validWordCount = VALID_WORDS_BY_LENGTH[wordLength].length;
  const rowTilesStyle = { ["--letters" as string]: wordLength } as CSSProperties;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    if (recentValidatedRow === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRecentValidatedRow(null);
    }, 380);

    return () => window.clearTimeout(timeoutId);
  }, [recentValidatedRow]);

  useEffect(() => {
    if (!isShakingInvalidGuess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsShakingInvalidGuess(false);
    }, 360);

    return () => window.clearTimeout(timeoutId);
  }, [isShakingInvalidGuess]);

  useEffect(() => {
    if (gameState !== "playing") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      boardInputRef.current?.focus();
    }, 20);

    return () => window.clearTimeout(timeoutId);
  }, [gameState, attempts.length, difficulty]);

  const rows = useMemo<RowModel[]>(
    () =>
      Array.from({ length: maxAttempts }, (_, rowIndex) => {
        if (rowIndex < attempts.length) {
          const attempt = attempts[rowIndex];
          return {
            id: rowIndex,
            letters: toTiles(attempt.guess, wordLength),
            kind: "past",
            matchMask: attempt.matchMask,
            scoreLabel: `${attempt.exactCount}/${wordLength}`,
          };
        }

        if (rowIndex === attempts.length && gameState === "playing") {
          return {
            id: rowIndex,
            letters: toTiles(currentGuess, wordLength),
            kind: "current",
            matchMask: Array.from({ length: wordLength }, () => false),
            scoreLabel: "",
          };
        }

        return {
          id: rowIndex,
          letters: toTiles("", wordLength),
          kind: "future",
          matchMask: Array.from({ length: wordLength }, () => false),
          scoreLabel: "",
        };
      }),
    [attempts, currentGuess, gameState, maxAttempts, wordLength],
  );

  const history = [...attempts].reverse();

  const triggerInvalidShake = () => {
    setIsShakingInvalidGuess(false);
    window.setTimeout(() => {
      setIsShakingInvalidGuess(true);
    }, 10);
  };

  const registerGameResult = (won: boolean) => {
    setStats((previous) => {
      const nextPlayed = previous.played + 1;
      const nextWins = previous.wins + (won ? 1 : 0);
      const nextStreak = won ? previous.streak + 1 : 0;
      const nextBestStreak = won
        ? Math.max(previous.bestStreak, nextStreak)
        : previous.bestStreak;

      return {
        played: nextPlayed,
        wins: nextWins,
        streak: nextStreak,
        bestStreak: nextBestStreak,
      };
    });
  };

  const startNewGame = (mode: Difficulty, message: string) => {
    const modeConfig = DIFFICULTY_CONFIG[mode];

    if (modeConfig.lockExactHints) {
      setShowExactHints(false);
    }

    setSecretWord(pickSecretWord(modeConfig.wordLength));
    setCurrentGuess("");
    setAttempts([]);
    setGameState("playing");
    setStatusMessage(message);
    setBannerTone("info");
    setRecentValidatedRow(null);
    setIsShakingInvalidGuess(false);
  };

  const onChangeDifficulty = (nextMode: Difficulty) => {
    if (nextMode === difficulty) {
      return;
    }

    setDifficulty(nextMode);
    const config = DIFFICULTY_CONFIG[nextMode];
    startNewGame(
      nextMode,
      `Mode ${config.label} actif : ${config.maxAttempts} essais, mot de ${config.wordLength} lettres.`,
    );
  };

  const submitGuess = () => {
    if (gameState !== "playing") {
      setStatusMessage("Partie terminee. Clique sur Rejouer pour recommencer.");
      setBannerTone("warn");
      return;
    }

    if (currentGuess.length !== wordLength) {
      setStatusMessage(`Ton mot doit contenir exactement ${wordLength} lettres.`);
      setBannerTone("warn");
      return;
    }

    if (!VALID_GUESS_SETS[wordLength].has(currentGuess)) {
      triggerInvalidShake();
      setStatusMessage("Mot invalide pour le dictionnaire. Essaie un autre mot.");
      setBannerTone("warn");
      return;
    }

    const attempt = evaluateGuess(currentGuess, secretWord, wordLength);
    const nextAttempts = [...attempts, attempt];
    const submittedRow = attempts.length;

    setAttempts(nextAttempts);
    setCurrentGuess("");
    setRecentValidatedRow(submittedRow);

    if (attempt.exactCount === wordLength) {
      registerGameResult(true);
      setGameState("won");
      setStatusMessage(`Excellent ! Mot trouve en ${nextAttempts.length} essai(s).`);
      setBannerTone("success");
      return;
    }

    if (nextAttempts.length >= maxAttempts) {
      registerGameResult(false);
      setGameState("lost");
      setStatusMessage(`Plus d'essais. Le mot etait ${secretWord}.`);
      setBannerTone("warn");
      return;
    }

    setStatusMessage(`${attempt.exactCount}/${wordLength} lettre(s) bien placee(s).`);
    setBannerTone("info");
  };

  const onBoardInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (gameState !== "playing" || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitGuess();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setCurrentGuess("");
      return;
    }
  };

  const focusBoardInput = () => {
    if (gameState === "playing") {
      boardInputRef.current?.focus();
    }
  };

  const onReset = () => {
    startNewGame(
      difficulty,
      `Nouvelle partie en mode ${difficultyMeta.label} (${wordLength} lettres).`,
    );
  };

  const onResetStats = () => {
    setStats(DEFAULT_STATS);
    setStatusMessage("Statistiques remises a zero.");
    setBannerTone("info");
  };

  return (
    <div className="app">
      <div className="bg-shape bg-shape--left" />
      <div className="bg-shape bg-shape--right" />

      <header className="hero">
        <p className="hero__eyebrow">Prototype React + TypeScript</p>
        <h1 className="hero__title">MemeMot</h1>
        <p className="hero__subtitle">
          Trois modes: 6 essais expert, sans indices visuels, et mots plus longs.
        </p>
      </header>

      <main className="layout">
        <section
          className={`board-card board-card--typing ${isShakingInvalidGuess ? "board-card--shake" : ""}`}
          onMouseDown={focusBoardInput}
          onTouchStart={focusBoardInput}
          aria-label="grille des essais"
        >
          <input
            ref={boardInputRef}
            className="grid-capture-input"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={wordLength}
            value={currentGuess}
            onChange={(event) => setCurrentGuess(sanitizeTyping(event.target.value).slice(0, wordLength))}
            onKeyDown={onBoardInputKeyDown}
            disabled={gameState !== "playing"}
            aria-label="Saisie des essais"
          />
          <div className="board-card__header">
            <h2>Grille des essais</h2>
            <span>
              {attempts.length} / {maxAttempts} ({difficultyMeta.label})
            </span>
          </div>

          <div className="grid">
            {rows.map((row) => (
              <div
                className={`row row--${row.kind} ${
                  row.id === recentValidatedRow ? "row--submitted" : ""
                }`}
                key={row.id}
              >
                <div className="row__tiles" style={rowTilesStyle}>
                  {row.letters.map((letter, index) => {
                    const tileStyle = {
                      ["--tile-index" as string]: index,
                    } as CSSProperties;

                    const variant =
                      row.kind === "past"
                        ? showExactHints
                          ? row.matchMask[index]
                            ? "tile--exact"
                            : "tile--off"
                          : "tile--masked"
                        : row.kind === "current" && letter
                          ? "tile--typing"
                          : "tile--idle";

                    return (
                      <div
                        className={`tile ${variant}`}
                        key={`${row.id}-${index}`}
                        style={tileStyle}
                      >
                        {letter}
                      </div>
                    );
                  })}
                </div>
                <span className="row__score">{row.scoreLabel}</span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="floating-validate-btn"
            onClick={submitGuess}
            disabled={gameState !== "playing"}
          >
            Valider
          </button>
        </section>

        <aside className="panel-card">
          <p className={`status status--${bannerTone}`}>{statusMessage}</p>

          <section className="difficulty">
            <p className="difficulty__label">Difficulte</p>
            <div className="difficulty__group">
              {DIFFICULTY_ORDER.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`difficulty__chip ${
                    difficulty === mode ? "difficulty__chip--active" : ""
                  }`}
                  onClick={() => onChangeDifficulty(mode)}
                >
                  {DIFFICULTY_CONFIG[mode].label}
                </button>
              ))}
            </div>
            <p className="difficulty__hint">{difficultyMeta.description}</p>
          </section>

          <div className="options">
            <label
              className={`toggle ${
                difficultyMeta.lockExactHints ? "toggle--disabled" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={showExactHints}
                onChange={(event) => setShowExactHints(event.target.checked)}
                disabled={difficultyMeta.lockExactHints}
              />
              <span>Afficher les positions exactes (cases vertes)</span>
            </label>
            {difficultyMeta.lockExactHints && (
              <p className="toggle__hint">Option verrouillee en mode Expert.</p>
            )}
          </div>

          <div className="stats">
            <article className="stat">
              <p className="stat__label">Essais restants</p>
              <strong>{remainingAttempts}</strong>
            </article>
            <article className="stat">
              <p className="stat__label">Mots valides</p>
              <strong>{validWordCount}</strong>
            </article>
          </div>

          <section className="profile">
            <div className="profile__header">
              <h3>Tes stats</h3>
              <button type="button" className="profile__reset" onClick={onResetStats}>
                Reset
              </button>
            </div>
            <div className="profile__grid">
              <article className="stat">
                <p className="stat__label">Parties</p>
                <strong>{stats.played}</strong>
              </article>
              <article className="stat">
                <p className="stat__label">Victoires</p>
                <strong>{stats.wins}</strong>
              </article>
              <article className="stat">
                <p className="stat__label">Winrate</p>
                <strong>{winRate}%</strong>
              </article>
              <article className="stat">
                <p className="stat__label">Serie</p>
                <strong>{stats.streak}</strong>
              </article>
              <article className="stat">
                <p className="stat__label">Meilleure serie</p>
                <strong>{stats.bestStreak}</strong>
              </article>
            </div>
          </section>

          <div className="progress">
            <div className="progress__track">
              <div className="progress__fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="history">
            <h3>Historique recent</h3>
            {history.length === 0 ? (
              <p className="history__empty">Aucun essai pour le moment.</p>
            ) : (
              <ul>
                {history.slice(0, 6).map((attempt, index) => (
                  <li key={`${attempt.guess}-${index}`}>
                    <span>{attempt.guess}</span>
                    <strong>
                      {attempt.exactCount}/{wordLength}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button type="button" className="reset-btn" onClick={onReset}>
            Rejouer
          </button>
        </aside>
      </main>

      {gameState !== "playing" && (
        <div className="overlay">
          <div className="overlay__card">
            <h2>{gameState === "won" ? "Victoire" : "Partie terminee"}</h2>
            <p>{statusMessage}</p>
            <button type="button" onClick={onReset}>
              Relancer une partie
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SoloGame;

