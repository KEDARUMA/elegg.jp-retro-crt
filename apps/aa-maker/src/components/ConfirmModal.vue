<script setup lang="ts">
defineProps<{
  message: string;
}>();

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
        <button type="button" @click="$emit('cancel')">Cancel</button>
        <button type="button" @click="$emit('confirm')">OK</button>
      </div>
    </section>
  </div>
</template>
