import { onBeforeUnmount, ref } from "vue";

export type ToastKind = "info" | "success" | "error";

export type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

export function useToastQueue(autoDismissMs = 3500) {
  const toasts = ref<ToastItem[]>([]);
  const timers = new Map<number, number>();
  let nextToastId = 1;

  function dismissToast(id: number) {
    const timer = timers.get(id);

    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.delete(id);
    }

    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function pushToast(message: string, kind: ToastKind = "info") {
    const id = nextToastId;
    nextToastId += 1;

    toasts.value = [...toasts.value, { id, kind, message }];

    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, autoDismissMs);
    timers.set(id, timer);
  }

  onBeforeUnmount(() => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  });

  return {
    dismissToast,
    pushToast,
    toasts,
  };
}
