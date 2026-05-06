import { useEffect, useState } from "react";
import AIDuel from "./AIDuel";
import OnlineDuel from "./OnlineDuel";
import SoloGame from "./SoloGame";
import "./App.css";

type PlayMode = "solo" | "ai" | "online";
type ThemeMode = "white" | "black";

const THEME_STORAGE_KEY = "mememot_theme_v1";

const loadStoredTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "white";
  }
  const rawTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return rawTheme === "black" ? "black" : "white";
};

function App() {
  const [playMode, setPlayMode] = useState<PlayMode>("solo");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadStoredTheme());

  useEffect(() => {
    document.body.classList.remove("theme-white", "theme-black");
    document.body.classList.add(themeMode === "black" ? "theme-black" : "theme-white");
    window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  return (
    <>
      <div className="mode-switch">
        <button
          type="button"
          className={`mode-switch__btn ${playMode === "solo" ? "mode-switch__btn--active" : ""}`}
          onClick={() => setPlayMode("solo")}
        >
          Solo
        </button>
        <button
          type="button"
          className={`mode-switch__btn ${playMode === "ai" ? "mode-switch__btn--active" : ""}`}
          onClick={() => setPlayMode("ai")}
        >
          Duel IA
        </button>
        <button
          type="button"
          className={`mode-switch__btn ${playMode === "online" ? "mode-switch__btn--active" : ""}`}
          onClick={() => setPlayMode("online")}
        >
          Duel en ligne
        </button>
      </div>

      <div className="theme-dock" aria-label="Choix du style">
        <button
          type="button"
          className={`theme-dock__btn ${themeMode === "white" ? "theme-dock__btn--active" : ""}`}
          onClick={() => setThemeMode("white")}
        >
          White
        </button>
        <button
          type="button"
          className={`theme-dock__btn ${themeMode === "black" ? "theme-dock__btn--active" : ""}`}
          onClick={() => setThemeMode("black")}
        >
          Black
        </button>
      </div>

      {playMode === "solo" ? <SoloGame /> : playMode === "ai" ? <AIDuel /> : <OnlineDuel />}
    </>
  );
}

export default App;
