import { DEFAULT_CANVAS_BGC } from "./createDocument";
import { DEFAULT_WIDTH_MODE, normalizeWidthMode, type WidthMode } from "./widthMode";

export type AppLanguage = "en" | "ja";

export type AppSettings = {
  language: AppLanguage;
  canvasBGC: string;
  widthMode: WidthMode;
};

const APP_SETTINGS_STORAGE_KEY = "aa-maker.settings.v1";

export function loadStoredAppSettings(): AppSettings {
  if (typeof localStorage === "undefined") {
    return createDefaultAppSettings();
  }

  try {
    const rawValue = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);

    if (!rawValue) {
      return createDefaultAppSettings();
    }

    const parsedValue = JSON.parse(rawValue) as Record<string, unknown>;
    return normalizeStoredAppSettings(parsedValue);
  } catch {
    return createDefaultAppSettings();
  }
}

export function saveStoredAppSettings(settings: AppSettings) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        language: settings.language,
        canvasBGC: settings.canvasBGC,
        widthMode: settings.widthMode,
      }),
    );
  } catch {
    // 永続化失敗は編集操作を止めない。
  }
}

export function createDefaultAppSettings(): AppSettings {
  return {
    language: "en",
    canvasBGC: DEFAULT_CANVAS_BGC,
    widthMode: DEFAULT_WIDTH_MODE,
  };
}

function normalizeStoredAppSettings(value: Record<string, unknown>): AppSettings {
  return {
    language: value.language === "ja" ? "ja" : "en",
    canvasBGC: normalizeColor(value.canvasBGC) ?? DEFAULT_CANVAS_BGC,
    widthMode: normalizeWidthMode(value.widthMode),
  };
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{6}$/.test(value);
}

function normalizeColor(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  return isColor(normalized) ? normalized : null;
}
