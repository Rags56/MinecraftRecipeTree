/** One Minecraft/JEI item occupies a 16×16 logical texel grid, independent of export canvas size. */
export const LOGICAL_ITEM_ICON_GRID_SIZE = 16;
export const RECIPE_HISTORY_ITEM_ICON_SIZE = 32;
export const ROOT_QUICK_ACTION_ITEM_ICON_SIZE = 32;
export const RADIAL_ROOT_ITEM_ICON_SIZE = 48;

/**
 * Pixel-art icons must occupy an integer multiple of their logical grid on the web.
 * Fractional ratios such as 44 / 16 distribute logical texels unevenly and visibly warp renders.
 */
export function isPixelGridAlignedItemIconSize(size: number): boolean {
  return (
    Number.isSafeInteger(size) &&
    size >= LOGICAL_ITEM_ICON_GRID_SIZE &&
    size % LOGICAL_ITEM_ICON_GRID_SIZE === 0
  );
}

/**
 * Scale an item icon without ever asking the pixel renderer for a fractional
 * logical texel grid. Surrounding text and spacing can scale continuously,
 * while the icon advances through crisp 16 px steps.
 */
export function itemIconSizeForContentScale(scale: number): number {
  const finiteScale = Number.isFinite(scale) ? scale : 1;
  return Math.max(1, Math.min(3, Math.round(finiteScale))) * LOGICAL_ITEM_ICON_GRID_SIZE;
}

/** Logical dimensions compensate a scaled native UI so artwork keeps its own scale. */
export function itemGridDisplayMetrics(contentScale: number, renderedUiScale = 1) {
  if (![contentScale, renderedUiScale].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Item grid scales must be positive finite numbers.');
  }
  const scale = contentScale / renderedUiScale;
  return {scale, cellWidth: 104 * scale, iconSize: 48 * scale};
}
