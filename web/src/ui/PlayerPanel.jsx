import { useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  Download,
  LoaderCircle,
  Volume2,
} from "lucide-react";
import { readyRun } from "../offline/render";
import { duration } from "../offline/format";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const STATUS_KEY = {
  idle: "ready",
  gesture: "tapAudio",
  starting: "starting",
  playing: "playing",
  paused: "paused",
  buffering: "buffering",
  finished: "finished",
  error: "paused",
};

export default function PlayerPanel({
  book,
  api,
  t,
  playback,
  preparation,
  position,
  compact,
  voiceReady,
  rate,
  onRate,
  onModels,
  onVoice,
  listen,
}) {
  const [expanded, setExpanded] = useState(false),
    [sleep, setSleep] = useState(api.refs.current.player.sleepMinutes || 0);
  const device = book.settings.engine === "device",
    row = playback.row || position,
    rowChapter = book.chapters[row.chapter] || book.chapters[0],
    buffer = readyRun(
      book,
      playback.target?.chapter ?? position.chapter,
      playback.target?.sentence ?? position.sentence,
    ),
    prepared = Object.keys(book.prepared).length,
    total = book.chapters.reduce((n, ch) => n + ch.sentences.length, 0),
    status = playback.status || "idle",
    playing = status === "playing",
    waiting = status === "buffering" || status === "starting";
  const step = (delta) =>
    device
      ? api.refs.current.speech[delta < 0 ? "previous" : "next"]()
      : api.refs.current.player.next(delta);
  const details = (
    <>
      <div className="player-timing">
        <span>{duration(playback.time)}</span>
        <input
          aria-label={t("sentencePosition")}
          type="range"
          min="0"
          max={playback.duration || 1}
          step=".1"
          value={Math.min(playback.time || 0, playback.duration || 1)}
          onChange={(e) => {
            api.refs.current.player.audio.currentTime = Number(e.target.value);
          }}
          disabled={device || !playback.duration}
        />
        <span>{duration(playback.duration)}</span>
      </div>
      <div className="chapter-ticks" role="group" aria-label={t("chapters")}>
        {book.chapters.map((ch, i) => (
          <button
            key={i}
            style={{ flex: Math.max(1, ch.sentences.length) }}
            className={i === row.chapter ? "selected" : ""}
            aria-label={`${t("listenHere")} · ${ch.title}`}
            aria-current={i === row.chapter ? "true" : undefined}
            title={ch.title}
            onClick={() => listen(i, 0)}
          />
        ))}
      </div>
      <div className="player-options">
        <label>
          {t("playbackSpeed")}
          <select
            aria-label={t("playbackSpeed")}
            value={rate}
            onChange={(e) => onRate(Number(e.target.value))}
            disabled={device}
          >
            {RATES.map((n) => (
              <option value={n} key={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("sleep")}
          <select
            aria-label={t("sleep")}
            value={sleep}
            onChange={(e) => {
              const minutes = Number(e.target.value);
              api.refs.current.player.sleep(minutes);
              setSleep(minutes);
            }}
            disabled={device}
          >
            <option value="0">{t("sleepOff")}</option>
            {[15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {t("minutes", { n })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!device && (
        <section
          className="preparation-panel"
          aria-label={t("audioPreparation")}
        >
          <h3 className="eyebrow">{t("audioPreparation")}</h3>
          <div
            className="ink-buffer"
            role="img"
            aria-label={t("readyBuffer", {
              ready: buffer.count,
              required: buffer.required,
            })}
          >
            {Array.from({ length: buffer.required }, (_, i) => (
              <span key={i} className={i < buffer.count ? "inked" : ""} />
            ))}
          </div>
          <small className="muted">
            {t("readyBuffer", {
              ready: buffer.count,
              required: buffer.required,
            })}
          </small>
          <div className="preparation-total">
            <span>
              {t(
                preparation.status === "preparing"
                  ? "preparing"
                  : prepared >= total
                    ? "complete"
                    : "progressLabel",
              )}
            </span>
            <strong>
              {prepared} / {total}
            </strong>
          </div>
          <progress
            aria-label={t("progressLabel")}
            value={prepared}
            max={total}
          />
          {prepared < total && (
            <button
              className="small prepare-button"
              onClick={() => {
                if (preparation.status === "preparing")
                  api.refs.current.queue.pause();
                else
                  api.refs.current.queue
                    .prepare(book.id, position.chapter, 0)
                    .catch((e) => api.setError(e.message));
              }}
              disabled={!voiceReady && preparation.status !== "preparing"}
            >
              {preparation.status === "preparing" ? (
                <Pause size={16} aria-hidden="true" />
              ) : (
                <Play size={16} aria-hidden="true" />
              )}
              {t(
                preparation.status === "preparing"
                  ? "pausePreparation"
                  : preparation.status === "paused"
                    ? "resumePreparation"
                    : "prepare",
              )}
            </button>
          )}
          {preparation.rtf !== undefined && (
            <p className="performance-note" title={t("rtfHelp")}>
              {t("rtf", { rtf: preparation.rtf.toFixed(2) })}
              {preparation.eta > 0 && (
                <small>{t("eta", { time: duration(preparation.eta) })}</small>
              )}
              {preparation.rtf > 1 && (
                <small className="warning">{t("slow")}</small>
              )}
            </p>
          )}
          <p className="fine-print">{t("preparingNote")}</p>
        </section>
      )}
      <button className="text-button player-voice-link" onClick={onVoice}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        {t("voice")}
      </button>
    </>
  );
  return (
    <aside
      className={`player-panel ${compact ? "compact" : ""} ${expanded ? "expanded" : ""}`}
      aria-label={t("audioPlayer")}
    >
      <div className="player-now">
        <p className={`player-status status-${status}`}>
          {waiting ? (
            <LoaderCircle className="spin" size={14} aria-hidden="true" />
          ) : playing ? (
            <Volume2 size={14} aria-hidden="true" />
          ) : null}
          <span>{t(STATUS_KEY[status] || "ready")}</span>
        </p>
        <p className="player-title">{rowChapter.title}</p>
        <p className="player-sub">
          {t("sentenceOf", {
            current: Math.min(row.sentence + 1, rowChapter.sentences.length),
            total: rowChapter.sentences.length,
          })}
        </p>
      </div>
      <div className="player-controls">
        <button
          className="icon-button"
          aria-label={t("previous")}
          onClick={() => step(-1)}
          disabled={!playback.row}
        >
          <SkipBack size={20} />
        </button>
        <button
          className="play-button"
          aria-label={t(
            playing ? "pause" : status === "gesture" ? "tapAudio" : "play",
          )}
          onClick={() => api.togglePlayback(book)}
        >
          {playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button
          className="icon-button"
          aria-label={t("next")}
          onClick={() => step(1)}
          disabled={!playback.row}
        >
          <SkipForward size={20} />
        </button>
        {compact && (
          <button
            className="icon-button player-expand"
            aria-expanded={expanded}
            aria-controls="player-details"
            aria-label={t(expanded ? "hideAudioOptions" : "audioOptions")}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </button>
        )}
      </div>
      {voiceReady === false && (
        <div className="voice-missing">
          <p>
            <strong>{t("voiceMissing")}</strong>{" "}
            <span className="muted">{t("voiceMissingBody")}</span>
          </p>
          <button className="small" onClick={device ? onVoice : onModels}>
            <Download size={16} aria-hidden="true" />
            {t(device ? "voice" : "downloadVoice")}
          </button>
        </div>
      )}
      <div className="player-details" id="player-details">
        {details}
      </div>
    </aside>
  );
}
