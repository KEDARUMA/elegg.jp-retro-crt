<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import editIcon from "../assets/icons/edit.svg?raw";
import eyeClosedIcon from "../assets/icons/eye-closed.svg?raw";
import eyeIcon from "../assets/icons/eye.svg?raw";
import lockOpenIcon from "../assets/icons/lock-open.svg?raw";
import lockIcon from "../assets/icons/lock.svg?raw";
import plusIcon from "../assets/icons/plus.svg?raw";
import newFileIcon from "../assets/icons/new-file.svg?raw";
import renameIcon from "../assets/icons/rename.svg?raw";
import trashIcon from "../assets/icons/trash.svg?raw";
import CharacterPalette from "./CharacterPalette.vue";
import ConfirmModal from "./ConfirmModal.vue";
import EditableListModal from "./EditableListModal.vue";
import InfoPanel from "./InfoPanel.vue";
import type { Layer, Stamp, StampCell, Tool } from "../model/types";
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

type StampSet = {
  id: string;
  name: string;
  stamps: Stamp[];
};

type EditableListItem = {
  id: string;
  name: string;
  protected?: boolean;
};

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
  info: InfoState;
  layers: Layer[];
  activeLayerId: string;
  activeTool: Tool;
  stampSets: StampSet[];
  activeStampSetId: string;
  activeStampId: string;
}>();

const emit = defineEmits<{
  selectPalette: [paletteId: string];
  selectChar: [char: string, width: 1 | 2, fillEmptyOnly: boolean];
  selectPaletteCell: [index: number];
  insertPaletteCell: [];
  deletePaletteCell: [];
  overwritePaletteCell: [index: number];
  selectStampSet: [stampSetId: string];
  selectStamp: [stampId: string];
  insertStamp: [];
  deleteStamp: [];
  overwriteStamp: [stampId: string];
  renameStamp: [stampId: string, name: string];
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
  selectLayer: [layerId: string];
  toggleLayerVisible: [layerId: string];
  toggleLayerLocked: [layerId: string];
  moveLayer: [draggedLayerId: string, targetLayerId: string, placement: "before" | "after"];
  renameLayer: [layerId: string, name: string];
  addLayer: [];
  deleteActiveLayer: [];
  applyPaletteList: [items: EditableListItem[]];
  applyStampSetList: [items: EditableListItem[]];
}>();

const PROTECTED_PALETTE_IDS = new Set(["cp437", "history", "keyboard-input", "unicode", "similar"]);
const editingLayerId = ref<string | null>(null);
const editingLayerName = ref("");
const editingStampId = ref<string | null>(null);
const editingStampName = ref("");
const isStampNameComposing = ref(false);
const isDeleteConfirmOpen = ref(false);
const editingListKind = ref<"palette" | "stamp-set" | null>(null);
const activeStampSetStamps = computed(() => props.stampSets.find((stampSet) => stampSet.id === props.activeStampSetId)?.stamps ?? []);
const paletteListEditorItems = computed(() =>
  props.palettes.map((palette) => ({
    id: palette.id,
    name: palette.name,
    protected: PROTECTED_PALETTE_IDS.has(palette.id),
  })),
);
const stampSetListEditorItems = computed(() =>
  props.stampSets.map((stampSet) => ({
    id: stampSet.id,
    name: stampSet.name,
  })),
);
const paletteDisplayStyle = computed(() => ({
  "--aa-palette-canvas-color": `#${props.canvasColor}`,
  "--aa-palette-fgdc": `#${props.foregroundDefaultColor}`,
}));

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

function handleStampSetChange(event: Event) {
  if (event.target instanceof HTMLSelectElement) {
    emit("selectStampSet", event.target.value);
  }
}

function handleStampContextMenu(stampId: string) {
  emit("overwriteStamp", stampId);
}

function handleStampItemKeydown(event: KeyboardEvent, stampId: string) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  emit("selectStamp", stampId);
}

