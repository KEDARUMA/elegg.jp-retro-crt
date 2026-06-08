<script setup lang="ts">
import SelectedChar from "./SelectedChar.vue";
import type { Tool } from "../model/types";

type ToolItem = {
  id: Tool;
  label: string;
  icon: string;
  implemented: boolean;
};

defineProps<{
  tools: ToolItem[];
  activeTool: Tool;
  selectedChar: string | null;
}>();

defineEmits<{
  selectTool: [tool: Tool];
}>();
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
        :title="tool.implemented ? tool.label : `${tool.label} は未実装です`"
        :aria-label="tool.label"
        @click="$emit('selectTool', tool.id)"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" v-html="tool.icon"></svg>
      </button>
    </div>
    <SelectedChar :selected-char="selectedChar" />
  </aside>
</template>
