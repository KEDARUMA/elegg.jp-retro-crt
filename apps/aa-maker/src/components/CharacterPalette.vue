<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { getCharWidth, getFirstGrapheme } from "../model/gridOperations";

type NormalPalette = {
  kind: "normal";
  id: string;
  name: string;
  columns?: number;
  startCode?: number;
  chars: string[];
};

type HistoryPalette = {
  kind: "history";
  id: string;
  name: string;
  columns: number;
  history: (string | null)[];
  editableChars: (string | null)[];
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

type Palette = NormalPalette | HistoryPalette | KeyboardInputPalette | UnicodePalette;

const props = defineProps<{
  palettes: Palette[];
  activePalette: Palette;
  activePaletteId: string;
  selectedChar: string | null;
  selectedCode: number | null;
  canvasColor: string;
  foregroundDefaultColor: string;
}>();

const emit = defineEmits<{
  selectPalette: [paletteId: string];
  selectChar: [char: string, width: 1 | 2, fillEmptyOnly: boolean];
  keyboardInput: [value: string];
  updateUnicodeQuery: [query: string];
  updateUnicodeScrollOffset: [scrollOffset: number];
  assignHistoryChar: [index: number];
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

  return `${props.selectedChar}(${getCodeLabel(props.selectedCode)})`;
});
const paletteDisplayStyle = computed(() => ({
  "--aa-palette-canvas-color": `#${props.canvasColor}`,
  "--aa-palette-fgdc": `#${props.foregroundDefaultColor}`,
}));

function getPaletteCode(palette: NormalPalette, char: string, index: number) {
  if (typeof palette.startCode === "number") {
    return palette.startCode + index;
  }

  return char.codePointAt(0) ?? 0;
}

function getCodeLabel(code: number, isByteCode = false) {
  if (isByteCode) {
    return `0x${code.toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
}

function getPaletteCharWidth(palette: NormalPalette, char: string): 1 | 2 {
  if (typeof palette.startCode === "number") {
    return 1;
  }

  return getCharWidth(char);
}

function isWidePaletteChar(palette: NormalPalette, char: string) {
  return getPaletteCharWidth(palette, char) === 2;
}

function getUnicodePalette() {
  return props.activePalette.kind === "unicode" ? props.activePalette : { query: "", scrollOffset: 0 };
}

function getUnicodeChar(code: number) {
  if (code >= 0xd800 && code <= 0xdfff) {
    return "";
  }

  return String.fromCodePoint(code);
}

function selectUnicodeChar(code: number, event: MouseEvent) {
  const char = getUnicodeChar(code);

  if (char) {
    emit("selectChar", char, getCharWidth(char), event.shiftKey);
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
    emit("selectChar", char, getCharWidth(char), false);
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
    <h2>Character Palette</h2>
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
      <span class="palette-code">{{ selectedCharacterLabel }}</span>
    </label>
    <div v-if="activePalette.kind === 'normal'" class="char-palette" aria-label="Character palette">
      <button
        v-for="(char, index) in activePalette.chars"
        :key="`${activePalette.id}-${index}`"
        class="palette-button"
        :class="{ 'is-selected': selectedChar === char, 'is-wide': isWidePaletteChar(activePalette, char) }"
        type="button"
        :data-code="getPaletteCode(activePalette, char, index)"
        :title="getCodeLabel(getPaletteCode(activePalette, char, index), typeof activePalette.startCode === 'number')"
        @click="$emit('selectChar', char, getPaletteCharWidth(activePalette, char), $event.shiftKey)"
      >
        <span class="palette-button-text">{{ char }}</span>
      </button>
    </div>

    <div v-else-if="activePalette.kind === 'history'" class="history-palette" aria-label="History palette">
      <div class="history-palette-group" aria-label="Selection history">
        <button
          v-for="(char, index) in activePalette.history"
          :key="`history-${index}`"
          class="palette-button"
          :class="{ 'is-selected': selectedChar === char, 'is-wide': char !== null && getCharWidth(char) === 2 }"
          type="button"
          :disabled="char === null"
          :title="char ? getCodeLabel(char.codePointAt(0) ?? 0) : 'Empty'"
          @click="char && $emit('selectChar', char, getCharWidth(char), $event.shiftKey)"
        >
          <span class="palette-button-text">{{ char ?? "" }}</span>
        </button>
      </div>
      <div class="history-palette-group" aria-label="Editable history cells">
        <button
          v-for="(char, index) in activePalette.editableChars"
          :key="`history-editable-${index}`"
          class="palette-button"
          :class="{ 'is-selected': selectedChar === char, 'is-wide': char !== null && getCharWidth(char) === 2 }"
          type="button"
          :disabled="char === null"
          :title="char ? getCodeLabel(char.codePointAt(0) ?? 0) : 'Empty'"
          @click="char && $emit('selectChar', char, getCharWidth(char), $event.shiftKey)"
          @contextmenu.prevent="$emit('assignHistoryChar', index)"
        >
          <span class="palette-button-text">{{ char ?? "" }}</span>
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
                :class="{ 'is-selected': selectedChar === getUnicodeChar(code), 'is-wide': getUnicodeChar(code) !== '' && getCharWidth(getUnicodeChar(code)) === 2 }"
                type="button"
                :disabled="getUnicodeChar(code) === ''"
                :title="getCodeLabel(code)"
                @click="selectUnicodeChar(code, $event)"
              >
                <span class="palette-button-text">{{ getUnicodeChar(code) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