function startStampNameEdit() {
  const stamp = activeStampSetStamps.value.find((candidate) => candidate.id === props.activeStampId);

  if (!stamp) {
    return;
  }

  editingStampId.value = stamp.id;
  editingStampName.value = stamp.name;
  isStampNameComposing.value = false;
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(".stamp-name-input");
    input?.focus();
    input?.select();
  });
}

function commitStampName(stampId: string) {
  if (editingStampId.value !== stampId) {
    return;
  }

  emit("renameStamp", stampId, editingStampName.value);
  editingStampId.value = null;
  isStampNameComposing.value = false;
}

function cancelStampNameEdit() {
  editingStampId.value = null;
  isStampNameComposing.value = false;
}

function handleStampNameEnter(event: KeyboardEvent, stampId: string) {
  event.stopPropagation();

  if (event.isComposing || isStampNameComposing.value) {
    return;
  }

  event.preventDefault();
  commitStampName(stampId);
}

function handleStampNameCompositionStart() {
  isStampNameComposing.value = true;
}

function handleStampNameCompositionEnd() {
  window.setTimeout(() => {
    isStampNameComposing.value = false;
  }, 0);
}

function openPaletteListEditor() {
  editingListKind.value = "palette";
}

function openStampSetListEditor() {
  editingListKind.value = "stamp-set";
}

function closeListEditor() {
  editingListKind.value = null;
}

function applyPaletteList(items: EditableListItem[]) {
  emit("applyPaletteList", items);
  closeListEditor();
}

function applyStampSetList(items: EditableListItem[]) {
  emit("applyStampSetList", items);
  closeListEditor();
}

function getStampCellText(cell: StampCell | null) {
  return cell?.char === " " || !cell ? "\u00a0" : cell.char;
}

