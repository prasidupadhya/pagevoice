// Narration voices for one book. A book in Spanish only gets Spanish voices and
// an English book only English ones; voices without a language are never offered.
export function voicesFor(voices, language) {
  return voices.filter((voice) => voice.locale.split("-")[0] === language);
}

// "Brad · American English · Male". The language name follows the app's locale.
export function voiceLabel(voice, uiLocale, genderLabels) {
  const parts = [voice.name];
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: "language" }).of(voice.locale);
    if (name && name !== voice.locale) parts.push(name);
  } catch {
    // Unsupported locale tag: the name alone is still useful.
  }
  if (voice.gender) parts.push(genderLabels[voice.gender]);
  return parts.join(" · ");
}
