<script setup lang="ts">
import { ref } from "vue";
import appIcon from "../assets/app-icon.png";

const emit = defineEmits<{
  saveDocument: [];
  loadDocument: [file: File];
  exportDocument: [];
  invertCanvasBackground: [];
}>();

const isFileMenuOpen = ref(false);
const isImageMenuOpen = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

function toggleFileMenu() {
  isFileMenuOpen.value = !isFileMenuOpen.value;
  isImageMenuOpen.value = false;
}

function toggleImageMenu() {
  isImageMenuOpen.value = !isImageMenuOpen.value;
  isFileMenuOpen.value = false;
}

function requestLoad() {
  fileInputRef.value?.click();
  isFileMenuOpen.value = false;
}

function handleLoadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    emit("loadDocument", file);
  }

  input.value = "";
}

function requestSave() {
  emit("saveDocument");
  isFileMenuOpen.value = false;
}

function requestExport() {
  emit("exportDocument");
  isFileMenuOpen.value = false;
}

function requestInvertCanvasBackground() {
  emit("invertCanvasBackground");
  isImageMenuOpen.value = false;
}
</script>

<template>
  <header class="top-menu">
    <nav class="menu-list" aria-label="Main menu">
      <img class="app-menu-icon" :src="appIcon" alt="" aria-hidden="true" />
      <div class="menu-item">
        <button type="button" @click="toggleFileMenu">File</button>
        <div v-if="isFileMenuOpen" class="menu-dropdown">
          <button type="button" @click="requestLoad">Load</button>
          <button type="button" @click="requestSave">Save</button>
          <button type="button" @click="requestExport">Export</button>
        </div>
        <input ref="fileInputRef" class="hidden-file-input" type="file" accept="application/json,.json" @change="handleLoadFile" />
      </div>
      <div class="menu-item">
        <button type="button" @click="toggleImageMenu">Image</button>
        <div v-if="isImageMenuOpen" class="menu-dropdown">
          <button type="button" @click="requestInvertCanvasBackground">Invert BG</button>
        </div>
      </div>
    </nav>
  </header>
</template>
