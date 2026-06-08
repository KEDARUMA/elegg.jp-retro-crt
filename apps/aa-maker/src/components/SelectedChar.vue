<script setup lang="ts">
defineProps<{
  selectedChar: string | null;
}>();
</script>

<template>
  <div class="selected-char" aria-label="Selected character">
    {{ selectedChar ?? "" }}
  </div>
</template>
