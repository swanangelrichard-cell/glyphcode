import { useState } from "react";
import AIDuel from "./AIDuel";
import OnlineDuel from "./OnlineDuel";
import SoloGame from "./SoloGame";
import "./App.css";

type PlayMode = "solo" | "ai" | "online";

function App() {
  const [playMode, setPlayMode] = useState<PlayMode>("solo");

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

      {playMode === "solo" && <SoloGame />}
      {playMode === "ai" && <AIDuel />}
      {playMode === "online" && <OnlineDuel />}
    </>
  );
}

export default App;
