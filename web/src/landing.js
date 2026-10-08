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

// Small screens: the site links open from a Menu button in the header.
const menuButton = document.querySelector(".menu-button");
const menu = document.getElementById("site-menu");
const setMenu = (open) => {
  menuButton.setAttribute("aria-expanded", String(open));
  menu.dataset.open = String(open);
};
menuButton?.addEventListener("click", () =>
  setMenu(menuButton.getAttribute("aria-expanded") !== "true"),
);
menu?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu?.dataset.open === "true") {
    setMenu(false);
    menuButton.focus();
  }
});
