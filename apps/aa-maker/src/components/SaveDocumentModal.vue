<script setup lang="ts">
import { nextTick, ref } from "vue";

const props = defineProps<{
  initialName: string;
}>();

const emit = defineEmits<{
  save: [name: string];
  cancel: [];
}>();

const documentName = ref(props.initialName);

void nextTick(() => {
  const input = document.querySelector<HTMLInputElement>(".save-document-input");
  input?.focus();
  input?.select();
});

function save() {
  emit("save", documentName.value);
}
</script>

<template>
  <div class="confirm-modal-backdrop" role="presentation" @click="$emit('cancel')">
    <section class="confirm-modal save-document-modal" role="dialog" aria-modal="true" aria-labelledby="save-document-title" @click.stop>
      <h2 id="save-document-title">Save Document</h2>
      <label class="save-document-label">
        Name
        <input
          v-model="documentName"
          class="save-document-input"
          type="text"
          autocomplete="off"
          @keydown.enter.prevent="save"
          @keydown.esc.prevent="$emit('cancel')"
        />
      </label>
      <div class="confirm-modal-actions">
        <button type="button" @click="$emit('cancel')">Cancel</button>
        <button type="button" @click="save">Save</button>
      </div>
    </section>
  </div>
</template>
