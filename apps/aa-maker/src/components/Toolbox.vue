<script setup lang="ts">
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
}>();

defineEmits<{
  selectTool: [tool: Tool];
  openSelectedForegroundColorPicker: [];
  openSelectedBackgroundColorPicker: [];
}>();

function getToolTitle(tool: ToolItem) {
  return tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;
}
</script>

<template>
  <aside class="toolbox" aria-label="Tools" @contextmenu.prevent>
    <div class="tool-list">
      <button
        v-for="tool in tools"
        :key="tool.id"
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
    </div>
    <div class="selected-char-wrap">
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
  </aside>
</template>
