<script setup lang="ts">
import gridIcon from "../assets/icons/grid.svg?raw";
import SelectedChar from "./SelectedChar.vue";
import type { Tool } from "../model/types";

type ToolItem = {
  id: Tool;
  label: string;
  icon: string;
  implemented: boolean;
  shortcut?: string;
};

defineProps<{
  tools: ToolItem[];
  activeTool: Tool;
  selectedChar: string | null;
  selectedForegroundColor: string;
  selectedBackgroundColor: string | null;
  canvasBackgroundColor: string;
  selectedCharAttentionKey: number;
  isGridVisible: boolean;
}>();

defineEmits<{
  selectTool: [tool: Tool];
  openSelectedForegroundColorPicker: [];
  openSelectedBackgroundColorPicker: [];
  toggleGridVisibility: [];
}>();

function getToolTitle(tool: ToolItem) {
  return tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;
}
</script>

<template>
  <aside class="toolbox" aria-label="Tools" @contextmenu.prevent>
    <div class="tool-list">
      <template v-for="tool in tools" :key="tool.id">
        <button
          class="tool-button"
          :class="{ 'is-selected': tool.id === activeTool }"
          type="button"
          :disabled="!tool.implemented"
          :title="tool.implemented ? getToolTitle(tool) : `${getToolTitle(tool)} は未実装です`"
          :aria-label="getToolTitle(tool)"
          @click="$emit('selectTool', tool.id)"
        >
          <span class="tool-icon" aria-hidden="true" v-html="tool.icon"></span>
        </button>
        <div v-if="tool.id === 'pen'" class="selected-char-wrap">
          <SelectedChar
            :selected-char="selectedChar"
            :selected-foreground-color="selectedForegroundColor"
            :selected-background-color="selectedBackgroundColor"
            :canvas-background-color="canvasBackgroundColor"
            :attention-key="selectedCharAttentionKey"
            @open-foreground-color="$emit('openSelectedForegroundColorPicker')"
            @open-background-color="$emit('openSelectedBackgroundColorPicker')"
          />
        </div>
      </template>
      <button
        class="tool-button grid-visibility-button"
        :class="{ 'is-selected': isGridVisible }"
        type="button"
        :title="isGridVisible ? 'グリッドを非表示' : 'グリッドを表示'"
        :aria-label="isGridVisible ? 'グリッドを非表示' : 'グリッドを表示'"
        :aria-pressed="isGridVisible"
        @click="$emit('toggleGridVisibility')"
      >
        <span class="tool-icon" aria-hidden="true" v-html="gridIcon"></span>
      </button>
    </div>
  </aside>
</template>
