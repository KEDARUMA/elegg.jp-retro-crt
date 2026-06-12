<script setup lang="ts">
import Sortable from "sortablejs";
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import plusIcon from "../assets/icons/plus.svg?raw";
import trashIcon from "../assets/icons/trash.svg?raw";

type EditableListItem = {
  id: string;
  name: string;
  protected?: boolean;
};

const props = defineProps<{
  title: string;
  items: EditableListItem[];
  activeItemId: string;
  newItemLabel: string;
}>();

const emit = defineEmits<{
  apply: [items: EditableListItem[]];
  cancel: [];
}>();

const modalRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const editingItems = ref(props.items.map((item) => ({ ...item })));
const editingItemId = ref<string | null>(null);
const editingItemName = ref("");
const errorMessage = ref("");
let nextItemNumber = props.items.length + 1;
let sortable: Sortable | null = null;

onMounted(() => {
  void nextTick(() => {
    modalRef.value?.focus();
  });

  if (!listRef.value) {
    return;
  }

  sortable = Sortable.create(listRef.value, {
    animation: 180,
    easing: "cubic-bezier(0.2, 0, 0, 1)",
    filter: ".editable-list-name-input, .editable-list-icon-button",
    preventOnFilter: false,
    draggable: ".editable-list-item",
    dataIdAttr: "data-id",
    ghostClass: "editable-list-sortable-ghost",
    chosenClass: "editable-list-sortable-chosen",
    forceFallback: true,
    fallbackClass: "editable-list-sortable-fallback",
    fallbackOnBody: true,
    fallbackTolerance: 4,
    removeCloneOnHide: true,
    onStart() {
      return commitCurrentNameEdit();
    },
    onEnd(event) {
      reorderItems(event);
    },
  });
});

onBeforeUnmount(() => {
  sortable?.destroy();
  sortable = null;
});

function addItem() {
  errorMessage.value = "";
  const name = createNextName();
  const item = {
    id: createItemId(),
    name,
  };

  editingItems.value.push(item);
  startNameEdit(item);
}

function getDeleteButtonLabel(item: EditableListItem) {
  return item.protected ? "Protected item cannot be deleted" : "Delete item";
}

function removeItem(itemId: string) {
  const index = editingItems.value.findIndex((item) => item.id === itemId);

  if (index < 0 || editingItems.value[index].protected) {
    return;
  }

  if (editingItemId.value === itemId) {
    cancelNameEdit();
  }

  errorMessage.value = "";
  editingItems.value.splice(index, 1);
}

function apply() {
  if (!commitCurrentNameEdit() || !validateAllNames()) {
    return;
  }

  emit(
    "apply",
    editingItems.value.map((item) => ({
      ...item,
      name: item.name.trim() || props.newItemLabel,
    })),
  );
}

function startNameEdit(item: EditableListItem) {
  if (item.protected) {
    return;
  }

  editingItemId.value = item.id;
  editingItemName.value = item.name;
  errorMessage.value = "";
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(".editable-list-name-input");
    input?.focus();
    input?.select();
  });
}

function commitNameEdit(itemId: string, event?: Event) {
  if (editingItemId.value !== itemId) {
    return;
  }

  const inputValue = event?.currentTarget instanceof HTMLInputElement ? event.currentTarget.value : undefined;
  commitCurrentNameEdit(inputValue);
}

function commitCurrentNameEdit(nameOverride?: string) {
  if (editingItemId.value === null) {
    return true;
  }

  const item = editingItems.value.find((candidate) => candidate.id === editingItemId.value);

  if (item && !item.protected) {
    const nextName = (nameOverride ?? editingItemName.value).trim() || props.newItemLabel;

    if (hasDuplicateName(nextName, item.id)) {
      showDuplicateNameError();
      return false;
    }

    item.name = nextName;
  }

  cancelNameEdit();
  errorMessage.value = "";
  return true;
}

function cancelNameEdit() {
  editingItemId.value = null;
  editingItemName.value = "";
}

