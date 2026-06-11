<script setup lang="ts">
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

defineProps<{
  info: InfoState;
}>();
</script>

<template>
  <section class="panel-section info-panel">
    <h2>Info</h2>
    <div class="info-layout">
      <div class="info-metrics">
        <div class="info-row">
          <div class="info-metric">
            <span class="info-label">X:</span>
            <strong class="info-value">{{ info.x }}</strong>
          </div>
          <div class="info-metric">
            <span class="info-label">Y:</span>
            <strong class="info-value">{{ info.y }}</strong>
          </div>
        </div>
        <div class="info-row">
          <div class="info-metric">
            <span class="info-label">W:</span>
            <strong class="info-value">{{ info.w }}</strong>
          </div>
          <div class="info-metric">
            <span class="info-label">H:</span>
            <strong class="info-value">{{ info.h }}</strong>
          </div>
        </div>
      </div>
      <div v-if="info.char === null" class="empty-cell-preview info-preview" aria-label="Empty cell preview"></div>
      <div v-else class="cell-preview info-preview" aria-label="Cell preview">{{ info.char }}</div>
      <div class="info-codes">
        <div class="info-code">{{ info.code }}</div>
        <div class="info-code">FC:{{ info.fgc }}</div>
        <div class="info-code">BC:{{ info.bgc }}</div>
      </div>
    </div>
  </section>
</template>
