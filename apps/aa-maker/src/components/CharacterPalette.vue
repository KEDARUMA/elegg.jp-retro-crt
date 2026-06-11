<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import editIcon from "../assets/icons/edit.svg?raw";
import plusIcon from "../assets/icons/plus.svg?raw";
import trashIcon from "../assets/icons/trash.svg?raw";
import { getCharWidth, getFirstGrapheme, shouldFitWideGlyphIntoNarrowCell } from "../model/gridOperations";
import type { WidthMode } from "../model/widthMode";
import type { SimilarGlyphSearchResult } from "../search/similarGlyphSearch";

type NormalPalette = {
  kind: "normal";
  id: string;
  name: string;
  columns?: number;
  startCode?: number;
  chars: (string | null)[];
};

type HistoryPalette = {
  kind: "history";
  id: string;
  name: string;
  columns: number;
  history: (string | null)[];
};

type KeyboardInputPalette = {
  kind: "keyboard-input";
  id: string;
  name: string;
  value: string;
};

type UnicodePalette = {
  kind: "unicode";
  id: string;
  name: string;
  query: string;
  scrollOffset: number;
};

type SimilarPalette = {
  kind: "similar";
  id: string;
  name: string;
  query: string;
  fontFamily: string;
  canvasSize: 16 | 32;
  threshold: number;
  widthMatch: boolean;
  maxResults: number;
  results: SimilarGlyphSearchResult[];
  isSearching: boolean;
  status: string;
  checkedPageCount: number;
  totalPageCount: number;
  checkedCodePointCount: number;
};

type Palette = NormalPalette | HistoryPalette | KeyboardInputPalette | UnicodePalette | SimilarPalette;

const props = defineProps<{
  palettes: Palette[];
  activePalette: Palette;
  activePaletteId: string;
  selectedChar: string | null;
  selectedCode: number | null;
  selectedPaletteCellIndex: number | null;
  canvasColor: string;
  foregroundDefaultColor: string;
  widthMode: WidthMode;
}>();

const emit = defineEmits<{
  selectPalette: [paletteId: string];
  selectChar: [char: string, width: 1 | 2, fillEmptyOnly: boolean];
  selectPaletteCell: [index: number];
  insertPaletteCell: [];
  deletePaletteCell: [];
  overwritePaletteCell: [index: number];
  keyboardInput: [value: string];
  updateUnicodeQuery: [query: string];
  updateUnicodeScrollOffset: [scrollOffset: number];
  updateSimilarQuery: [query: string];
  updateSimilarFontFamily: [fontFamily: string];
  updateSimilarCanvasSize: [canvasSize: number];
  updateSimilarThreshold: [threshold: number];
  updateSimilarWidthMatch: [widthMatch: boolean];
  updateSimilarMaxResults: [maxResults: number];
  startSimilarSearch: [];
  cancelSimilarSearch: [];
  editPaletteList: [];
}>();

const UNICODE_MIN_CODE = 0x20;
const UNICODE_MAX_CODE = 0x10ffff;
const UNICODE_COLUMNS = 8;
const UNICODE_ROW_HEIGHT = 16;
const UNICODE_VISIBLE_ROWS = 24;
const unicodeScrollRef = ref<HTMLElement | null>(null);
const isKeyboardComposing = ref(false);

const unicodeTotalRows = Math.ceil((UNICODE_MAX_CODE - UNICODE_MIN_CODE + 1) / UNICODE_COLUMNS);
const unicodeSpacerStyle = computed(() => ({
  height: `${unicodeTotalRows * UNICODE_ROW_HEIGHT}px`,
}));
const unicodeStartRow = computed(() => Math.max(0, Math.floor(getUnicodePalette().scrollOffset / UNICODE_ROW_HEIGHT) - 4));
const unicodeRows = computed(() => {
  const rows = [];
  const endRow = Math.min(unicodeTotalRows, unicodeStartRow.value + UNICODE_VISIBLE_ROWS + 8);

  for (let row = unicodeStartRow.value; row < endRow; row += 1) {
    const codeStart = UNICODE_MIN_CODE + row * UNICODE_COLUMNS;
    rows.push({
      row,
      codeStart,
      chars: Array.from({ length: UNICODE_COLUMNS }, (_, index) => codeStart + index).filter((code) => code <= UNICODE_MAX_CODE),
    });
  }

  return rows;
});
const unicodeRowsStyle = computed(() => ({
  transform: `translateY(${unicodeStartRow.value * UNICODE_ROW_HEIGHT}px)`,
}));
const selectedCharacterLabel = computed(() => {
  if (props.selectedChar === null || props.selectedCode === null) {
    return "";
  }

  if (isByteCodePalette(props.activePalette)) {
    return `${props.selectedChar}(${getPaletteCodeLabel(props.activePalette, props.selectedCode)})`;
  }

  return `${props.selectedChar}(${getCodeLabel(props.selectedCode)})`;
});
const paletteDisplayStyle = computed(() => ({
  "--aa-palette-canvas-color": `#${props.canvasColor}`,
  "--aa-palette-fgdc": `#${props.foregroundDefaultColor}`,
}));

