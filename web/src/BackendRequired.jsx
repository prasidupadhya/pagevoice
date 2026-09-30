import React, { useEffect, useState } from "react";
import { BookOpen, Globe, Moon, Sun } from "lucide-react";
import { messages, persist, preference } from "./i18n";

export default function BackendRequired() {
  const [locale, setLocale] = useState(() =>
    preference("pagevoice-locale", "en") === "es" ? "es" : "en",
  );
  const [theme, setTheme] = useState(() =>
    preference(
      "pagevoice-theme",
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    ),
  );
  const t = messages[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.theme = theme;
    persist("pagevoice-locale", locale);
    persist("pagevoice-theme", theme);
    document.title = "PageVoice · Setup required";
  }, [locale, theme]);

  return (
    <div className="deployment-required">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(event) => event.preventDefault()}
        >
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          PageVoice
        </a>
        <div className="top-controls">
          <label className="language-control">
            <Globe size={17} />
            <span className="sr-only">{t.language}</span>
            <select
              aria-label={t.language}
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
          </label>
          <button
            className="theme-button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <main className="deployment-required__main">
        <section
          className="deployment-required__sheet"
          aria-labelledby="deployment-title"
        >
          <p className="eyebrow">PageVoice · Private library</p>
          <h1 id="deployment-title">{t.deploymentTitle}</h1>
          <p className="deployment-required__lead">{t.deploymentDescription}</p>
          <h2>{t.deploymentVariables}</h2>
          <ul>
            <li>
              <code>{t.apiVariable}</code>
            </li>
            <li>
              <code>{t.pocketbaseVariable}</code>
            </li>
          </ul>
          <p className="deployment-required__note">{t.deploymentNote}</p>
        </section>
      </main>
    </div>
  );
}
