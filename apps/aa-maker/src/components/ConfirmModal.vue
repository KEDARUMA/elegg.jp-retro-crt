<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    message: string;
    cancelLabel?: string;
    confirmLabel?: string;
  }>(),
  {
    cancelLabel: "Cancel",
    confirmLabel: "OK",
  },
);

defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div class="confirm-modal-backdrop" role="presentation" @click="$emit('cancel')">
    <section class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-message" @click.stop>
      <p id="confirm-modal-message">{{ message }}</p>
      <div class="confirm-modal-actions">
        <button type="button" @click="$emit('cancel')">{{ props.cancelLabel }}</button>
        <button type="button" @click="$emit('confirm')">{{ props.confirmLabel }}</button>
      </div>
    </section>
  </div>
</template>
