<script setup lang="ts">
type GridCell = {
  x: number;
  y: number;
};

defineProps<{
  cells: GridCell[];
  getCellText: (x: number, y: number) => string;
  getCellClass: (x: number, y: number) => string[];
  getCellStyle: (x: number, y: number) => Record<string, string>;
  gridLineStyle: Record<string, string>;
  selectionStyle: Record<string, string> | null;
}>();

defineEmits<{
  cellEnter: [x: number, y: number];
  cellDown: [x: number, y: number, event: PointerEvent];
  cellUp: [x: number, y: number];
  cellContext: [x: number, y: number, event: MouseEvent];
  gridWheel: [event: WheelEvent];
}>();
</script>

<template>
  <section class="editor-panel" aria-label="Editor" @wheel="$emit('gridWheel', $event)">
    <div class="grid-wrap">
      <div class="aa-grid" role="grid" aria-label="80 by 25 ASCII art grid">
        <div
          v-for="cell in cells"
          :key="`${cell.x},${cell.y}`"
          class="aa-cell"
          :class="getCellClass(cell.x, cell.y)"
          :style="getCellStyle(cell.x, cell.y)"
          :data-x="cell.x"
          :data-y="cell.y"
          :aria-label="`cell ${cell.x + 1},${cell.y + 1}`"
          @pointerenter="$emit('cellEnter', cell.x, cell.y)"
          @pointerdown="$emit('cellDown', cell.x, cell.y, $event)"
          @pointerup="$emit('cellUp', cell.x, cell.y)"
          @contextmenu="$emit('cellContext', cell.x, cell.y, $event)"
        >
          {{ getCellText(cell.x, cell.y) }}
        </div>
        <div class="aa-grid-lines" :style="gridLineStyle" aria-hidden="true"></div>
        <div v-if="selectionStyle" class="aa-selection" :style="selectionStyle" aria-hidden="true"></div>
      </div>
    </div>
  </section>
</template>
