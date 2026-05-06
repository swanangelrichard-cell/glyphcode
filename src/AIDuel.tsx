import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  SECRET_WORDS_BY_LENGTH,
  SupportedWordLength,
  VALID_WORDS_BY_LENGTH,
} from "./wordBank";
import WordGridInput from "./WordGridInput";

type DuelPhase = "setup" | "playing" | "finished";
type DuelTurn = "player" | "ai";
type DuelTone = "info" | "warn" | "success";
type DuelWinner = "player" | "ai" | null;

type DuelGuess = {
  guess: string;
  exactCount: number;
  wordLength: number;
  matchMask: boolean[];
};

const VALID_GUESS_SETS: Record<SupportedWordLength, ReadonlySet<string>> = {
  5: new Set(VALID_WORDS_BY_LENGTH[5]),
  6: new Set(VALID_WORDS_BY_LENGTH[6]),
  7: new Set(VALID_WORDS_BY_LENGTH[7]),
};
const EXACT_HINTS_STORAGE_KEY = "mememot_show_exact_hints_v1";

const loadShowExactHints = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(EXACT_HINTS_STORAGE_KEY) === "true";
};

const sanitizeWord = (rawWord: string, maxLength: number) =>
  rawWord
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, maxLength);

const toTiles = (value: string, wordLength: number) =>
  Array.from({ length: wordLength }, (_, index) => value[index] ?? "");

const buildMatchMask = (firstWord: string, secondWord: string, wordLength: number) =>
  Array.from({ length: wordLength }, (_, index) => firstWord[index] === secondWord[index]);

const countExactMatches = (firstWord: string, secondWord: string, wordLength: number) => {
  const matchMask = buildMatchMask(firstWord, secondWord, wordLength);
  return matchMask.filter(Boolean).length;
};

const pickSecretWord = (wordLength: SupportedWordLength) => {
  const preferredPool = SECRET_WORDS_BY_LENGTH[wordLength];
  const fullPool = VALID_WORDS_BY_LENGTH[wordLength];
  const pool = preferredPool.length > 0 ? preferredPool : fullPool;
  return pool[Math.floor(Math.random() * pool.length)];
};

const pickAiGuess = (candidates: readonly string[], previousGuesses: readonly DuelGuess[]) => {
  if (candidates.length === 0) {
    return null;
  }

  const guessedWords = new Set(previousGuesses.map((guess) => guess.guess));
  const remainingCandidates = candidates.filter((word) => !guessedWords.has(word));
  const pool = remainingCandidates.length > 0 ? remainingCandidates : candidates;

  const scored = pool
    .map((word) => ({
      word,
      score: new Set(word).size,
    }))
    .sort((left, right) => right.score - left.score);

  const topCandidates = scored.slice(0, Math.min(40, scored.length));
  const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)];
  return picked?.word ?? null;
};

