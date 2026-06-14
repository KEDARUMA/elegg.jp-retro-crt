<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import InlineTextEditor from "./InlineTextEditor.vue";
import type { WidthMode } from "../model/widthMode";
import { clamp } from "../utils/clamp";

type GridCell = {
  x: number;
  y: number;
};

type StampPreviewCell = {
  x: number;
  y: number;
  text: string;
  style: Record<string, string>;
  className: string[];
  glyphClassName: string[];
};

defineProps<{
  cells: GridCell[];
  getCellText: (x: number, y: number) => string;
  getCellClass: (x: number, y: number) => string[];
  getCellGlyphClass: (x: number, y: number) => string[];
  getCellStyle: (x: number, y: number) => Record<string, string>;
  gridLineStyle: Record<string, string>;
  cursorStyle: Record<string, string> | null;
  selectionStyle: Record<string, string> | null;
  highlightCells: StampPreviewCell[];
  stampPreviewCells: StampPreviewCell[];
  textDraft: { x: number; y: number; value: string } | null;
  selectedForegroundColor: string;
  selectedBackgroundColor: string | null;
  canvasBackgroundColor: string;
  widthMode: WidthMode;
}>();

const emit = defineEmits<{
  cellEnter: [x: number, y: number];
  cellLeave: [];
  cellDown: [x: number, y: number, event: PointerEvent];
  cellUp: [x: number, y: number];
  cellContext: [x: number, y: number, event: MouseEvent];
  gridMeasureDown: [event: PointerEvent];
  gridWheel: [event: WheelEvent];
  highlightContext: [x: number, y: number, event: MouseEvent];
  highlightMove: [deltaX: number, deltaY: number];
  textEditorUpdate: [value: string];
  textEditorConfirm: [];
  textEditorCancel: [];
}>();

