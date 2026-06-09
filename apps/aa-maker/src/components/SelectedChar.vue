<script setup lang="ts">
defineProps<{
  selectedChar: string | null;
  selectedForegroundColor: string;
  selectedBackgroundColor: string | null;
  canvasBackgroundColor: string;
}>();

const emit = defineEmits<{
  openForegroundColor: [];
  openBackgroundColor: [];
}>();

function handlePointerDown(event: PointerEvent) {
  if (event.button === 0) {
    emit("openForegroundColor");
    return;
  }

  if (event.button === 2) {
    event.preventDefault();
    event.stopPropagation();
    emit("openBackgroundColor");
  }
}
</script>

<template>
  <button
    class="selected-char"
    type="button"
    aria-label="Selected character color"
    :style="{ color: `#${selectedForegroundColor}`, backgroundColor: `#${selectedBackgroundColor ?? canvasBackgroundColor}` }"
    @pointerdown="handlePointerDown"
    @click.prevent
    @contextmenu.prevent.stop
  >
    {{ selectedChar ?? "" }}
  </button>
</template>
