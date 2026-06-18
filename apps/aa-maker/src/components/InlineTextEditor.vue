<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { getCharWidth } from "../model/gridOperations";
import type { WidthMode } from "../model/widthMode";
import { clamp } from "../utils/clamp";

type TextDraft = {
  x: number;
  y: number;
  value: string;
};

const props = defineProps<{
  draft: TextDraft | null;
  gridWidth: number;
  gridHeight: number;
  selectedForegroundColor: string;
  selectedBackgroundColor: string | null;
  canvasBackgroundColor: string;
  widthMode: WidthMode;
}>();

const emit = defineEmits<{
  updateValue: [value: string];
  confirm: [];
  cancel: [];
}>();

const editorRef = ref<HTMLTextAreaElement | null>(null);

const editorStyle = computed(() => {
  if (!props.draft) {
    return null;
  }

  const widthCells = getEditorWidthCells(props.draft.value, props.draft.x);
  const heightCells = getEditorHeightCells(props.draft.value, props.draft.y);

  return {
    left: `calc(var(--cell-width) * ${clamp(props.draft.x, 0, props.gridWidth - widthCells)})`,
    top: `calc(var(--cell-height) * ${clamp(props.draft.y, 0, props.gridHeight - heightCells)})`,
    width: `calc(var(--cell-width) * ${widthCells})`,
    height: `calc(var(--cell-height) * ${heightCells})`,
    "--editor-width-cells": String(widthCells),
    "--editor-height-cells": String(heightCells),
    "--editor-fgc": `#${props.selectedForegroundColor}`,
    "--editor-bgc": `#${props.selectedBackgroundColor ?? props.canvasBackgroundColor}`,
  } as Record<string, string>;
});

watch(
  () => (props.draft ? `${props.draft.x},${props.draft.y}` : null),
  async (positionKey, previousPositionKey) => {
    if (!positionKey || positionKey === previousPositionKey) {
      return;
    }

    await nextTick();
    const draft = props.draft;

    if (!draft) {
      return;
    }

    editorRef.value?.focus();
    editorRef.value?.setSelectionRange(draft.value.length, draft.value.length);
  },
  { immediate: true },
);

function handleInput(event: Event) {
  if (!(event.target instanceof HTMLTextAreaElement)) {
    return;
  }

  emit("updateValue", event.target.value);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
    return;
  }

  if (event.key === "Enter" && event.altKey) {
    event.preventDefault();
    insertTextAtCursor("\n");
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    emit("confirm");
  }
}

function handleBlur() {
  if (!props.draft) {
    return;
  }

  if (props.draft.value.length > 0) {
    emit("confirm");
    return;
  }

  emit("cancel");
}

function insertTextAtCursor(text: string) {
  const editor = editorRef.value;

  if (!editor) {
    return;
  }

  const currentValue = props.draft?.value ?? "";
  const selectionStart = editor.selectionStart ?? currentValue.length;
  const selectionEnd = editor.selectionEnd ?? selectionStart;
  const nextValue = `${currentValue.slice(0, selectionStart)}${text}${currentValue.slice(selectionEnd)}`;

  emit("updateValue", nextValue);

  void nextTick(() => {
    editor.focus();
    const cursor = selectionStart + text.length;
    editor.setSelectionRange(cursor, cursor);
  });
}

function getEditorWidthCells(value: string, x: number) {
  const lines = normalizeLines(value);
  const maxLineWidth = Math.max(1, ...lines.map((line) => getLineWidth(line)));
  const remainingWidth = props.gridWidth - clamp(x, 0, props.gridWidth - 1);
  return clamp(Math.max(6, maxLineWidth + 1), 1, Math.max(1, remainingWidth));
}

function getEditorHeightCells(value: string, y: number) {
  const lineCount = Math.max(1, countEditorLines(value));
  const remainingHeight = props.gridHeight - clamp(y, 0, props.gridHeight - 1);
  return clamp(Math.max(1, lineCount), 1, Math.max(1, remainingHeight));
}

function getLineWidth(line: string) {
  let width = 0;

  for (const char of Array.from(new Intl.Segmenter().segment(line), (segment) => segment.segment)) {
    width += char === " " ? 1 : getCharWidth(char, props.widthMode);
  }

  return width;
}

function normalizeLines(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized === "" ? [""] : normalized.split("\n");
}

function countEditorLines(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized === "" ? 1 : normalized.split("\n").length;
}
</script>

<template>
  <div
    v-if="draft && editorStyle"
    class="inline-text-editor"
    :style="editorStyle"
    @pointerdown.stop
    @contextmenu.prevent.stop
  >
    <textarea
      ref="editorRef"
      class="inline-text-editor-input"
      :value="draft.value"
      :aria-label="`Text input at ${draft.x + 1},${draft.y + 1}`"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      @blur="handleBlur"
      @input="handleInput"
      @keydown="handleKeydown"
    ></textarea>
  </div>
</template>
