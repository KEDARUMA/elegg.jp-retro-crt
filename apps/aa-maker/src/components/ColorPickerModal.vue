<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { clamp } from "../utils/clamp";

const props = defineProps<{
  mode: "fgc" | "bgc";
  initialColor: string;
  swatches: string[];
  allowNone: boolean;
}>();

const emit = defineEmits<{
  apply: [mode: "fgc" | "bgc", color: string | null];
  cancel: [];
}>();

type HsvColor = {
  h: number;
  s: number;
  v: number;
};

const hsv = reactive<HsvColor>(hexToHsv(props.initialColor));

const selectedHex = computed(() => hsvToHex(hsv));
const rgb = computed(() => hexToRgb(selectedHex.value));

watch(
  () => props.initialColor,
  (color) => {
    Object.assign(hsv, hexToHsv(color));
  },
);

function updateHex(value: string) {
  const normalized = value.trim().replace(/^#/, "").toLowerCase();

  if (/^[0-9a-f]{6}$/.test(normalized)) {
    Object.assign(hsv, hexToHsv(normalized));
  }
}

function updateRgb(channel: "r" | "g" | "b", value: string) {
  const nextRgb = { ...rgb.value, [channel]: clamp(Number.parseInt(value, 10) || 0, 0, 255) };
  Object.assign(hsv, hexToHsv(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b)));
}

function updateColorArea(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  hsv.s = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  hsv.v = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
}

function updateHue(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const position = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  hsv.h = (360 - position * 360) % 360;
}

function startColorAreaDrag(event: PointerEvent) {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  updateColorArea(event);
}

function startHueDrag(event: PointerEvent) {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  updateHue(event);
}

function applySwatch(color: string) {
  Object.assign(hsv, hexToHsv(color));
}

function getLuma(hex: string) {
  const color = hexToRgb(hex);
  return (color.r * 299 + color.g * 587 + color.b * 114) / 1000;
}

function hexToRgb(hex: string) {
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  return [r, g, b].map((value) => clamp(value, 0, 255).toString(16).padStart(2, "0")).join("");
}

function hexToHsv(hex: string): HsvColor {
  const { r, g, b } = hexToRgb(hex);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === red) {
      h = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      h = 60 * ((blue - red) / delta + 2);
    } else {
      h = 60 * ((red - green) / delta + 4);
    }
  }

  return {
    h: h < 0 ? h + 360 : h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function hsvToHex(color: HsvColor) {
  const c = color.v * color.s;
  const x = c * (1 - Math.abs(((color.h / 60) % 2) - 1));
  const m = color.v - c;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (color.h < 60) {
    red = c;
    green = x;
  } else if (color.h < 120) {
    red = x;
    green = c;
  } else if (color.h < 180) {
    green = c;
    blue = x;
  } else if (color.h < 240) {
    green = x;
    blue = c;
  } else if (color.h < 300) {
    red = x;
    blue = c;
  } else {
    red = c;
    blue = x;
  }

  return rgbToHex(Math.round((red + m) * 255), Math.round((green + m) * 255), Math.round((blue + m) * 255));
}
</script>

<template>
  <div class="color-picker-backdrop" @click.self="emit('cancel')">
    <section class="color-picker-modal" role="dialog" aria-modal="true" :aria-label="mode === 'fgc' ? 'Foreground Color Picker' : 'Background Color Picker'">
      <header class="color-picker-header">
        <h2>Color Picker</h2>
        <button type="button" aria-label="Close" @click="emit('cancel')">×</button>
      </header>
      <div class="color-picker-body">
        <div class="color-picker-main">
          <div
            class="color-area"
            :style="{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }"
            @pointerdown="startColorAreaDrag"
            @pointermove="event => event.buttons === 1 && updateColorArea(event)"
          >
            <span class="color-area-cursor" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }"></span>
          </div>
          <div class="hue-slider" @pointerdown="startHueDrag" @pointermove="event => event.buttons === 1 && updateHue(event)">
            <span class="hue-cursor" :style="{ top: `${((360 - hsv.h) / 360) * 100}%` }"></span>
          </div>
        </div>
        <div class="color-picker-side">
          <div class="color-preview" :style="{ backgroundColor: `#${selectedHex}` }"></div>
          <label>
            #
            <input :value="selectedHex" maxlength="6" @input="updateHex(($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            R:
            <input :value="rgb.r" inputmode="numeric" @input="updateRgb('r', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            G:
            <input :value="rgb.g" inputmode="numeric" @input="updateRgb('g', ($event.target as HTMLInputElement).value)" />
          </label>
          <label>
            B:
            <input :value="rgb.b" inputmode="numeric" @input="updateRgb('b', ($event.target as HTMLInputElement).value)" />
          </label>
          <div class="color-picker-actions">
            <button type="button" @click="emit('apply', mode, selectedHex)">OK</button>
            <button v-if="allowNone" type="button" @click="emit('apply', mode, null)">None</button>
          </div>
        </div>
      </div>
      <div class="color-picker-swatches">
        <button
          v-for="color in swatches"
          :key="color"
          type="button"
          :class="{ 'is-bright': getLuma(color) > 160 }"
          :style="{ backgroundColor: `#${color}` }"
          :aria-label="`#${color}`"
          @click="applySwatch(color)"
        ></button>
      </div>
    </section>
  </div>
</template>
