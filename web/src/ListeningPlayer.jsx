import React from "react";
import { Play, Pause, Square, Headphones } from "lucide-react";

export function ListeningPlayer({
  state,
  t,
  onStart,
  onPause,
  onResume,
  onStop,
  onSeek,
  onRate,
  onSleep,
  sleep = 0,
  disabled,
  title,
  rows = [],
}) {
  const active = [
    "buffering",
    "playing",
    "paused",
    "blocked",
    "error",
  ].includes(state.status);
  const status =
    state.status === "playing"
      ? t.listeningNow
      : state.status === "paused"
        ? t.pauseListening
        : state.status === "ended"
          ? t.listeningEnded
          : state.status === "buffering"
            ? t.buffering
            : t.listeningReady;
  const target = state.target || 20;
  return (
    <section
      className={`listening-player ${state.status}`}
      aria-label={t.playback}
    >
      <div className="listening-heading">
        <span className="listening-symbol">
          <Headphones size={22} />
        </span>
        <div>
          <p className="small muted" aria-live="polite">
            {status}
          </p>
          <h2>{state.row?.title || title || t.playback}</h2>
        </div>
        {active && (
          <button
            className="icon-button"
            onClick={onStop}
            aria-label={t.stopListening}
          >
            <Square size={18} />
          </button>
        )}
      </div>
      <div
        className="ink-buffer"
        role="img"
        aria-label={`${Math.min(state.ready || 0, target)} / ${target} ${t.buffered}`}
      >
        {Array.from({ length: target }, (_, i) => (
          <span
            key={i}
            className={i < (state.ready || 0) ? "filled" : ""}
            aria-hidden="true"
          />
        ))}
      </div>
      {state.total > 0 && (
        <div className="buffer-progress">
          <div>
            <span>
              {Math.min(state.ready, state.target)} / {state.target}{" "}
              {t.buffered}
            </span>
            <span>
              {t.sentencePosition} {Math.min(state.cursor + 1, state.total)} /{" "}
              {state.total}
            </span>
          </div>
          {state.status === "buffering" && state.downloaded > 0 && (
            <p className="small muted">
              {t.audioDownloaded}: {Math.min(state.downloaded, target)}/{target}
            </p>
          )}
          <label className="sr-only" htmlFor="listen-position">
            {t.seekSentence}
          </label>
          <input
            id="listen-position"
            type="range"
            min="0"
            max={Math.max(0, state.total - 1)}
            value={Math.min(state.cursor, state.total - 1)}
            onChange={(e) => onSeek?.(+e.target.value)}
            list="chapter-edges"
          />
          <datalist id="chapter-edges">
            {rows.flatMap((r, i) =>
              i === 0 || r.chapter !== rows[i - 1].chapter
                ? [<option key={i} value={i} label={r.title} />]
                : [],
            )}
          </datalist>
        </div>
      )}
      <div className="listening-controls">
        {["playing", "buffering"].includes(state.status) ? (
          <button className="primary" onClick={onPause}>
            <Pause size={18} />
            {t.pauseListening}
          </button>
        ) : ["paused", "blocked", "error"].includes(state.status) ? (
          <button className="primary" onClick={onResume}>
            <Play size={18} />
            {state.status === "blocked"
              ? t.continueAudio
              : state.status === "error"
                ? t.retry
                : t.resumeListening}
          </button>
        ) : (
          <button className="primary" disabled={disabled} onClick={onStart}>
            <Play size={18} />
            {t.listenNow}
          </button>
        )}
        <label>
          {t.playbackSpeed}
          <select
            value={state.rate || 1}
            onChange={(e) => onRate?.(+e.target.value)}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.sleepTimer}
          <select value={sleep} onChange={(e) => onSleep?.(+e.target.value)}>
            <option value="0">{t.off}</option>
            {[5, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} {t.minutes}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p
        className="small muted"
        role={state.status === "error" ? "alert" : "status"}
      >
        {state.status === "error"
          ? t.audioError
          : state.status === "buffering" && state.cursor > 0
            ? t.fillingBuffer
            : active
              ? t.backgroundHint
              : t.bufferHint}
      </p>
    </section>
  );
}
