import { useEffect, useState } from "react";
import { Download, Check, Pause, Trash2 } from "lucide-react";
import Modal from "./Modal";
import { MODEL_GROUPS, groupBytes } from "../offline/assets";
import { bytes } from "../offline/format";
export default function ModelDialog({ t, assets, onClose, onError }) {
  const [status, setStatus] = useState({}),
    [progress, setProgress] = useState(assets.progress || {}),
    [paused, setPaused] = useState({});
  const refresh = async () => {
    const pairs = await Promise.all(
      Object.keys(MODEL_GROUPS).map(async (id) => [
        id,
        await assets.status(id),
      ]),
    );
    setStatus(Object.fromEntries(pairs));
  };
  useEffect(() => {
    refresh().catch(onError);
    return assets.subscribe?.(setProgress);
  }, []);
  const labels = {
    kokoro: "kokoro",
    "kokoro-gpu": "gpuLabel",
    piper: "piper",
    sharvard: "sharvardLabel",
    supertonic: "supertonicLabel",
    ocr: "ocrLabel",
    embeddings: "embeddingLabel",
    ner: "nerLabel",
    ffmpeg: "ffmpegLabel",
  };
  const install = async (id) => {
    setProgress((p) => ({
      ...p,
      [id]: { loaded: status[id]?.bytes || 0, total: groupBytes(id) },
    }));
    setPaused((p) => ({ ...p, [id]: false }));
    try {
      await assets.install(id, (p) =>
        setProgress((prev) => ({ ...prev, [id]: p })),
      );
    } catch (e) {
      if (e.name === "AbortError") setPaused((p) => ({ ...p, [id]: true }));
      else
        onError(e.name === "QuotaExceededError" ? "quotaExceeded" : e.message);
    } finally {
      setProgress((p) => ({ ...p, [id]: null }));
      await refresh();
    }
  };
  return (
    <Modal
      title={t("models")}
      onClose={onClose}
      closeLabel={t("close")}
      className="tools-modal"
    >
      <p className="muted">{t("downloadIntro")}</p>
      <div className="model-list">
        {Object.entries(MODEL_GROUPS).map(([id, g]) => (
          <section key={id} className="model-row" data-model={id}>
            <div>
              <h3>{t(labels[id])}</h3>
              <p>
                {bytes(groupBytes(id))} <span>· {g.license}</span>
              </p>
              {id === "supertonic" && <small>{t("supertonicNotice")}</small>}
            </div>
            {progress[id] ? (
              <div className="download-progress">
                <progress
                  aria-label={t("downloadedModel")}
                  value={progress[id].loaded}
                  max={progress[id].total}
                />
                <small>
                  {bytes(progress[id].loaded)} / {bytes(progress[id].total)}
                </small>
                <button onClick={() => assets.pause(id)}>
                  <Pause size={16} />
                  {t("pauseDownload")}
                </button>
              </div>
            ) : status[id]?.ready ? (
              <div className="model-actions">
                <span className="status ready">
                  <Check size={14} />
                  {t("cached")}
                </span>
                <button
                  className="icon-button"
                  aria-label={`${t("removeModel")} · ${t(labels[id])}`}
                  onClick={async () => {
                    await assets.remove(id);
                    await refresh();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ) : (
              <button onClick={() => install(id)} className="compact">
                <Download size={16} />
                {t(paused[id] ? "resumeDownload" : "download")}
              </button>
            )}
            {paused[id] && (
              <p className="muted download-note">{t("downloadPaused")}</p>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}
