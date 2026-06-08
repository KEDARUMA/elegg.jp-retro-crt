<script setup lang="ts">
import EditorGrid from "./components/EditorGrid.vue";
import SidePanel from "./components/SidePanel.vue";
import Toolbox from "./components/Toolbox.vue";
import TopMenu from "./components/TopMenu.vue";
import { useAaMaker } from "./composables/useAaMaker";

const aaMaker = useAaMaker();
</script>

<template>
  <main class="aa-maker-shell" aria-label="AA Maker">
    <TopMenu />
    <Toolbox
      :tools="aaMaker.tools"
      :active-tool="aaMaker.toolState.activeTool"
      :selected-char="aaMaker.toolState.selectedChar"
      @select-tool="aaMaker.selectTool"
    />
    <EditorGrid
      :cells="aaMaker.gridCells"
      :get-cell-text="aaMaker.getCellText"
      :get-cell-class="aaMaker.getCellClass"
      :get-cell-style="aaMaker.getCellStyle"
      :grid-line-style="aaMaker.gridLineStyle.value"
      :selection-style="aaMaker.selectionStyle.value"
      @cell-enter="aaMaker.handleCellEnter"
      @cell-down="aaMaker.handleCellDown"
      @cell-up="aaMaker.handleCellUp"
      @cell-context="aaMaker.handleCellContext"
      @grid-wheel="aaMaker.handleGridWheel"
    />
    <SidePanel
      :palettes="aaMaker.palettes"
      :active-palette="aaMaker.activePalette.value"
      :active-palette-id="aaMaker.activePaletteId.value"
      :selected-char="aaMaker.toolState.selectedChar"
      :selected-code="aaMaker.selectedPaletteCode.value"
      :info="aaMaker.info.value"
      :layers="aaMaker.layerList.value"
      :active-layer-id="aaMaker.documentModel.activeLayerId"
      :active-tool="aaMaker.toolState.activeTool"
      @select-palette="aaMaker.selectPalette"
      @select-char="aaMaker.selectPaletteChar"
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
      <span>80 x 25</span>
      <span>{{ aaMaker.zoomLabel.value }}</span>
      <span>Canvas Color: {{ aaMaker.documentModel.canvasBGC }}</span>
    </footer>
  </main>
</template>
