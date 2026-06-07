import "./style.css";
import charPalettes from "./data/char-palettes.json";

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const [activePalette] = charPalettes;
const selectedChar = "\u00a0";
const tools = [
  {
    id: "move",
    label: "移動",
    icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  },
  {
    id: "select",
    label: "範囲選択",
    icon: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M8 5v14M16 5v14M5 8h14M5 16h14"/>',
  },
  {
    id: "eyedropper",
    label: "スポイト",
    icon: '<path d="M14 4l6 6M13 5l7 7-9 9H5v-6zM7 17l3 3"/>',
  },
  {
    id: "pen",
    label: "ペン",
    icon: '<path d="M16 4l4 4-11 11H5v-4zM13 7l4 4"/>',
  },
  {
    id: "eraser",
    label: "消しゴム",
    icon: '<path d="M5 15l8-8 6 6-6 6H8zM11 19h9M9 12l6 6"/>',
  },
  {
    id: "text",
    label: "テキスト",
    icon: '<path d="M5 5h14M12 5v16M8 21h8"/>',
  },
  {
    id: "stamp",
    label: "スタンプ",
    icon: '<path d="M9 4h6v7l3 3v6H6v-6l3-3zM7 17h10"/>',
  },
  {
    id: "range-color",
    label: "範囲カラー",
    icon: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 14h16M14 4v16"/>',
  },
];

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

const toolButtons = tools
  .map((tool) => {
    const selectedClass = tool.id === "pen" ? " is-selected" : "";

    return `
      <button class="tool-button${selectedClass}" type="button" disabled title="${tool.label} は未実装です" aria-label="${tool.label}">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          ${tool.icon}
        </svg>
      </button>
    `;
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
        <span>Canvas BGC: White</span>
      </div>
    </header>

    <aside class="toolbox" aria-label="Tools">
      <div class="tool-list">
        ${toolButtons}
      </div>
      <div class="selected-char" aria-label="Selected character">
        ${selectedChar}
      </div>
    </aside>

    <section class="editor-panel" aria-label="Editor">
      <div class="grid-wrap">
        <div class="aa-grid" role="grid" aria-label="80 by 25 ASCII art grid">
          ${gridCells}
        </div>
      </div>
    </section>

    <aside class="side-panel" aria-label="Sidebar">
      <section class="panel-section info-panel">
        <h2>Info</h2>
        <div class="info-grid">
          <span>X</span><strong>--</strong>
          <span>Y</span><strong>--</strong>
          <span>W</span><strong>--</strong>
          <span>H</span><strong>--</strong>
        </div>
        <div class="cell-info">
          <div class="empty-cell-preview" aria-label="Empty cell preview"></div>
          <div>
            <div>FC:------</div>
            <div>BC:ffffff</div>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <h2>Character Palette</h2>
        <label class="palette-select-label">
          <span>Palette</span>
          <select class="palette-select" aria-label="Character palette set">
            <option value="${activePalette.id}">${activePalette.name}</option>
          </select>
        </label>
        <div class="char-palette" aria-label="Character palette" style="--palette-columns: ${activePalette.columns}">
          ${paletteItems}
        </div>
      </section>

      <section class="panel-section">
        <h2>Layer</h2>
        <div class="layer-item is-active">
          <span>Layer 1</span>
          <span>表示</span>
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
