<script setup lang="ts">
import type { AppLanguage } from "../model/appSettings";
import type { WidthMode } from "../model/widthMode";

const props = defineProps<{
  language: AppLanguage;
  canvasColor: string;
  widthMode: WidthMode;
}>();

const emit = defineEmits<{
  close: [];
  updateLanguage: [language: AppLanguage];
  updateWidthMode: [widthMode: WidthMode];
  openCanvasColorPicker: [];
}>();

function handleLanguageChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("updateLanguage", value === "ja" ? "ja" : "en");
}

function handleWidthModeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("updateWidthMode", value === "terminal" ? "terminal" : "web");
}
</script>

<template>
  <div class="confirm-modal-backdrop settings-modal-backdrop" role="presentation" @click.self="emit('close')">
    <section class="confirm-modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings" @pointerdown.stop @contextmenu.prevent.stop>
      <header class="settings-modal-header">
        <h2>Settings</h2>
        <button type="button" aria-label="Close" @click="emit('close')">×</button>
      </header>

      <div class="settings-modal-body">
        <label class="settings-field">
          <span>Language</span>
          <select :value="props.language" @change="handleLanguageChange">
            <option value="en">English</option>
            <option value="ja">Japanese</option>
          </select>
        </label>

        <label class="settings-field">
          <span>Width Mode</span>
          <select :value="props.widthMode" @change="handleWidthModeChange">
            <option value="web">Web</option>
            <option value="terminal">Terminal</option>
          </select>
        </label>

        <div class="settings-field">
          <span>Canvas Color</span>
          <button type="button" class="settings-canvas-color-button" @click="emit('openCanvasColorPicker')">
            <span class="settings-canvas-color-swatch" :style="{ backgroundColor: `#${props.canvasColor}` }"></span>
            <span>[設定]</span>
          </button>
        </div>
      </div>

      <div class="settings-modal-actions">
        <button type="button" @click="emit('close')">Close</button>
      </div>
    </section>
  </div>
</template>
