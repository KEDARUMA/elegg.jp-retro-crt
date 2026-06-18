<script setup lang="ts">
import { ref } from "vue";
import ColorPickerModal from "./components/ColorPickerModal.vue";
import EditorGrid from "./components/EditorGrid.vue";
import ExportDocumentModal from "./components/ExportDocumentModal.vue";
import ImageToAsciiArtModal from "./components/ImageToAsciiArtModal.vue";
import SaveDocumentModal from "./components/SaveDocumentModal.vue";
import SettingsModal from "./components/SettingsModal.vue";
import ToastStack from "./components/ToastStack.vue";
import SidePanel from "./components/SidePanel.vue";
import Toolbox from "./components/Toolbox.vue";
import TopMenu from "./components/TopMenu.vue";
import { AA_MAKER_VERSION } from "./appMeta";
import { useAaMaker } from "./composables/useAaMaker";
import { useToastQueue, type ToastKind } from "./composables/useToastQueue";
import type { ImageToAsciiApplyGrid } from "./search/imageToAsciiMatching";

const aaMaker = useAaMaker();
const { toasts, pushToast } = useToastQueue();
type ExportFormat = "plain" | "ansi" | "mds" | "html";
type ExportDestination = "download" | "clipboard";

const isSaveDocumentModalOpen = ref(false);
const isExportDocumentModalOpen = ref(false);
const isImageToAsciiArtModalOpen = ref(false);
const isSettingsModalOpen = ref(false);
const isSettingsCanvasColorPickerOpen = ref(false);

function openImageToAsciiArtModal() {
  aaMaker.setImageToAsciiArtModalDirty(false);
  isImageToAsciiArtModalOpen.value = true;
}

function closeImageToAsciiArtModal() {
  aaMaker.setImageToAsciiArtModalDirty(false);
  isImageToAsciiArtModalOpen.value = false;
}

function openSaveDocumentModal() {
  isSaveDocumentModalOpen.value = true;
}

function saveDocument(name: string) {
  isSaveDocumentModalOpen.value = false;
  aaMaker.saveDocument(name);
}

function exportDocument(format: ExportFormat, destination: ExportDestination) {
  isExportDocumentModalOpen.value = false;
  void aaMaker.exportDocument(format, destination);
}

function openSettingsModal() {
  isSettingsModalOpen.value = true;
}

function closeSettingsModal() {
  isSettingsModalOpen.value = false;
  isSettingsCanvasColorPickerOpen.value = false;
}

function openSettingsCanvasColorPicker() {
  aaMaker.closeSelectedColorPicker();
  isSettingsCanvasColorPickerOpen.value = true;
}

function applySettingsCanvasColor(_mode: "fgc" | "bgc", color: string | null) {
  if (color !== null) {
    aaMaker.setCanvasColor(color);
  }

  isSettingsCanvasColorPickerOpen.value = false;
}

function applySettingsGridSize(width: number, height: number) {
  aaMaker.resizeDocument(width, height);
}

function handleImageToAsciiToast(payload: { kind: Exclude<ToastKind, "info">; message: string }) {
  pushToast(payload.message, payload.kind);
}

function applyImageToAsciiArt(cells: ImageToAsciiApplyGrid) {
  aaMaker.applyImageToAsciiGrid(cells);
  aaMaker.setImageToAsciiArtModalDirty(false);
  isImageToAsciiArtModalOpen.value = false;
}
</script>

