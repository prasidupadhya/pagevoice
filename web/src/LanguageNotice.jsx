import React from "react";

/** Quiet result, with evidence disclosed when the heuristic needs review. */
export default function LanguageNotice({ detection, language, t }) {
  if (!detection?.source || detection.source === "manual") return null;
  return (
    <details
      className={`language-result ${detection.review ? "needs-review" : ""}`}
    >
      <summary>
        {t.languageDetected}: {language === "es" ? "Español" : "English"}
        {detection.review ? ` · ${t.languageReview}` : ""}
      </summary>
      <p>{t.languageEvidence}</p>
      <p>
        {t.languageDetectionSource}:{" "}
        {t[`languageSource_${detection.source}`] || detection.source}.{" "}
        {t.languageMarkers}: EN {detection.scores?.en || 0}, ES{" "}
        {detection.scores?.es || 0}.
      </p>
      {detection.metadata_mismatch && <p>{t.languageMismatch}</p>}
      {detection.confidence === "low" && <p>{t.languageUncertain}</p>}
    </details>
  );
}
