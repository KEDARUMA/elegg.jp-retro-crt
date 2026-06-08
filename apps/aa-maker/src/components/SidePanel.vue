<script setup lang="ts">
import { nextTick, ref } from "vue";
import eyeClosedIcon from "../assets/icons/eye-closed.svg?raw";
import eyeIcon from "../assets/icons/eye.svg?raw";
import lockOpenIcon from "../assets/icons/lock-open.svg?raw";
import lockIcon from "../assets/icons/lock.svg?raw";
import newFileIcon from "../assets/icons/new-file.svg?raw";
import trashIcon from "../assets/icons/trash.svg?raw";
import CharacterPalette from "./CharacterPalette.vue";
import ConfirmModal from "./ConfirmModal.vue";
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

const emit = defineEmits<{
  selectPalette: [paletteId: string];
  selectChar: [char: string, width: 1 | 2];
  keyboardInput: [value: string];
  updateUnicodeQuery: [query: string];
  updateUnicodeScrollOffset: [scrollOffset: number];
  assignHistoryChar: [index: number];
  selectLayer: [layerId: string];
  toggleLayerVisible: [layerId: string];
  toggleLayerLocked: [layerId: string];
  moveLayer: [draggedLayerId: string, targetLayerId: string, placement: "before" | "after"];
  renameLayer: [layerId: string, name: string];
  addLayer: [];
  deleteActiveLayer: [];
}>();

const editingLayerId = ref<string | null>(null);
const editingLayerName = ref("");
const isDeleteConfirmOpen = ref(false);

function startLayerDrag(event: DragEvent, layerId: string) {
  event.dataTransfer?.setData("text/plain", layerId);
}

function getDragLayerId(event: DragEvent) {
  return event.dataTransfer?.getData("text/plain") ?? "";
}

function getDropPlacement(event: DragEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function startLayerNameEdit(layer: Layer) {
  editingLayerId.value = layer.id;
  editingLayerName.value = layer.name;
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(".layer-name-input");
    input?.focus();
    input?.select();
  });
}

function commitLayerName(layerId: string) {
  if (editingLayerId.value !== layerId) {
    return;
  }

  emit("renameLayer", layerId, editingLayerName.value);
  editingLayerId.value = null;
}

function cancelLayerNameEdit() {
  editingLayerId.value = null;
}

function requestDeleteActiveLayer() {
  isDeleteConfirmOpen.value = true;
}

function confirmDeleteActiveLayer() {
  isDeleteConfirmOpen.value = false;
  emit("deleteActiveLayer");
}

function cancelDeleteActiveLayer() {
  isDeleteConfirmOpen.value = false;
}
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
        :class="{ 'is-active': layer.id === activeLayerId, 'is-disabled': !layer.visible || layer.locked }"
        :draggable="editingLayerId !== layer.id"
        @click="$emit('selectLayer', layer.id)"
        @dragstart="startLayerDrag($event, layer.id)"
        @dragover.prevent
        @drop.prevent="$emit('moveLayer', getDragLayerId($event), layer.id, getDropPlacement($event))"
      >
        <button class="layer-icon-button" type="button" :aria-label="`${layer.name} の表示を切り替え`" @click.stop="$emit('toggleLayerVisible', layer.id)">
          <span class="layer-icon" aria-hidden="true" v-html="layer.visible ? eyeIcon : eyeClosedIcon"></span>
        </button>
        <input
          v-if="editingLayerId === layer.id"
          v-model="editingLayerName"
          class="layer-name-input"
          type="text"
          aria-label="レイヤー名"
          autofocus
          @click.stop
          @keydown.enter.prevent="commitLayerName(layer.id)"
          @keydown.esc.prevent="cancelLayerNameEdit"
          @blur="commitLayerName(layer.id)"
        />
        <span v-else class="layer-name" @click.stop="startLayerNameEdit(layer)">{{ layer.name }}</span>
        <button class="layer-icon-button" type="button" :aria-label="`${layer.name} のロックを切り替え`" @click.stop="$emit('toggleLayerLocked', layer.id)">
          <span class="layer-icon" aria-hidden="true" v-html="layer.locked ? lockIcon : lockOpenIcon"></span>
        </button>
      </div>
      <div class="layer-actions">
        <button type="button" aria-label="新規レイヤーを追加" @click="$emit('addLayer')">
          <span class="layer-icon" aria-hidden="true" v-html="newFileIcon"></span>
        </button>
        <button type="button" aria-label="選択中レイヤーを削除" :disabled="layers.length <= 1" @click="requestDeleteActiveLayer">
          <span class="layer-icon" aria-hidden="true" v-html="trashIcon"></span>
        </button>
      </div>
    </section>

    <ConfirmModal v-if="isDeleteConfirmOpen" message="Delete this layer?" @confirm="confirmDeleteActiveLayer" @cancel="cancelDeleteActiveLayer" />
  </aside>
</template>
