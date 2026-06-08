<script setup lang="ts">
type InfoState = {
  x: string;
  y: string;
  w: string;
  h: string;
  char: string | null;
  fgc: string;
  bgc: string;
};

defineProps<{
  info: InfoState;
}>();
</script>

<template>
  <section class="panel-section info-panel">
    <h2>Info</h2>
    <div class="info-grid">
      <span>X</span><strong>{{ info.x }}</strong>
      <span>Y</span><strong>{{ info.y }}</strong>
      <span>W</span><strong>{{ info.w }}</strong>
      <span>H</span><strong>{{ info.h }}</strong>
    </div>
    <div class="cell-info">
      <div v-if="info.char === null" class="empty-cell-preview" aria-label="Empty cell preview"></div>
      <div v-else class="cell-preview" aria-label="Cell preview">{{ info.char }}</div>
      <div>
        <div>FC:{{ info.fgc }}</div>
        <div>BC:{{ info.bgc }}</div>
      </div>
    </div>
  </section>
</template>
