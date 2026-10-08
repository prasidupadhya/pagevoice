import "./landing.css";

// Installed copies of PageVoice used "/" as their start URL. Open the library
// directly for them instead of showing the introduction page.
if (matchMedia("(display-mode: standalone)").matches) location.replace("/app/");

// People who already have a library get a more specific call to action.
globalThis.indexedDB
  ?.databases?.()
  .then((databases) => {
    if (!databases.some((d) => d.name === "pagevoice-offline-v1")) return;
    for (const link of document.querySelectorAll("[data-open-app]"))
      link.textContent = "Open your library";
  })
  .catch(() => {});