function getPaletteCode(palette: NormalPalette, char: string | null, index: number) {
  if (typeof palette.startCode === "number") {
    return palette.startCode + index;
  }

  return char?.codePointAt(0) ?? 0;
}

function getCodeLabel(code: number, isByteCode = false) {
  if (isByteCode) {
    return `CP437:${code.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function isByteCodePalette(palette: Palette): palette is NormalPalette {
  return palette.kind === "normal" && typeof palette.startCode === "number";
}

function getPaletteCodeLabel(palette: NormalPalette, code: number) {
  if (typeof palette.startCode === "number") {
    return `${palette.name}:${code.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return getCodeLabel(code);
}

function getPaletteCharWidth(char: string | null): 1 | 2 {
  if (char === null) {
    return 1;
  }

  return getCharWidth(char, props.widthMode);
}

function isWidePaletteChar(char: string | null) {
  return char !== null && getPaletteCharWidth(char) === 2;
}

function getPaletteGlyphClass(char: string | null) {
  if (char === null || getPaletteCharWidth(char) !== 1 || !shouldFitWideGlyphIntoNarrowCell(char, props.widthMode)) {
    return [];
  }

  return ["is-terminal-narrow-wide-glyph"];
}

function getUnicodePalette() {
  return props.activePalette.kind === "unicode" ? props.activePalette : { query: "", scrollOffset: 0 };
}

function getSimilarResultTitle(result: SimilarGlyphSearchResult) {
  return `${getCodeLabel(result.codePoint)} score:${result.score}`;
}

function getUnicodeChar(code: number) {
  if (code >= 0xd800 && code <= 0xdfff) {
    return "";
  }

  return String.fromCodePoint(code);
}

function handleNormalPaletteClick(index: number, char: string | null, event: MouseEvent) {
  if (char === null) {
    return;
  }

  emit("selectPaletteCell", index);
  emit("selectChar", char, getPaletteCharWidth(char), event.shiftKey);
}

function handleNormalPaletteContextMenu(index: number, char: string | null) {
  if (char === null) {
    return;
  }

  emit("overwritePaletteCell", index);
}

function selectUnicodeChar(code: number, event: MouseEvent) {
  const char = getUnicodeChar(code);

  if (char) {
    emit("selectChar", char, getCharWidth(char, props.widthMode), event.shiftKey);
  }
}

function handleUnicodeScroll(event: Event) {
  emit("updateUnicodeScrollOffset", (event.target as HTMLElement).scrollTop);
}

function handleUnicodeQuery(value: string) {
  emit("updateUnicodeQuery", value);
  jumpToUnicodeCode(value);
}

function handleKeyboardInput(value: string) {
  if (!isKeyboardComposing.value) {
    emit("keyboardInput", value);
  }
}

function handleKeyboardCompositionEnd(value: string) {
  isKeyboardComposing.value = false;
  emit("keyboardInput", value);
}

function jumpToUnicodeCode(query: string) {
  const code = parseUnicodeQuery(query);

  if (code === null) {
    return;
  }

  const char = getUnicodeChar(code);

  if (char) {
    emit("selectChar", char, getCharWidth(char, props.widthMode), false);
  }

  const nextScrollTop = Math.floor((code - UNICODE_MIN_CODE) / UNICODE_COLUMNS) * UNICODE_ROW_HEIGHT;
  emit("updateUnicodeScrollOffset", nextScrollTop);

  nextTick(() => {
    if (unicodeScrollRef.value) {
      unicodeScrollRef.value.scrollTop = nextScrollTop;
    }
  });
}

function parseUnicodeQuery(query: string) {
  const normalized = query.trim().replace(/^U\+/i, "").replace(/^0x/i, "");

  if (/^[0-9a-f]+$/i.test(normalized)) {
    const code = Number.parseInt(normalized, 16);

    if (code >= UNICODE_MIN_CODE && code <= UNICODE_MAX_CODE) {
      return code;
    }
  }

  const char = getFirstGrapheme(query);
  return char ? (char.codePointAt(0) ?? null) : null;
}
</script>

<template>
  <section class="panel-section" :style="paletteDisplayStyle">
    <h2 class="character-palette-title">
      <span class="character-palette-name">Character Palette</span>
      <span v-if="selectedCharacterLabel" class="character-palette-selection">{{ selectedCharacterLabel }}</span>
    </h2>
    <label class="palette-select-label">
      <select
        class="palette-select"
        :value="activePaletteId"
        aria-label="Character palette set"
        @change="$emit('selectPalette', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="palette in palettes" :key="palette.id" :value="palette.id">
          {{ palette.name }}
        </option>
      </select>
      <button class="palette-edit-button" type="button" aria-label="Edit character palettes" title="Edit character palettes" @click="$emit('editPaletteList')">
        <span class="palette-edit-button-icon" aria-hidden="true" v-html="editIcon"></span>
      </button>
    </label>
    <div v-if="activePalette.kind === 'normal'" class="normal-palette">
      <div class="char-palette" aria-label="Character palette">
        <button
          v-for="(char, index) in activePalette.chars"
          :key="`${activePalette.id}-${index}`"
          class="palette-button"
          :class="{
            'is-selected': index === selectedPaletteCellIndex || (selectedPaletteCellIndex === null && char !== null && selectedChar === char),
            'is-wide': isWidePaletteChar(char),
          }"
          type="button"
          :disabled="char === null"
          :data-code="getPaletteCode(activePalette, char, index)"
          :title="char === null ? 'Empty' : getPaletteCodeLabel(activePalette, getPaletteCode(activePalette, char, index))"
          @click="handleNormalPaletteClick(index, char, $event)"
          @contextmenu.prevent="handleNormalPaletteContextMenu(index, char)"
        >
          <span class="palette-button-text" :class="getPaletteGlyphClass(char)">{{ char ?? "" }}</span>
        </button>
      </div>
      <div v-if="activePalette.id !== 'cp437'" class="palette-cell-actions" aria-label="Character palette actions">
        <button class="palette-cell-action-button" type="button" aria-label="Add empty character cell" title="Add empty character cell" @click="$emit('insertPaletteCell')">
          <span class="palette-cell-action-icon" aria-hidden="true" v-html="plusIcon"></span>
        </button>
        <button
          class="palette-cell-action-button"
          type="button"
          aria-label="Delete selected character cell"
          title="Delete selected character cell"
          :disabled="selectedPaletteCellIndex === null"
          @click="$emit('deletePaletteCell')"
        >
          <span class="palette-cell-action-icon" aria-hidden="true" v-html="trashIcon"></span>
        </button>
      </div>
    </div>

    <div v-else-if="activePalette.kind === 'history'" class="history-palette" aria-label="History palette">
      <div class="history-palette-group" aria-label="Selection history">
        <button
          v-for="(char, index) in activePalette.history"
          :key="`history-${index}`"
          class="palette-button"
          :class="{ 'is-selected': selectedChar === char, 'is-wide': isWidePaletteChar(char) }"
          type="button"
          :disabled="char === null"
          :title="char ? getCodeLabel(char.codePointAt(0) ?? 0) : 'Empty'"
          @click="char && $emit('selectChar', char, getPaletteCharWidth(char), $event.shiftKey)"
        >
          <span class="palette-button-text" :class="getPaletteGlyphClass(char)">{{ char ?? "" }}</span>
        </button>
      </div>
    </div>

    <div v-else-if="activePalette.kind === 'keyboard-input'" class="keyboard-palette">
      <input
        class="palette-text-input"
        :value="activePalette.value"
        aria-label="Keyboard character input"
        @compositionstart="isKeyboardComposing = true"
        @compositionend="handleKeyboardCompositionEnd(($event.target as HTMLInputElement).value)"
        @input="handleKeyboardInput(($event.target as HTMLInputElement).value)"
      />
    </div>

    <div v-else-if="activePalette.kind === 'similar'" class="similar-palette">
      <div class="similar-search-row">
        <input
          class="palette-text-input"
          :value="activePalette.query"
          aria-label="Similar character search"
          placeholder="Search"
          :disabled="activePalette.isSearching"
          @input="$emit('updateSimilarQuery', ($event.target as HTMLInputElement).value)"
        />
        <button class="palette-action-button" type="button" :disabled="activePalette.isSearching" @click="$emit('startSimilarSearch')">Search</button>
        <button class="palette-action-button" type="button" :disabled="!activePalette.isSearching" @click="$emit('cancelSimilarSearch')">Cancel</button>
      </div>
      <div class="similar-params">
        <label class="similar-param similar-param--wide">
          <span>Font</span>
          <input
            class="palette-text-input"
            :value="activePalette.fontFamily"
            :disabled="activePalette.isSearching"
            @input="$emit('updateSimilarFontFamily', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="similar-param">
          <span>Size</span>
          <select
            class="palette-select"
            :value="activePalette.canvasSize"
            :disabled="activePalette.isSearching"
            @change="$emit('updateSimilarCanvasSize', Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="16">16</option>
            <option :value="32">32</option>
          </select>
        </label>
        <label class="similar-param">
          <span>Threshold</span>
          <input
            class="palette-text-input"
            type="number"
            min="0"
            max="100"
            step="1"
            :value="activePalette.threshold"
            :disabled="activePalette.isSearching"
            @input="$emit('updateSimilarThreshold', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <label class="similar-param">
          <span>Max</span>
          <input
            class="palette-text-input"
            type="number"
            min="1"
            max="2048"
            step="1"
            :value="activePalette.maxResults"
            :disabled="activePalette.isSearching"
            @input="$emit('updateSimilarMaxResults', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <label class="similar-check">
          <input
            type="checkbox"
            :checked="activePalette.widthMatch"
            :disabled="activePalette.isSearching"
            @change="$emit('updateSimilarWidthMatch', ($event.target as HTMLInputElement).checked)"
          />
          <span>Width</span>
        </label>
      </div>
      <div class="similar-status">
        <span>{{ activePalette.status }}</span>
        <span>{{ activePalette.results.length }} hits</span>
        <span>Scanned {{ activePalette.checkedPageCount }}/{{ activePalette.totalPageCount }} present pages</span>
      </div>
      <div class="similar-results" aria-label="Similar character results">
        <button
          v-for="result in activePalette.results"
          :key="`${result.codePoint}-${result.score}`"
          class="palette-button"
          :class="{ 'is-selected': selectedChar === result.char, 'is-wide': result.width === 2 }"
          type="button"
          :title="getSimilarResultTitle(result)"
          @click="$emit('selectChar', result.char, result.width, $event.shiftKey)"
        >
          <span class="palette-button-text" :class="getPaletteGlyphClass(result.char)">{{ result.char }}</span>
        </button>
      </div>
    </div>

    <div v-else class="unicode-palette">
      <input
        class="palette-text-input"
        :value="activePalette.query"
        aria-label="Unicode code search"
        placeholder="U+3042"
        @input="handleUnicodeQuery(($event.target as HTMLInputElement).value)"
      />
      <div ref="unicodeScrollRef" class="unicode-scroll" aria-label="Unicode character table" @scroll="handleUnicodeScroll">
        <div class="unicode-spacer" :style="unicodeSpacerStyle">
          <div class="unicode-rows" :style="unicodeRowsStyle">
            <div v-for="row in unicodeRows" :key="row.row" class="unicode-row">
              <span class="unicode-row-code">{{ getCodeLabel(row.codeStart) }}</span>
              <button
                v-for="code in row.chars"
                :key="code"
                class="palette-button"
                :class="{ 'is-selected': selectedChar === getUnicodeChar(code), 'is-wide': isWidePaletteChar(getUnicodeChar(code)) }"
                type="button"
                :disabled="getUnicodeChar(code) === ''"
                :title="getCodeLabel(code)"
                @click="selectUnicodeChar(code, $event)"
              >
                <span class="palette-button-text" :class="getPaletteGlyphClass(getUnicodeChar(code))">{{ getUnicodeChar(code) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