const topRulerMarks = Array.from({ length: 9 }, (_, index) => index * 10);
const leftRulerMarks = Array.from({ length: 3 }, (_, index) => index * 10);
const gridWrapRef = ref<HTMLElement | null>(null);
const editorStageRef = ref<HTMLElement | null>(null);
const viewportSize = ref({ width: 0, height: 0 });
const stagePosition = ref({ x: 0, y: 0 });
const stageSize = ref({ width: 0, height: 0 });
const rulerSize = ref({ topHeight: 24, leftWidth: 16 });
const panOffset = ref({ x: 0, y: 0 });
const activePan = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
} | null>(null);
const activeHighlightDrag = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  lastCellDeltaX: number;
  lastCellDeltaY: number;
} | null>(null);
const stageStyle = computed(() => ({
  transform: `translate(${panOffset.value.x}px, ${panOffset.value.y}px)`,
}));
const gridPosition = computed(() => ({
  x: stagePosition.value.x,
  y: stagePosition.value.y,
}));
const visibleGridRect = computed(() => {
  const leftBoundary = rulerSize.value.leftWidth;
  const topBoundary = rulerSize.value.topHeight;
  const left = clamp(gridPosition.value.x, leftBoundary, viewportSize.value.width);
  const top = clamp(gridPosition.value.y, topBoundary, viewportSize.value.height);
  const right = clamp(gridPosition.value.x + stageSize.value.width, leftBoundary, viewportSize.value.width);
  const bottom = clamp(gridPosition.value.y + stageSize.value.height, topBoundary, viewportSize.value.height);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
});
const topRulerPosition = computed(() => ({
  x: visibleGridRect.value.left,
  y: visibleGridRect.value.top - rulerSize.value.topHeight,
}));
const leftRulerPosition = computed(() => ({
  x: visibleGridRect.value.left - rulerSize.value.leftWidth,
  y: visibleGridRect.value.top,
}));
const cornerPosition = computed(() => ({
  x: leftRulerPosition.value.x,
  y: topRulerPosition.value.y,
}));
const topRulerStyle = computed(() => ({
  display: visibleGridRect.value.width > 0 && visibleGridRect.value.height > 0 ? undefined : "none",
  left: `${topRulerPosition.value.x}px`,
  top: `${topRulerPosition.value.y}px`,
  width: `${visibleGridRect.value.width}px`,
}));
const leftRulerStyle = computed(() => ({
  display: visibleGridRect.value.width > 0 && visibleGridRect.value.height > 0 ? undefined : "none",
  left: `${leftRulerPosition.value.x}px`,
  top: `${leftRulerPosition.value.y}px`,
  height: `${visibleGridRect.value.height}px`,
}));
const cornerStyle = computed(() => ({
  display: visibleGridRect.value.width > 0 && visibleGridRect.value.height > 0 ? undefined : "none",
  left: `${cornerPosition.value.x}px`,
  top: `${cornerPosition.value.y}px`,
}));
const visibleStartCell = computed(() => ({
  x: clamp(Math.floor((visibleGridRect.value.left - gridPosition.value.x) / Math.max(1, getCellWidth())), 0, 79),
  y: clamp(Math.floor((visibleGridRect.value.top - gridPosition.value.y) / Math.max(1, getCellHeight())), 0, 24),
}));

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  updateLayoutSize();
  resizeObserver = new ResizeObserver(updateLayoutSize);

  if (gridWrapRef.value) {
    resizeObserver.observe(gridWrapRef.value);
  }

  if (editorStageRef.value) {
    resizeObserver.observe(editorStageRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

function handleViewportPointerDown(event: PointerEvent) {
  if (event.button !== 1) {
    return;
  }

  event.preventDefault();
  activePan.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    baseX: panOffset.value.x,
    baseY: panOffset.value.y,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function handleViewportPointerMove(event: PointerEvent) {
  const pan = activePan.value;

  if (!pan || pan.pointerId !== event.pointerId) {
    return;
  }

  panOffset.value = {
    x: pan.baseX + event.clientX - pan.startX,
    y: pan.baseY + event.clientY - pan.startY,
  };
  requestAnimationFrame(updateLayoutSize);
}

function handleViewportPointerEnd(event: PointerEvent) {
  const pan = activePan.value;

  if (!pan || pan.pointerId !== event.pointerId) {
    return;
  }

  activePan.value = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}

function handleHighlightPointerDown(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  activeHighlightDrag.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastCellDeltaX: 0,
    lastCellDeltaY: 0,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function handleHighlightPointerMove(event: PointerEvent) {
  const drag = activeHighlightDrag.value;

  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const cellDeltaX = Math.round((event.clientX - drag.startX) / Math.max(1, getCellWidth()));
  const cellDeltaY = Math.round((event.clientY - drag.startY) / Math.max(1, getCellHeight()));
  const diffX = cellDeltaX - drag.lastCellDeltaX;
  const diffY = cellDeltaY - drag.lastCellDeltaY;

  if (diffX !== 0 || diffY !== 0) {
    emit("highlightMove", diffX, diffY);
    drag.lastCellDeltaX = cellDeltaX;
    drag.lastCellDeltaY = cellDeltaY;
  }
}

function handleHighlightContext(event: MouseEvent) {
  const cell = getCellFromEvent(event);

  if (!cell) {
    return;
  }

  emit("highlightContext", cell.x, cell.y, event);
}

function handleHighlightPointerEnd(event: PointerEvent) {
  const drag = activeHighlightDrag.value;

  if (!drag || drag.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  activeHighlightDrag.value = null;
  (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}

function handleViewportWheel(event: WheelEvent) {
  emit("gridWheel", event);
  requestAnimationFrame(updateLayoutSize);
}

function handleGridPointerMove(event: PointerEvent) {
  const cell = getCellFromEvent(event);

  if (cell) {
    emit("cellEnter", cell.x, cell.y);
  }
}

function handleGridPointerLeave() {
  emit("cellLeave");
}

function handleCellPointerDown(x: number, y: number, event: PointerEvent) {
  const cell = getCellFromEvent(event) ?? { x, y };
  emit("cellDown", cell.x, cell.y, event);
}

function handleCellPointerUp(x: number, y: number, event: PointerEvent) {
  const cell = getCellFromEvent(event) ?? { x, y };
  emit("cellUp", cell.x, cell.y);
}

function handleCellContext(x: number, y: number, event: MouseEvent) {
  const cell = getCellFromEvent(event) ?? { x, y };
  emit("cellContext", cell.x, cell.y, event);
}

function getTopRulerMarkStyle(mark: number) {
  return {
    left: `${mark * getCellWidth() + gridPosition.value.x - visibleGridRect.value.left}px`,
  };
}

function getLeftRulerMarkStyle(mark: number) {
  return {
    top: `${mark * getCellHeight() + gridPosition.value.y - visibleGridRect.value.top}px`,
  };
}

function shouldShowTopRulerMark(mark: number) {
  return mark !== visibleStartCell.value.x;
}

function shouldShowLeftRulerMark(mark: number) {
  return mark !== visibleStartCell.value.y;
}

function updateLayoutSize() {
  if (gridWrapRef.value && editorStageRef.value) {
    const wrapRect = gridWrapRef.value.getBoundingClientRect();
    const stageRect = editorStageRef.value.getBoundingClientRect();

    viewportSize.value = {
      width: wrapRect.width,
      height: wrapRect.height,
    };
    stagePosition.value = {
      x: stageRect.left - wrapRect.left,
      y: stageRect.top - wrapRect.top,
    };
    stageSize.value = {
      width: stageRect.width,
      height: stageRect.height,
    };
  }

  const rootStyle = getComputedStyle(document.documentElement);
  rulerSize.value = {
    topHeight: Number.parseFloat(rootStyle.getPropertyValue("--ruler-top-height")) || rulerSize.value.topHeight,
    leftWidth: Number.parseFloat(rootStyle.getPropertyValue("--ruler-left-width")) || rulerSize.value.leftWidth,
  };
}

function getCellWidth() {
  return stageSize.value.width / 80;
}

function getCellHeight() {
  return stageSize.value.height / 25;
}

function getCellFromEvent(event: MouseEvent) {
  if (!gridWrapRef.value) {
    return null;
  }

  const wrapRect = gridWrapRef.value.getBoundingClientRect();
  const cellWidth = Math.max(1, getCellWidth());
  const cellHeight = Math.max(1, getCellHeight());
  const x = Math.floor((event.clientX - wrapRect.left - stagePosition.value.x) / cellWidth);
  const y = Math.floor((event.clientY - wrapRect.top - stagePosition.value.y) / cellHeight);

  return {
    x: clamp(x, 0, 79),
    y: clamp(y, 0, 24),
  };
}

</script>

<template>
  <section class="editor-panel" aria-label="Editor" @wheel="handleViewportWheel">
    <div
      ref="gridWrapRef"
      class="grid-wrap"
      :class="{ 'is-panning': activePan !== null }"
      @pointerdown="handleViewportPointerDown"
      @pointermove="handleViewportPointerMove"
      @pointerup="handleViewportPointerEnd"
      @pointercancel="handleViewportPointerEnd"
      @auxclick.prevent
    >
      <div ref="editorStageRef" class="editor-stage" :style="stageStyle">
        <div class="aa-grid" role="grid" aria-label="80 by 25 ASCII art grid" @pointermove="handleGridPointerMove" @pointerleave="handleGridPointerLeave">
          <div
            v-for="cell in cells"
            :key="`${cell.x},${cell.y}`"
            class="aa-cell"
            :class="getCellClass(cell.x, cell.y)"
            :style="getCellStyle(cell.x, cell.y)"
            :data-x="cell.x"
            :data-y="cell.y"
            :aria-label="`cell ${cell.x + 1},${cell.y + 1}`"
            @pointerenter="emit('cellEnter', cell.x, cell.y)"
            @pointerdown="handleCellPointerDown(cell.x, cell.y, $event)"
            @pointerup="handleCellPointerUp(cell.x, cell.y, $event)"
            @contextmenu="handleCellContext(cell.x, cell.y, $event)"
          >
            <span class="aa-glyph" :class="getCellGlyphClass(cell.x, cell.y)">{{ getCellText(cell.x, cell.y) }}</span>
          </div>
          <div class="aa-grid-lines" :style="gridLineStyle" aria-hidden="true"></div>
          <div v-if="cursorStyle" class="aa-cursor" :style="cursorStyle" aria-hidden="true"></div>
          <div
            v-if="selectionStyle"
            class="aa-selection"
            :style="selectionStyle"
            aria-label="Highlight"
            @pointerdown="handleHighlightPointerDown"
            @pointermove="handleHighlightPointerMove"
            @pointerup="handleHighlightPointerEnd"
            @pointercancel="handleHighlightPointerEnd"
            @contextmenu.prevent.stop="handleHighlightContext($event)"
          ></div>
          <div
            v-for="(highlightCell, index) in highlightCells"
            :key="`highlight-${highlightCell.x},${highlightCell.y},${index}`"
            class="aa-highlight-cell"
            :class="highlightCell.className"
            :style="{
              ...highlightCell.style,
              left: `calc(var(--cell-width) * ${highlightCell.x})`,
              top: `calc(var(--cell-height) * ${highlightCell.y})`,
            }"
            aria-hidden="true"
          >
            <span class="aa-glyph" :class="highlightCell.glyphClassName">{{ highlightCell.text }}</span>
          </div>
          <div
            v-for="previewCell in stampPreviewCells"
            :key="`${previewCell.x},${previewCell.y}`"
            class="stamp-preview-cell"
            :class="previewCell.className"
            :style="{
              ...previewCell.style,
              left: `calc(var(--cell-width) * ${previewCell.x})`,
              top: `calc(var(--cell-height) * ${previewCell.y})`,
            }"
            aria-hidden="true"
          >
            <span class="aa-glyph" :class="previewCell.glyphClassName">{{ previewCell.text }}</span>
          </div>
          <InlineTextEditor
            :draft="textDraft"
            :selected-foreground-color="selectedForegroundColor"
            :selected-background-color="selectedBackgroundColor"
            :canvas-background-color="canvasBackgroundColor"
            :width-mode="widthMode"
            @update-value="(value) => $emit('textEditorUpdate', value)"
            @confirm="$emit('textEditorConfirm')"
            @cancel="$emit('textEditorCancel')"
          />
        </div>
      </div>
      <div class="ruler-corner" :style="cornerStyle" aria-hidden="true" @pointerdown.stop="emit('gridMeasureDown', $event)"></div>
      <div class="top-ruler" :style="topRulerStyle" aria-hidden="true" @pointerdown.stop="emit('gridMeasureDown', $event)">
        <span class="top-ruler-mark ruler-current-mark" :style="{ left: '0px' }">
          {{ visibleStartCell.x }}
        </span>
        <span v-for="mark in topRulerMarks" v-show="shouldShowTopRulerMark(mark)" :key="mark" class="top-ruler-mark" :style="getTopRulerMarkStyle(mark)">
          {{ mark }}
        </span>
      </div>
      <div class="left-ruler" :style="leftRulerStyle" aria-hidden="true" @pointerdown.stop="emit('gridMeasureDown', $event)">
        <span class="left-ruler-mark ruler-current-mark" :style="{ top: '0px' }">
          {{ visibleStartCell.y }}
        </span>
        <span v-for="mark in leftRulerMarks" v-show="shouldShowLeftRulerMark(mark)" :key="mark" class="left-ruler-mark" :style="getLeftRulerMarkStyle(mark)">
          {{ mark }}
        </span>
      </div>
    </div>
  </section>
</template>
