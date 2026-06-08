<script setup lang="ts">
import CharacterPalette from "./CharacterPalette.vue";
import InfoPanel from "./InfoPanel.vue";
import type { Layer, Tool } from "../model/types";

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

type InfoState = {
  x: string;
  y: string;
  w: string;
  h: string;
  char: string | null;
  code: string;
  fgc: string;
  bgc: string;
};

defineProps<{
  palettes: Palette[];
  activePalette: Palette;
  activePaletteId: string;
  selectedChar: string | null;
  selectedCode: number | null;
  info: InfoState;
  layers: Layer[];
  activeLayerId: string;
  activeTool: Tool;
}>();

defineEmits<{
  selectPalette: [paletteId: string];
  selectChar: [char: string, width: 1 | 2];
  keyboardInput: [value: string];
  updateUnicodeQuery: [query: string];
  updateUnicodeScrollOffset: [scrollOffset: number];
  assignHistoryChar: [index: number];
}>();
</script>

<template>
  <aside class="side-panel" aria-label="Sidebar">
    <InfoPanel :info="info" />
    <CharacterPalette
      v-if="activeTool !== 'stamp'"
      :palettes="palettes"
      :active-palette="activePalette"
      :active-palette-id="activePaletteId"
      :selected-char="selectedChar"
      :selected-code="selectedCode"
      @select-palette="(paletteId) => $emit('selectPalette', paletteId)"
      @select-char="(char, width) => $emit('selectChar', char, width)"
      @keyboard-input="(value) => $emit('keyboardInput', value)"
      @update-unicode-query="(query) => $emit('updateUnicodeQuery', query)"
      @update-unicode-scroll-offset="(scrollOffset) => $emit('updateUnicodeScrollOffset', scrollOffset)"
      @assign-history-char="(index) => $emit('assignHistoryChar', index)"
    />
    <section v-else class="panel-section panel-section--grow">
      <h2>Stamp</h2>
      <div class="empty-note">MVP 対象外</div>
    </section>

    <section class="panel-section">
      <h2>Layer</h2>
      <div
        v-for="layer in layers"
        :key="layer.id"
        class="layer-item"
        :class="{ 'is-active': layer.id === activeLayerId }"
      >
        <span>{{ layer.name }}</span>
        <span>{{ layer.visible ? "表示" : "非表示" }}</span>
      </div>
    </section>

  </aside>
</template>
