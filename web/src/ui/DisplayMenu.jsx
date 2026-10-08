import { useEffect, useId, useRef, useState } from "react";
import { Type, Minus, Plus } from "lucide-react";

import { TEXT_SIZES, THEMES, WIDTHS } from "./prefs";
const WIDTH_LABELS = {
  narrow: "widthNarrow",
  medium: "widthMedium",
  wide: "widthWide",
};

/** Disclosure popover for reading appearance and interface language. */
export default function DisplayMenu({ prefs, setPref, t }) {
  const [open, setOpen] = useState(false),
    root = useRef(null),
    button = useRef(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (e) => {
        if (!root.current?.contains(e.target)) setOpen(false);
      },
      key = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  const size = TEXT_SIZES.indexOf(prefs.textSize);
  return (
    <div className="popover-root" ref={root}>
      <button
        ref={button}
        className="ghost header-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("display")}
        onClick={() => setOpen(!open)}
      >
        <Type size={18} aria-hidden="true" />
        <span className="header-label">{t("display")}</span>
      </button>
      {open && (
        <div className="popover display-menu" id={id}>
          <fieldset>
            <legend>{t("theme")}</legend>
            <div className="segmented">
              {THEMES.map((theme) => (
                <label key={theme} data-theme-swatch={theme}>
                  <input
                    type="radio"
                    name={`${id}-theme`}
                    value={theme}
                    checked={prefs.theme === theme}
                    onChange={() => setPref("theme", theme)}
                  />
                  <span>{t(theme)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("textSize")}</legend>
            <div className="stepper">
              <button
                className="icon-button small"
                aria-label={t("smallerText")}
                disabled={size <= 0}
                onClick={() => setPref("textSize", TEXT_SIZES[size - 1])}
              >
                <Minus size={16} />
              </button>
              <output aria-live="polite">{prefs.textSize}px</output>
              <button
                className="icon-button small"
                aria-label={t("largerText")}
                disabled={size >= TEXT_SIZES.length - 1}
                onClick={() => setPref("textSize", TEXT_SIZES[size + 1])}
              >
                <Plus size={16} />
              </button>
            </div>
          </fieldset>
          <fieldset>
            <legend>{t("lineWidth")}</legend>
            <div className="segmented">
              {WIDTHS.map((width) => (
                <label key={width}>
                  <input
                    type="radio"
                    name={`${id}-width`}
                    value={width}
                    checked={prefs.width === width}
                    onChange={() => setPref("width", width)}
                  />
                  <span>{t(WIDTH_LABELS[width])}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="menu-select">
            {t("interface")}
            <select
              aria-label={t("interface")}
              value={prefs.locale}
              onChange={(e) => setPref("locale", e.target.value)}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
