<script setup lang="ts">
import { ref } from "vue";

type ExportFormat = "plain" | "ansi" | "mds" | "html";
type ExportDestination = "download" | "clipboard";

const emit = defineEmits<{
  export: [format: ExportFormat, destination: ExportDestination];
  cancel: [];
}>();

const format = ref<ExportFormat>("plain");
const destination = ref<ExportDestination>("download");

function exportDocument() {
  emit("export", format.value, destination.value);
}
</script>

<template>
  <div class="confirm-modal-backdrop" role="presentation" @click="$emit('cancel')">
    <section class="confirm-modal export-document-modal" role="dialog" aria-modal="true" aria-labelledby="export-document-title" @click.stop>
      <h2 id="export-document-title">Export Document</h2>
      <fieldset class="export-option-group">
        <legend>Format</legend>
        <label><input v-model="format" type="radio" value="plain" /> Plain Text</label>
        <label><input v-model="format" type="radio" value="ansi" /> ANSI</label>
        <label><input v-model="format" type="radio" value="mds" /> MDS</label>
        <label><input v-model="format" type="radio" value="html" /> HTML</label>
      </fieldset>
      <fieldset class="export-option-group">
        <legend>Output</legend>
        <label><input v-model="destination" type="radio" value="download" /> Download</label>
        <label><input v-model="destination" type="radio" value="clipboard" /> Clipboard</label>
      </fieldset>
      <div class="confirm-modal-actions">
        <button type="button" @click="$emit('cancel')">Cancel</button>
        <button type="button" @click="exportDocument">Export</button>
      </div>
    </section>
  </div>
</template>
