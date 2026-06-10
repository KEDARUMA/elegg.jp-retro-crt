<script setup lang="ts">
import { ref } from "vue";
import ColorPickerModal from "./components/ColorPickerModal.vue";
import EditorGrid from "./components/EditorGrid.vue";
import ExportDocumentModal from "./components/ExportDocumentModal.vue";
import SaveDocumentModal from "./components/SaveDocumentModal.vue";
import SidePanel from "./components/SidePanel.vue";
import Toolbox from "./components/Toolbox.vue";
import TopMenu from "./components/TopMenu.vue";
import { useAaMaker } from "./composables/useAaMaker";

const aaMaker = useAaMaker();
type ExportFormat = "plain" | "ansi" | "mds" | "html";
type ExportDestination = "download" | "clipboard";

const isSaveDocumentModalOpen = ref(false);
const isExportDocumentModalOpen = ref(false);

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
</script>

<template>
  <main class="aa-maker-shell" aria-label="AA Maker">
    <TopMenu
      @save-document="openSaveDocumentModal"
      @load-document="aaMaker.loadDocument"
      @export-document="isExportDocumentModalOpen = true"
      @invert-canvas-background="aaMaker.invertCanvasBackground"
    />
    <Toolbox
      :tools="aaMaker.tools.value"
      :active-tool="aaMaker.toolState.activeTool"
      :selected-char="aaMaker.toolState.selectedChar"
      :selected-foreground-color="aaMaker.toolState.selectedFGC"
      :selected-background-color="aaMaker.toolState.selectedBGC"
      :canvas-background-color="aaMaker.documentModel.canvasBGC"
      @select-tool="aaMaker.selectTool"
      @open-selected-foreground-color-picker="aaMaker.openSelectedFGCColorPicker"
      @open-selected-background-color-picker="aaMaker.openSelectedBGCColorPicker"
    />
    <EditorGrid
      :cells="aaMaker.gridCells"
      :get-cell-text="aaMaker.getCellText"
      :get-cell-class="aaMaker.getCellClass"
      :get-cell-style="aaMaker.getCellStyle"
      :grid-line-style="aaMaker.gridLineStyle.value"
      :selection-style="aaMaker.selectionStyle.value"
      :highlight-cells="aaMaker.highlightCells.value"
      :stamp-preview-cells="aaMaker.stampPreviewCells.value"
      :text-draft="aaMaker.textDraft.value"
      :selected-foreground-color="aaMaker.toolState.selectedFGC"
      :selected-background-color="aaMaker.toolState.selectedBGC"
      :canvas-background-color="aaMaker.documentModel.canvasBGC"
      @cell-enter="aaMaker.handleCellEnter"
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
      :canvas-color="aaMaker.documentModel.canvasBGC"
      :foreground-default-color="aaMaker.foregroundDefaultColor.value"
      :info="aaMaker.info.value"
      :layers="aaMaker.layerList.value"
      :active-layer-id="aaMaker.documentModel.activeLayerId"
      :active-tool="aaMaker.toolState.activeTool"
      :stamp-sets="aaMaker.stampSets"
      :active-stamp-set-id="aaMaker.activeStampSetId.value"
      :active-stamp-id="aaMaker.activeStampId.value"
      @select-palette="aaMaker.selectPalette"
      @select-char="aaMaker.selectPaletteChar"
      @select-stamp-set="aaMaker.selectStampSet"
      @select-stamp="aaMaker.selectStamp"
      @keyboard-input="aaMaker.handleKeyboardInput"
      @update-unicode-query="aaMaker.updateUnicodeQuery"
      @update-unicode-scroll-offset="aaMaker.updateUnicodeScrollOffset"
      @assign-history-char="aaMaker.assignHistoryChar"
      @select-layer="aaMaker.selectLayer"
      @toggle-layer-visible="aaMaker.toggleLayerVisible"
      @toggle-layer-locked="aaMaker.toggleLayerLocked"
      @move-layer="aaMaker.moveLayer"
      @rename-layer="aaMaker.renameLayer"
      @add-layer="aaMaker.addLayer"
      @delete-active-layer="aaMaker.deleteActiveLayer"
    />
    <footer class="bottom-status-bar" aria-label="Status">
      <span>{{ aaMaker.documentModel.name }}</span>
      <span>80 x 25</span>
      <span>{{ aaMaker.zoomLabel.value }}</span>
      <span>Canvas Color: {{ aaMaker.documentModel.canvasBGC }}</span>
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
    <ColorPickerModal
      v-if="aaMaker.selectedColorPickerMode.value"
      :mode="aaMaker.selectedColorPickerMode.value"
      :initial-color="aaMaker.colorPickerInitialColor?.value ?? (aaMaker.selectedColorPickerMode.value === 'fgc' ? aaMaker.toolState.selectedFGC : aaMaker.toolState.selectedBGC ?? aaMaker.documentModel.canvasBGC)"
      :swatches="aaMaker.colorSchemes[0]?.colors ?? []"
      :allow-none="aaMaker.colorPickerAllowsNone?.value ?? aaMaker.selectedColorPickerMode.value === 'bgc'"
      @apply="aaMaker.selectSelectedColor"
      @cancel="aaMaker.closeSelectedColorPicker"
    />
  </main>
</template>
