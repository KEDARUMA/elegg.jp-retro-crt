<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import stringWidth from "string-width";

type TextDraft = {
  x: number;
  y: number;
  value: string;
};

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;

const props = defineProps<{
  draft: TextDraft | null;
  selectedForegroundColor: string;
  selectedBackgroundColor: string | null;
  canvasBackgroundColor: string;
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
    left: `calc(var(--cell-width) * ${clamp(props.draft.x, 0, GRID_COLUMNS - widthCells)})`,
    top: `calc(var(--cell-height) * ${clamp(props.draft.y, 0, GRID_ROWS - heightCells)})`,
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getEditorWidthCells(value: string, x: number) {
  const lines = normalizeLines(value);
  const maxLineWidth = Math.max(1, ...lines.map((line) => getLineWidth(line)));
  const remainingWidth = GRID_COLUMNS - clamp(x, 0, GRID_COLUMNS - 1);
  return clamp(Math.max(6, maxLineWidth + 1), 1, Math.max(1, remainingWidth));
}

function getEditorHeightCells(value: string, y: number) {
  const lineCount = Math.max(1, countEditorLines(value));
  const remainingHeight = GRID_ROWS - clamp(y, 0, GRID_ROWS - 1);
  return clamp(Math.max(1, lineCount), 1, Math.max(1, remainingHeight));
}

function getLineWidth(line: string) {
  let width = 0;

  for (const char of Array.from(new Intl.Segmenter().segment(line), (segment) => segment.segment)) {
    width += char === " " ? 1 : getCharWidth(char);
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

function getCharWidth(char: string): 1 | 2 {
  return stringWidth(char, { ambiguousIsNarrow: true }) > 1 ? 2 : 1;
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
      @input="handleInput"
      @keydown="handleKeydown"
    ></textarea>
  </div>
</template>