<template>
  <main class="aa-maker-shell" aria-label="AA Maker">
    <TopMenu
      :is-unicode-glyph-page-scan-running="aaMaker.isUnicodeGlyphPageScanRunning.value"
      @save-document="openSaveDocumentModal"
      @load-document="aaMaker.loadDocument"
      @save-library="aaMaker.saveLibrary"
      @load-library="aaMaker.loadLibrary"
      @export-document="isExportDocumentModalOpen = true"
      @open-settings="openSettingsModal"
      @invert-canvas-background="aaMaker.invertCanvasBackground"
      @open-image-to-ascii-art="openImageToAsciiArtModal"
      @scan-unicode-glyph-pages="aaMaker.scanAllUnicodeGlyphPages"
    />
    <Toolbox
      :tools="aaMaker.tools.value"
      :active-tool="aaMaker.toolState.activeTool"
      :selected-char="aaMaker.toolState.selectedChar"
      :selected-foreground-color="aaMaker.toolState.selectedFGC"
      :selected-background-color="aaMaker.toolState.selectedBGC"
      :canvas-background-color="aaMaker.documentModel.canvasBGC"
      :selected-char-attention-key="aaMaker.selectedCharAttentionKey.value"
      :is-grid-visible="aaMaker.isGridVisible.value"
      @select-tool="aaMaker.selectTool"
      @open-selected-foreground-color-picker="aaMaker.openSelectedFGCColorPicker"
      @open-selected-background-color-picker="aaMaker.openSelectedBGCColorPicker"
      @toggle-grid-visibility="aaMaker.toggleGridVisibility"
    />
    <EditorGrid
      :cells="aaMaker.gridCells.value"
      :grid-width="aaMaker.documentModel.width"
      :grid-height="aaMaker.documentModel.height"
      :is-grid-visible="aaMaker.isGridVisible.value"
      :get-cell-text="aaMaker.getCellText"
      :get-cell-class="aaMaker.getCellClass"
      :get-cell-glyph-class="aaMaker.getCellGlyphClass"
      :get-cell-style="aaMaker.getCellStyle"
      :grid-line-style="aaMaker.gridLineStyle.value"
      :cursor-style="aaMaker.cursorStyle.value"
      :selection-style="aaMaker.selectionStyle.value"
      :highlight-cells="aaMaker.highlightCells.value"
      :stamp-preview-cells="aaMaker.stampPreviewCells.value"
      :text-draft="aaMaker.textDraft.value"
      :selected-foreground-color="aaMaker.toolState.selectedFGC"
      :selected-background-color="aaMaker.toolState.selectedBGC"
      :canvas-background-color="aaMaker.documentModel.canvasBGC"
      :width-mode="aaMaker.widthMode.value"
      @cell-enter="aaMaker.handleCellEnter"
      @cell-leave="aaMaker.handleCellLeave"
      @cell-down="aaMaker.handleCellDown"
      @cell-up="aaMaker.handleCellUp"
      @cell-context="aaMaker.handleCellContext"
      @grid-measure-down="aaMaker.handleGridMeasureDown"
      @grid-wheel="aaMaker.handleGridWheel"
      @highlight-context="aaMaker.handleHighlightContext"
      @highlight-move="aaMaker.handleHighlightMove"
      @text-editor-update="aaMaker.updateTextEditorValue"
      @text-editor-confirm="aaMaker.confirmTextEditor"
      @text-editor-cancel="aaMaker.closeTextEditor"
    />
    <SidePanel
      :palettes="aaMaker.palettes"
      :active-palette="aaMaker.activePalette.value"
      :active-palette-id="aaMaker.activePaletteId.value"
      :selected-char="aaMaker.toolState.selectedChar"
      :selected-code="aaMaker.selectedPaletteCode.value"
      :selected-palette-cell-index="aaMaker.selectedPaletteCellIndex.value"
      :canvas-color="aaMaker.documentModel.canvasBGC"
      :foreground-default-color="aaMaker.foregroundDefaultColor.value"
      :width-mode="aaMaker.widthMode.value"
      :info="aaMaker.info.value"
      :layers="aaMaker.layerList.value"
      :active-layer-id="aaMaker.documentModel.activeLayerId"
      :active-tool="aaMaker.toolState.activeTool"
      :stamp-sets="aaMaker.stampSets"
      :active-stamp-set-id="aaMaker.activeStampSetId.value"
      :active-stamp-id="aaMaker.activeStampId.value"
      @select-palette="aaMaker.selectPalette"
      @select-char="aaMaker.selectPaletteChar"
      @select-palette-cell="aaMaker.selectPaletteCell"
      @insert-palette-cell="aaMaker.insertPaletteCell"
      @delete-palette-cell="aaMaker.deletePaletteCell"
      @overwrite-palette-cell="aaMaker.overwritePaletteCell"
      @insert-stamp="aaMaker.insertStamp"
      @delete-stamp="aaMaker.deleteStamp"
      @overwrite-stamp="aaMaker.overwriteStamp"
      @rename-stamp="aaMaker.renameStamp"
      @apply-palette-list="aaMaker.applyPaletteList"
      @select-stamp-set="aaMaker.selectStampSet"
      @select-stamp="aaMaker.selectStamp"
      @apply-stamp-set-list="aaMaker.applyStampSetList"
      @keyboard-input="aaMaker.handleKeyboardInput"
      @update-unicode-query="aaMaker.updateUnicodeQuery"
      @update-unicode-scroll-offset="aaMaker.updateUnicodeScrollOffset"
      @update-similar-query="aaMaker.updateSimilarQuery"
      @update-similar-font-family="aaMaker.updateSimilarFontFamily"
      @update-similar-canvas-size="aaMaker.updateSimilarCanvasSize"
      @update-similar-threshold="aaMaker.updateSimilarThreshold"
      @update-similar-max-results="aaMaker.updateSimilarMaxResults"
      @begin-similar-bitmap-stroke="aaMaker.beginSimilarBitmapStroke"
      @paint-similar-bitmap-pixel="aaMaker.paintSimilarBitmapPixel"
      @clear-similar-bitmap="aaMaker.clearSimilarBitmap"
      @start-similar-search="aaMaker.startSimilarSearch"
      @cancel-similar-search="aaMaker.cancelSimilarSearch"
      @select-layer="aaMaker.selectLayer"
      @toggle-layer-visible="aaMaker.toggleLayerVisible"
      @toggle-layer-locked="aaMaker.toggleLayerLocked"
      @move-layer="aaMaker.moveLayer"
      @rename-layer="aaMaker.renameLayer"
      @add-layer="aaMaker.addLayer"
      @delete-active-layer="aaMaker.deleteActiveLayer"
    />
    <div
      v-if="aaMaker.toolCursorOverlay.value"
      class="tool-cursor-overlay"
      :class="{ 'is-cell-preview': aaMaker.toolCursorOverlay.value.kind === 'cell' }"
      :style="aaMaker.toolCursorOverlay.value.style"
      aria-hidden="true"
    >
      <span
        v-if="aaMaker.toolCursorOverlay.value.kind === 'cell'"
        class="tool-cursor-cell"
        :style="aaMaker.toolCursorOverlay.value.cellStyle"
      >{{ aaMaker.toolCursorOverlay.value.text }}</span>
      <span v-else class="tool-cursor-icon" v-html="aaMaker.toolCursorOverlay.value.icon ?? ''"></span>
    </div>
    <footer class="bottom-status-bar" aria-label="Status">
      <span>AA-Maker v{{ AA_MAKER_VERSION }} | {{ aaMaker.zoomLabel.value }} | Canvas Color: {{ aaMaker.documentModel.canvasBGC }}</span>
    </footer>
    <div
      v-if="aaMaker.selectionContextMenuStyle?.value"
      class="selection-context-menu"
      :style="aaMaker.selectionContextMenuStyle?.value"
      role="menu"
      aria-label="Highlight actions"
      @pointerdown.stop
      @contextmenu.prevent.stop
    >
      <button type="button" role="menuitem" @click="aaMaker.clearSelectionColors">Clear Colors</button>
      <button type="button" role="menuitem" @click="aaMaker.openSelectionFGCColorPicker">Text Color...</button>
      <button type="button" role="menuitem" @click="aaMaker.openSelectionBGCColorPicker">Background Color...</button>
    </div>
    <SaveDocumentModal
      v-if="isSaveDocumentModalOpen"
      :initial-name="aaMaker.documentModel.name"
      @save="saveDocument"
      @cancel="isSaveDocumentModalOpen = false"
    />
    <ExportDocumentModal
      v-if="isExportDocumentModalOpen"
      @export="exportDocument"
      @cancel="isExportDocumentModalOpen = false"
    />
    <ImageToAsciiArtModal
      v-if="isImageToAsciiArtModalOpen"
      :width-mode="aaMaker.widthMode.value"
      @dirty-change="aaMaker.setImageToAsciiArtModalDirty"
      @toast="handleImageToAsciiToast"
      @apply="applyImageToAsciiArt"
      @close="closeImageToAsciiArtModal"
    />
    <SettingsModal
      v-if="isSettingsModalOpen"
      :language="aaMaker.language.value"
      :canvas-color="aaMaker.documentModel.canvasBGC"
      :width-mode="aaMaker.widthMode.value"
      :grid-width="aaMaker.documentModel.width"
      :grid-height="aaMaker.documentModel.height"
      @close="closeSettingsModal"
      @update-language="aaMaker.setLanguage"
      @update-width-mode="aaMaker.setWidthMode"
      @update-grid-size="applySettingsGridSize"
      @open-canvas-color-picker="openSettingsCanvasColorPicker"
    />
    <ColorPickerModal
      v-if="aaMaker.selectedColorPickerMode.value"
      :mode="aaMaker.selectedColorPickerMode.value"
      :initial-color="aaMaker.colorPickerInitialColor?.value ?? (aaMaker.selectedColorPickerMode.value === 'fgc' ? aaMaker.toolState.selectedFGC : aaMaker.toolState.selectedBGC ?? aaMaker.documentModel.canvasBGC)"
      :swatches="aaMaker.colorSchemes[0]?.colors ?? []"
      :allow-none="aaMaker.colorPickerAllowsNone?.value ?? aaMaker.selectedColorPickerMode.value === 'bgc'"
      @apply="aaMaker.selectSelectedColor"
      @cancel="aaMaker.closeSelectedColorPicker"
    />
    <ColorPickerModal
      v-if="isSettingsCanvasColorPickerOpen"
      mode="bgc"
      :initial-color="aaMaker.documentModel.canvasBGC"
      :swatches="aaMaker.colorSchemes[0]?.colors ?? []"
      :allow-none="false"
      @apply="applySettingsCanvasColor"
      @cancel="isSettingsCanvasColorPickerOpen = false"
    />
    <ToastStack :toasts="toasts" />
  </main>
</template>
