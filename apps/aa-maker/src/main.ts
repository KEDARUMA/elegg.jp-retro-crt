import "./style.css";
import charPalettes from "./data/char-palettes.json";

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const [activePalette] = charPalettes;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("AA Maker mount target was not found.");
}

const gridCells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => {
  const x = index % GRID_COLUMNS;
  const y = Math.floor(index / GRID_COLUMNS);

  return `<div class="aa-cell" data-x="${x}" data-y="${y}" aria-label="cell ${x + 1},${y + 1}">&nbsp;</div>`;
}).join("");

const paletteItems = activePalette.chars
  .map((char, index) => {
    const code = activePalette.startCode + index;
    const selectedClass = index === 0 ? " is-selected" : "";

    return `<button class="palette-button${selectedClass}" type="button" data-code="${code}" title="0x${code.toString(16).padStart(2, "0")}">${char}</button>`;
  })
  .join("");

app.innerHTML = `
  <main class="aa-maker-shell" aria-label="AA Maker">
    <header class="top-menu">
      <nav class="menu-list" aria-label="Main menu">
        <button type="button">File</button>
        <button type="button">Image</button>
      </nav>
      <div class="status-bar">
        <span>Tool: Pen</span>
        <span>Selected: A</span>
        <span>Canvas BGC: White</span>
      </div>
    </header>

    <aside class="toolbox" aria-label="Tools">
      <button class="tool-button is-selected" type="button" aria-label="Pen">P</button>
      <button class="tool-button" type="button" aria-label="Eraser">E</button>
      <button class="tool-button" type="button" aria-label="Eyedropper">I</button>
      <button class="tool-button" type="button" aria-label="Invert canvas background">BG</button>
    </aside>

    <section class="editor-panel" aria-label="Editor">
      <div class="grid-wrap">
        <div class="aa-grid" role="grid" aria-label="80 by 25 ASCII art grid">
          ${gridCells}
        </div>
      </div>
    </section>

    <aside class="side-panel" aria-label="Sidebar">
      <section class="panel-section">
        <h2>${activePalette.name}</h2>
        <div class="char-palette" aria-label="Character palette" style="--palette-columns: ${activePalette.columns}">
          ${paletteItems}
        </div>
      </section>

      <section class="panel-section">
        <h2>Layer</h2>
        <div class="layer-item is-active">
          <span>Layer 1</span>
          <span>Visible</span>
        </div>
      </section>

      <section class="panel-section panel-section--grow">
        <h2>Stamp</h2>
        <div class="empty-note">MVP 対象外</div>
      </section>
    </aside>
  </main>
`;

document.querySelectorAll<HTMLButtonElement>(".palette-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".palette-button.is-selected")?.classList.remove("is-selected");
    button.classList.add("is-selected");
  });
});
