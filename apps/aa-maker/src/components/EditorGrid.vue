<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

type GridCell = {
  x: number;
  y: number;
};

defineProps<{
  cells: GridCell[];
  getCellText: (x: number, y: number) => string;
  getCellClass: (x: number, y: number) => string[];
  getCellStyle: (x: number, y: number) => Record<string, string>;
  gridLineStyle: Record<string, string>;
  selectionStyle: Record<string, string> | null;
}>();

const emit = defineEmits<{
  cellEnter: [x: number, y: number];
  cellDown: [x: number, y: number, event: PointerEvent];
  cellUp: [x: number, y: number];
  cellContext: [x: number, y: number, event: MouseEvent];
  gridWheel: [event: WheelEvent];
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

function handleViewportWheel(event: WheelEvent) {
  emit("gridWheel", event);
  requestAnimationFrame(updateLayoutSize);
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
        <div class="aa-grid" role="grid" aria-label="80 by 25 ASCII art grid">
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
            @pointerdown="emit('cellDown', cell.x, cell.y, $event)"
            @pointerup="emit('cellUp', cell.x, cell.y)"
            @contextmenu="emit('cellContext', cell.x, cell.y, $event)"
          >
            {{ getCellText(cell.x, cell.y) }}
          </div>
          <div class="aa-grid-lines" :style="gridLineStyle" aria-hidden="true"></div>
          <div v-if="selectionStyle" class="aa-selection" :style="selectionStyle" aria-hidden="true"></div>
        </div>
      </div>
      <div class="ruler-corner" :style="cornerStyle" aria-hidden="true"></div>
      <div class="top-ruler" :style="topRulerStyle" aria-hidden="true">
        <span v-for="mark in topRulerMarks" :key="mark" class="top-ruler-mark" :style="getTopRulerMarkStyle(mark)">
          {{ mark }}
        </span>
      </div>
      <div class="left-ruler" :style="leftRulerStyle" aria-hidden="true">
        <span v-for="mark in leftRulerMarks" :key="mark" class="left-ruler-mark" :style="getLeftRulerMarkStyle(mark)">
          {{ mark }}
        </span>
      </div>
    </div>
  </section>
</template>