function reorderItems(event: Sortable.SortableEvent) {
  if (errorMessage.value) {
    return;
  }

  const oldIndex = event.oldDraggableIndex ?? event.oldIndex;
  const newIndex = event.newDraggableIndex ?? event.newIndex;

  if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) {
    return;
  }

  const item = editingItems.value[oldIndex];

  if (!item) {
    return;
  }

  editingItems.value.splice(oldIndex, 1);
  editingItems.value.splice(newIndex, 0, item);
}

function createItemId() {
  const randomValue = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `user-${randomValue}`;
}

function createNextName() {
  const existingNames = new Set(editingItems.value.map((item) => normalizeEditableListName(item.name)));
  let name = `${props.newItemLabel} ${nextItemNumber}`;

  while (existingNames.has(normalizeEditableListName(name))) {
    nextItemNumber += 1;
    name = `${props.newItemLabel} ${nextItemNumber}`;
  }

  nextItemNumber += 1;
  return name;
}

function getAddButtonLabel() {
  return `Add ${props.newItemLabel}`;
}

function validateAllNames() {
  const seenNames = new Set<string>();

  for (const item of editingItems.value) {
    const normalizedName = normalizeEditableListName(item.name || props.newItemLabel);

    if (seenNames.has(normalizedName)) {
      showDuplicateNameError();
      return false;
    }

    seenNames.add(normalizedName);
  }

  errorMessage.value = "";
  return true;
}

function hasDuplicateName(name: string, itemId: string) {
  const normalizedName = normalizeEditableListName(name);
  return editingItems.value.some((item) => item.id !== itemId && normalizeEditableListName(item.name) === normalizedName);
}

function showDuplicateNameError() {
  errorMessage.value = "Name already exists.";
  void nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(".editable-list-name-input");
    input?.focus();
    input?.select();
  });
}

function normalizeEditableListName(name: string) {
  return name.trim().toLocaleLowerCase();
}
</script>

<template>
  <div class="confirm-modal-backdrop" role="presentation" @click="$emit('cancel')">
    <section
      ref="modalRef"
      class="confirm-modal editable-list-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editable-list-title"
      tabindex="-1"
      @click.stop
      @keydown.esc.stop="$emit('cancel')"
    >
      <header class="editable-list-header">
        <h2 id="editable-list-title">{{ title }}</h2>
        <button class="editable-list-icon-button editable-list-add-button" type="button" :aria-label="getAddButtonLabel()" :title="getAddButtonLabel()" @click="addItem">
          <span class="editable-list-icon" aria-hidden="true" v-html="plusIcon"></span>
        </button>
      </header>
      <div class="editable-list-body">
        <div ref="listRef" class="editable-list-items">
          <div
            v-for="item in editingItems"
            :key="item.id"
            :data-id="item.id"
            class="editable-list-item"
            :class="{ 'is-active': item.id === activeItemId, 'is-protected': item.protected }"
          >
            <span class="editable-list-drag-handle" aria-hidden="true" @mousedown.prevent>::</span>
            <span
              v-if="editingItemId !== item.id"
              class="editable-list-name-label"
              :class="{ 'is-editable': !item.protected }"
              :title="item.protected ? item.name : 'Double-click to rename'"
              @dblclick="startNameEdit(item)"
            >{{ item.name }}</span>
            <input
              v-else
              v-model="editingItemName"
              class="editable-list-name-input"
              type="text"
              autocomplete="off"
              @keydown.enter.prevent="commitNameEdit(item.id, $event)"
              @keydown.esc.prevent.stop="cancelNameEdit"
              @blur="commitNameEdit(item.id, $event)"
            />
            <button
              class="editable-list-icon-button editable-list-delete-button"
              type="button"
              :disabled="item.protected"
              :aria-label="getDeleteButtonLabel(item)"
              :title="getDeleteButtonLabel(item)"
              @click="removeItem(item.id)"
            >
              <span class="editable-list-icon" aria-hidden="true" v-html="trashIcon"></span>
            </button>
          </div>
        </div>
      </div>
      <p v-if="errorMessage" class="editable-list-error" role="alert">{{ errorMessage }}</p>
      <footer class="editable-list-footer">
        <div class="confirm-modal-actions">
          <button type="button" @click="$emit('cancel')">Cancel</button>
          <button type="button" @click="apply">OK</button>
        </div>
      </footer>
    </section>
  </div>
</template>
