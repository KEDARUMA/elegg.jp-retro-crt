<script setup lang="ts">
import type { ToastItem } from "../composables/useToastQueue";

defineProps<{
  toasts: ToastItem[];
}>();
</script>

<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <article
      v-for="toast in toasts"
      :key="toast.id"
      class="toast-item"
      :class="`is-${toast.kind}`"
      :role="toast.kind === 'error' ? 'alert' : 'status'"
    >
      <p>{{ toast.message }}</p>
    </article>
  </div>
</template>