function AIDuel() {
  const [selectedWordLength, setSelectedWordLength] = useState<SupportedWordLength>(5);
  const [phase, setPhase] = useState<DuelPhase>("setup");
  const [turn, setTurn] = useState<DuelTurn>("player");
  const [winner, setWinner] = useState<DuelWinner>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Choisis ton mot secret, puis lance le duel contre l'IA.",
  );
  const [statusTone, setStatusTone] = useState<DuelTone>("info");

  const [playerSecretInput, setPlayerSecretInput] = useState("");
  const [playerSecret, setPlayerSecret] = useState("");
  const [aiSecret, setAiSecret] = useState("");
  const [playerGuessInput, setPlayerGuessInput] = useState("");
  const [playerGuesses, setPlayerGuesses] = useState<DuelGuess[]>([]);
  const [aiGuesses, setAiGuesses] = useState<DuelGuess[]>([]);
  const [aiCandidates, setAiCandidates] = useState<string[]>([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [showExactHints, setShowExactHints] = useState(() => loadShowExactHints());

  const validWordSet = useMemo(() => VALID_GUESS_SETS[selectedWordLength], [selectedWordLength]);
  const rowTilesStyle = { ["--letters" as string]: selectedWordLength } as CSSProperties;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(EXACT_HINTS_STORAGE_KEY, showExactHints ? "true" : "false");
  }, [showExactHints]);

  useEffect(() => {
    if (phase !== "playing" || turn !== "ai" || playerSecret.length !== selectedWordLength) {
      return;
    }

    setAiThinking(true);
    const timeoutId = window.setTimeout(() => {
      const aiGuess = pickAiGuess(aiCandidates, aiGuesses);
      if (!aiGuess) {
        setPhase("finished");
        setWinner("player");
        setAiThinking(false);
        setStatusMessage("L'IA n'a plus de proposition. Tu gagnes.");
        setStatusTone("success");
        return;
      }

      const matchMask = buildMatchMask(aiGuess, playerSecret, selectedWordLength);
      const exactCount = matchMask.filter(Boolean).length;
      const nextGuess: DuelGuess = {
        guess: aiGuess,
        exactCount,
        wordLength: selectedWordLength,
        matchMask,
      };
      const nextCandidates = aiCandidates.filter(
        (candidateWord) =>
          countExactMatches(aiGuess, candidateWord, selectedWordLength) === exactCount,
      );

      setAiGuesses((previousGuesses) => [...previousGuesses, nextGuess]);
      setAiCandidates(nextCandidates);
      setAiThinking(false);

      if (exactCount === selectedWordLength) {
        setPhase("finished");
        setWinner("ai");
        setStatusMessage(`L'IA a trouve ton mot (${aiGuess}) et gagne.`);
        setStatusTone("warn");
        return;
      }

      setTurn("player");
      setStatusMessage(`L'IA propose ${aiGuess}: ${exactCount}/${selectedWordLength} bien placees.`);
      setStatusTone("info");
    }, 750);

    return () => window.clearTimeout(timeoutId);
  }, [aiCandidates, aiGuesses, phase, playerSecret, selectedWordLength, turn]);

  const startDuel = () => {
    const sanitizedSecret = sanitizeWord(playerSecretInput, selectedWordLength);
    if (sanitizedSecret.length !== selectedWordLength) {
      setStatusMessage(`Ton mot secret doit faire ${selectedWordLength} lettres.`);
      setStatusTone("warn");
      return;
    }

    if (!validWordSet.has(sanitizedSecret)) {
      setStatusMessage("Ton mot secret n'existe pas dans le dictionnaire.");
      setStatusTone("warn");
      return;
    }

    const firstTurn: DuelTurn = Math.random() < 0.5 ? "player" : "ai";

    setPhase("playing");
    setWinner(null);
    setTurn(firstTurn);
    setPlayerSecret(sanitizedSecret);
    setAiSecret(pickSecretWord(selectedWordLength));
    setPlayerGuesses([]);
    setAiGuesses([]);
    setAiCandidates([...VALID_WORDS_BY_LENGTH[selectedWordLength]]);
    setPlayerGuessInput("");
    setStatusMessage(
      firstTurn === "player"
        ? "Duel lance. A toi de jouer."
        : "Duel lance. L'IA commence.",
    );
    setStatusTone("info");
  };

  const submitPlayerGuess = () => {
    if (phase !== "playing") {
      setStatusMessage("La partie est terminee. Clique sur Rejouer.");
      setStatusTone("warn");
      return;
    }

    if (turn !== "player") {
      setStatusMessage("Attends le tour de l'IA.");
      setStatusTone("warn");
      return;
    }

    const sanitizedGuess = sanitizeWord(playerGuessInput, selectedWordLength);
    if (sanitizedGuess.length !== selectedWordLength) {
      setStatusMessage(`Ton essai doit faire ${selectedWordLength} lettres.`);
      setStatusTone("warn");
      return;
    }

    if (!validWordSet.has(sanitizedGuess)) {
      setStatusMessage("Ce mot est invalide pour le dictionnaire.");
      setStatusTone("warn");
      return;
    }

    const matchMask = buildMatchMask(sanitizedGuess, aiSecret, selectedWordLength);
    const exactCount = matchMask.filter(Boolean).length;
    const nextGuess: DuelGuess = {
      guess: sanitizedGuess,
      exactCount,
      wordLength: selectedWordLength,
      matchMask,
    };

    setPlayerGuesses((previousGuesses) => [...previousGuesses, nextGuess]);
    setPlayerGuessInput("");

    if (exactCount === selectedWordLength) {
      setPhase("finished");
      setWinner("player");
      setStatusMessage(`Bravo, tu as trouve le mot de l'IA (${sanitizedGuess}).`);
      setStatusTone("success");
      return;
    }

    setTurn("ai");
    setStatusMessage(`Ton essai: ${exactCount}/${selectedWordLength}. L'IA reflechit...`);
    setStatusTone("info");
  };

  const onStartDuelSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startDuel();
  };

  const resetDuel = () => {
    setPhase("setup");
    setTurn("player");
    setWinner(null);
    setPlayerSecretInput("");
    setPlayerSecret("");
    setAiSecret("");
    setPlayerGuessInput("");
    setPlayerGuesses([]);
    setAiGuesses([]);
    setAiCandidates([]);
    setAiThinking(false);
    setStatusMessage("Nouvelle partie. Choisis un mot secret pour recommencer.");
    setStatusTone("info");
  };

  return (
    <div className="app duel-app">
      <header className="hero">
        <p className="hero__eyebrow">Duel local</p>
        <h1 className="hero__title">Duel contre IA</h1>
        <p className="hero__subtitle">
          Vous choisissez chacun un mot secret, puis vous jouez tour par tour.
          Le premier qui trouve gagne.
        </p>
      </header>

      <main className="duel-layout">
        <section className="duel-card">
          <h2>Partie</h2>
          <p className={`duel-status duel-status--${statusTone}`}>{statusMessage}</p>

          <p className="duel-meta">
            Longueur: <strong>{selectedWordLength}</strong> lettres | Tour:{" "}
            <strong>{phase === "playing" ? (turn === "player" ? "toi" : "IA") : "-"}</strong>
          </p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={showExactHints}
              onChange={(event) => setShowExactHints(event.target.checked)}
            />
            <span>Afficher les positions exactes (cases vertes)</span>
          </label>

          {phase === "setup" && (
            <form className="duel-form" onSubmit={onStartDuelSubmit}>
              <label className="duel-label" htmlFor="ai-word-length">
                Longueur du mot
              </label>
              <select
                id="ai-word-length"
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

              <label className="duel-label" htmlFor="player-secret-word">
                Ton mot secret
              </label>
              <div className="duel-actions">
                <WordGridInput
                  id="player-secret-word"
                  value={playerSecretInput}
                  onChange={setPlayerSecretInput}
                  length={selectedWordLength}
                  placeholder={`Mot de ${selectedWordLength} lettres`}
                  onSubmit={startDuel}
                  autoFocus
                />
                <button type="submit" className="duel-btn">
                  Lancer le duel
                </button>
              </div>
            </form>
          )}

          {phase !== "setup" && (
            <>
              <p className="duel-note">Ecris directement dans la grille "Mes essais".</p>

              <div className="duel-ai-badges">
                <span className="duel-ai-badge">IA: {aiThinking ? "reflechit..." : "prete"}</span>
                <span className="duel-ai-badge">Candidats IA: {aiCandidates.length}</span>
                <span className="duel-ai-badge">
                  Resultat:{" "}
                  {winner === null ? "en cours" : winner === "player" ? "tu gagnes" : "IA gagne"}
                </span>
              </div>

              <button type="button" className="duel-btn duel-btn--secondary" onClick={resetDuel}>
                Rejouer
              </button>
            </>
          )}
        </section>

        <section className="duel-card">
          <h2>Mes essais</h2>
          <div className="duel-grid-board">
            <div className="grid">
              {playerGuesses.map((guess, rowIndex) => (
                <div className="row row--past" key={`${guess.guess}-${rowIndex}`}>
                  <div className="row__tiles" style={rowTilesStyle}>
                    {toTiles(guess.guess, selectedWordLength).map((letter, index) => (
                      <div
                        className={`tile ${
                          showExactHints
                            ? guess.matchMask[index]
                              ? "tile--exact"
                              : "tile--off"
                            : "tile--masked"
                        }`}
                        key={`${rowIndex}-${index}`}
                      >
                        {letter}
                      </div>
                    ))}
                  </div>
                  <span className="row__score">
                    {guess.exactCount}/{guess.wordLength}
                  </span>
                </div>
              ))}

              {phase !== "setup" && (
                <div className="row row--current">
                  <div className="row__tiles row__tiles--input" style={rowTilesStyle}>
                    <WordGridInput
                      value={playerGuessInput}
                      onChange={setPlayerGuessInput}
                      length={selectedWordLength}
                      onSubmit={submitPlayerGuess}
                      disabled={phase !== "playing" || turn !== "player"}
                      autoFocus={phase === "playing" && turn === "player"}
                      placeholder={`Essai de ${selectedWordLength} lettres`}
                    />
                  </div>
                  <span className="row__score">en cours</span>
                </div>
              )}
            </div>

            {playerGuesses.length === 0 && phase === "setup" && (
              <p className="duel-note">Aucun essai pour l'instant.</p>
            )}

            {phase !== "setup" && (
              <button
                type="button"
                className="floating-validate-btn floating-validate-btn--duel"
                onClick={submitPlayerGuess}
                disabled={phase !== "playing" || turn !== "player"}
              >
                Valider
              </button>
            )}
          </div>
        </section>

        <section className="duel-card">
          <h2>Essais de l'IA</h2>
          <div className="duel-history">
            {aiGuesses.length === 0 ? (
              <p className="duel-note">L'IA n'a pas encore joue.</p>
            ) : (
              <ul>
                {[...aiGuesses].reverse().map((guess, index) => (
                  <li key={`${guess.guess}-${index}`}>
                    <span>{guess.guess}</span>
                    <strong>
                      {guess.exactCount}/{guess.wordLength}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default AIDuel;
