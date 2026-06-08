<script setup lang="ts">
defineProps<{
  canvasBgc: string;
}>();
</script>

<template>
  <header class="top-menu">
    <nav class="menu-list" aria-label="Main menu">
      <button type="button">File</button>
      <button type="button">Image</button>
    </nav>
    <div class="status-bar">
      <span>Canvas BGC: {{ canvasBgc }}</span>
    </div>
  </header>
</template>