function getStampCellStyle(cell: StampCell | null) {
  return {
    color: `#${cell?.fgc ?? props.foregroundDefaultColor}`,
    backgroundColor: `#${cell?.bgc ?? props.canvasColor}`,
  };
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
      :selected-palette-cell-index="selectedPaletteCellIndex"
      :canvas-color="canvasColor"
      :foreground-default-color="foregroundDefaultColor"
      :width-mode="widthMode"
      @select-palette="(paletteId) => $emit('selectPalette', paletteId)"
      @select-char="(char, width, fillEmptyOnly) => $emit('selectChar', char, width, fillEmptyOnly)"
      @select-palette-cell="(index) => $emit('selectPaletteCell', index)"
      @insert-palette-cell="$emit('insertPaletteCell')"
      @delete-palette-cell="$emit('deletePaletteCell')"
      @overwrite-palette-cell="(index) => $emit('overwritePaletteCell', index)"
      @keyboard-input="(value) => $emit('keyboardInput', value)"
      @update-unicode-query="(query) => $emit('updateUnicodeQuery', query)"
      @update-unicode-scroll-offset="(scrollOffset) => $emit('updateUnicodeScrollOffset', scrollOffset)"
      @update-similar-query="(query) => $emit('updateSimilarQuery', query)"
      @update-similar-font-family="(fontFamily) => $emit('updateSimilarFontFamily', fontFamily)"
      @update-similar-canvas-size="(canvasSize) => $emit('updateSimilarCanvasSize', canvasSize)"
      @update-similar-threshold="(threshold) => $emit('updateSimilarThreshold', threshold)"
      @update-similar-width-match="(widthMatch) => $emit('updateSimilarWidthMatch', widthMatch)"
      @update-similar-max-results="(maxResults) => $emit('updateSimilarMaxResults', maxResults)"
      @start-similar-search="$emit('startSimilarSearch')"
      @cancel-similar-search="$emit('cancelSimilarSearch')"
      @edit-palette-list="openPaletteListEditor"
    />
    <section v-else class="panel-section panel-section--grow" :style="paletteDisplayStyle">
      <h2>Stamp</h2>
      <label class="palette-select-label">
        <select class="palette-select" :value="activeStampSetId" @change="handleStampSetChange">
          <option v-for="stampSet in stampSets" :key="stampSet.id" :value="stampSet.id">
            {{ stampSet.name }}
          </option>
        </select>
        <button class="palette-edit-button" type="button" aria-label="Edit stamp sets" title="Edit stamp sets" @click="openStampSetListEditor">
          <span class="palette-edit-button-icon" aria-hidden="true" v-html="editIcon"></span>
        </button>
      </label>
      <div class="stamp-list">
        <div
          v-for="stamp in activeStampSetStamps"
          :key="stamp.id"
          class="stamp-list-item"
          :class="{ 'is-selected': stamp.id === activeStampId, 'is-editing': stamp.id === editingStampId }"
          role="button"
          tabindex="0"
          :aria-pressed="stamp.id === activeStampId"
          @click="$emit('selectStamp', stamp.id)"
          @keydown="handleStampItemKeydown($event, stamp.id)"
          @contextmenu.prevent="handleStampContextMenu(stamp.id)"
        >
          <span v-if="editingStampId !== stamp.id" class="stamp-list-name">{{ stamp.name }}</span>
          <input
            v-else
            v-model="editingStampName"
            class="stamp-name-input"
            type="text"
            @click.stop
            @keydown.enter="handleStampNameEnter($event, stamp.id)"
            @keydown.esc.prevent.stop="cancelStampNameEdit"
            @compositionstart="handleStampNameCompositionStart"
            @compositionend="handleStampNameCompositionEnd"
            @blur="commitStampName(stamp.id)"
          />
          <div class="stamp-list-preview" aria-hidden="true">
            <div v-for="(row, rowIndex) in stamp.cells" :key="`${stamp.id}-row-${rowIndex}`" class="stamp-list-preview-row">
              <span
                v-for="(cell, cellIndex) in row"
                :key="`${stamp.id}-${rowIndex}-${cellIndex}`"
                class="stamp-list-preview-cell"
                :style="getStampCellStyle(cell)"
              >{{ getStampCellText(cell) }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="palette-cell-actions" aria-label="Stamp actions">
        <button class="palette-cell-action-button" type="button" aria-label="Add stamp" title="Add stamp" @click="$emit('insertStamp')">
          <span class="palette-cell-action-icon" aria-hidden="true" v-html="plusIcon"></span>
        </button>
        <button
          class="palette-cell-action-button"
          type="button"
          aria-label="Rename selected stamp"
          title="Rename selected stamp"
          :disabled="!activeStampId"
          @click="startStampNameEdit"
        >
          <span class="palette-cell-action-icon" aria-hidden="true" v-html="renameIcon"></span>
        </button>
        <button
          class="palette-cell-action-button"
          type="button"
          aria-label="Delete selected stamp"
          title="Delete selected stamp"
          :disabled="!activeStampId"
          @click="$emit('deleteStamp')"
        >
          <span class="palette-cell-action-icon" aria-hidden="true" v-html="trashIcon"></span>
        </button>
      </div>
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
        <span v-else class="layer-name" @dblclick.stop="startLayerNameEdit(layer)">{{ layer.name }}</span>
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
    <EditableListModal
      v-if="editingListKind === 'palette'"
      title="Edit Character Palettes"
      :items="paletteListEditorItems"
      :active-item-id="activePaletteId"
      new-item-label="Palette"
      @apply="applyPaletteList"
      @cancel="closeListEditor"
    />
    <EditableListModal
      v-if="editingListKind === 'stamp-set'"
      title="Edit Stamp Sets"
      :items="stampSetListEditorItems"
      :active-item-id="activeStampSetId"
      new-item-label="Stamp Set"
      @apply="applyStampSetList"
      @cancel="closeListEditor"
    />
  </aside>
</template>
