export const MINIMUM_CONTENT_ZOOM = 0.75;
export const MAXIMUM_CONTENT_ZOOM = 3;
export const CONTENT_ZOOM_STEP = 0.05;
export const DEFAULT_CONTENT_ZOOM = 1;

/**
 * Recipe imagery and icons can use the full content zoom range, but labels
 * become difficult to scan when their font size grows at the same rate.
 * Keep text responsive while limiting 300% content zoom to 150% text.
 */
export function contentTextScale(contentZoom: number): number {
  const safeZoom = Number.isFinite(contentZoom)
    ? Math.min(MAXIMUM_CONTENT_ZOOM, Math.max(MINIMUM_CONTENT_ZOOM, contentZoom))
    : DEFAULT_CONTENT_ZOOM;
  return 1 + (safeZoom - 1) * 0.25;
}

const CONTENT_ZOOM_STORAGE_KEY = 'contentZoom';
const ZOOM_PRECISION = 2;

export function normalizeContentZoom(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('Recipe and item zoom must be a finite number.');
  }
  const stepIndex = Math.round(
    (value - MINIMUM_CONTENT_ZOOM) / CONTENT_ZOOM_STEP,
  );
  const normalized = Number(
    (MINIMUM_CONTENT_ZOOM + stepIndex * CONTENT_ZOOM_STEP).toFixed(
      ZOOM_PRECISION,
    ),
  );
  if (
    normalized < MINIMUM_CONTENT_ZOOM ||
    normalized > MAXIMUM_CONTENT_ZOOM ||
    Math.abs(normalized - value) > 1e-6
  ) {
    throw new Error(
      `Recipe and item zoom ${String(value)} is outside the supported slider range or step interval.`,
    );
  }
  return normalized;
}

/**
 * Stepping for +/- buttons, which is coarser than the slider's own step: the settings screen
 * offers these as buttons, and the 0.05 the slider moves in would take forty-five presses to
 * cross the range. A multiple of that step, so every stop stays on the same grid the slider and
 * normalizeContentZoom use.
 */
export const CONTENT_ZOOM_BUTTON_STEP = 0.25;

export function stepContentZoom(value: number, direction: -1 | 1): number {
  const normalized = normalizeContentZoom(value);
  const stepped = Number(
    (normalized + direction * CONTENT_ZOOM_BUTTON_STEP).toFixed(ZOOM_PRECISION),
  );
  return Math.min(MAXIMUM_CONTENT_ZOOM, Math.max(MINIMUM_CONTENT_ZOOM, stepped));
}

export function loadContentZoom(legacyInterfaceZoom = DEFAULT_CONTENT_ZOOM): number {
  try {
    const stored = globalThis.localStorage?.getItem(CONTENT_ZOOM_STORAGE_KEY);
    if (stored == null) return normalizeContentZoom(legacyInterfaceZoom);
    const parsed = Number(stored);
    try {
      return normalizeContentZoom(parsed);
    } catch (error) {
      console.warn('Stored recipe and item zoom was invalid and has been reset.', {
        stored,
        error,
      });
    }
  } catch (error) {
    console.error('Recipe and item zoom could not be loaded from localStorage.', error);
  }
  return DEFAULT_CONTENT_ZOOM;
}

export function persistContentZoom(value: number): void {
  const normalized = normalizeContentZoom(value);
  const storage = globalThis.localStorage;
  if (!storage) {
    console.warn('Recipe and item zoom is using memory only because localStorage is unavailable.');
    return;
  }
  storage.setItem(CONTENT_ZOOM_STORAGE_KEY, String(normalized));
}
