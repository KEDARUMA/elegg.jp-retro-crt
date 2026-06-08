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
    <TopMenu :canvas-bgc="aaMaker.documentModel.canvasBGC" />
    <Toolbox
      :tools="aaMaker.tools"
      :active-tool="aaMaker.toolState.activeTool"
      :selected-char="aaMaker.toolState.selectedChar"
      @select-tool="aaMaker.selectTool"
    />
    <EditorGrid
      :cells="aaMaker.gridCells"
      :zoom-label="aaMaker.zoomLabel.value"
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
      :layers="aaMaker.documentModel.layers"
      :active-layer-id="aaMaker.documentModel.activeLayerId"
      @select-palette="aaMaker.selectPalette"
      @select-char="aaMaker.selectPaletteChar"
      @keyboard-input="aaMaker.handleKeyboardInput"
      @update-unicode-query="aaMaker.updateUnicodeQuery"
      @update-unicode-scroll-offset="aaMaker.updateUnicodeScrollOffset"
      @assign-history-char="aaMaker.assignHistoryChar"
    />
  </main>
</template>
