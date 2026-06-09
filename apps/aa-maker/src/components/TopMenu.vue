<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  saveDocument: [];
  loadDocument: [file: File];
  exportDocument: [];
}>();

const isFileMenuOpen = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

function toggleFileMenu() {
  isFileMenuOpen.value = !isFileMenuOpen.value;
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
</script>

<template>
  <header class="top-menu">
    <nav class="menu-list" aria-label="Main menu">
      <div class="menu-item">
        <button type="button" @click="toggleFileMenu">File</button>
        <div v-if="isFileMenuOpen" class="menu-dropdown">
          <button type="button" @click="requestLoad">Load</button>
          <button type="button" @click="requestSave">Save</button>
          <button type="button" @click="requestExport">Export</button>
        </div>
        <input ref="fileInputRef" class="hidden-file-input" type="file" accept="application/json,.json" @change="handleLoadFile" />
      </div>
      <button type="button">Image</button>
    </nav>
  </header>
</template>
