import {pixelArtDisplaySize} from '../data/pixelArtSizing.ts';

/** Keep these values shared with RecipeCard's styles so width math cannot drift. */
export const RECIPE_CARD_BORDER_WIDTH = 1;
export const RECIPE_CARD_PADDING = 10;
export const RECIPE_CARD_HORIZONTAL_CHROME =
  2 * (RECIPE_CARD_BORDER_WIDTH + RECIPE_CARD_PADDING);

export type RecipePreviewScaleMode =
  | 'physical'
  | 'integer-downscale'
  | 'fractional-downscale'
  | 'integer-upscale'
  | 'fractional-upscale';

export interface RecipePreviewDisplaySize {
  width: number;
  height: number;
  scale: number;
  mode: RecipePreviewScaleMode;
}

/**
 * Return the image content width inside a measured RecipeCard border box.
 * React Native layout dimensions are CSS pixels on the web; flooring prevents
 * a fractional flex width from creating a fractional pixel-art raster target.
 */
export function recipeCardImageMaxWidth(availableCardWidth: number): number {
  if (!Number.isFinite(availableCardWidth) || availableCardWidth <= 0) {
    throw new Error('Available recipe-card width must be a positive finite number.');
  }
  return Math.max(1, Math.floor(availableCardWidth) - RECIPE_CARD_HORIZONTAL_CHROME);
}

/**
 * Size one exported JEI layout for a measured RecipeCard.
 *
 * The physical exporter raster is logicalWidth/Height * recipeScale. Display it
 * 1:1 when it fits. Otherwise retain the largest fitting integer logical scale;
 * only art whose 1x logical width cannot fit is reduced fractionally.
 */
export function responsiveRecipePreviewSize(
  logicalWidth: number,
  logicalHeight: number,
  recipeScale: number,
  availableCardWidth: number,
  contentZoom = 1,
): RecipePreviewDisplaySize {
  if (
    ![logicalWidth, logicalHeight, recipeScale].every(Number.isSafeInteger) ||
    logicalWidth <= 0 ||
    logicalHeight <= 0 ||
    recipeScale <= 0 ||
    !Number.isFinite(contentZoom) ||
    contentZoom <= 0
  ) {
    throw new Error(
      'Recipe preview dimensions, exporter scale, and content zoom must be positive values.',
    );
  }
  const physicalWidth = logicalWidth * recipeScale;
  const physicalHeight = logicalHeight * recipeScale;
  if (!Number.isSafeInteger(physicalWidth) || !Number.isSafeInteger(physicalHeight)) {
    throw new Error('Physical recipe preview dimensions exceed the safe integer range.');
  }

  const maxWidth = recipeCardImageMaxWidth(availableCardWidth);
  // The vertically scrolling modal does not need an arbitrary height ceiling.
  // Using the physical height here makes width the only downscaling constraint.
  const display = pixelArtDisplaySize(
    logicalWidth,
    logicalHeight,
    maxWidth,
    physicalHeight,
    recipeScale,
  );
  const zoomScale = Math.min(contentZoom, maxWidth / display.w);
  const width = Math.max(1, Math.round(display.w * zoomScale));
  const height = Math.max(1, Math.round(display.h * zoomScale));
  const scale = width / logicalWidth;
  const mode: RecipePreviewScaleMode =
    scale === recipeScale
      ? 'physical'
      : scale > recipeScale
        ? Number.isInteger(scale)
          ? 'integer-upscale'
          : 'fractional-upscale'
        : Number.isInteger(scale) && scale >= 1
          ? 'integer-downscale'
          : 'fractional-downscale';
  return {width, height, scale, mode};
}

/** Native previews can pan horizontally instead of cancelling zoom at the viewport edge. */
export function nativeRecipePreviewSize(
  logicalWidth: number, logicalHeight: number, recipeScale: number,
  availableCardWidth: number, contentZoom: number, interfaceScale = 1,
): {width: number; height: number} {
  if (!Number.isFinite(interfaceScale) || interfaceScale <= 0 || !Number.isFinite(contentZoom) || contentZoom <= 0) {
    throw new Error('Native recipe display scales must be positive finite values.');
  }
  const base = responsiveRecipePreviewSize(logicalWidth, logicalHeight, recipeScale, availableCardWidth * interfaceScale, 1);
  return {width: base.width * contentZoom / interfaceScale, height: base.height * contentZoom / interfaceScale};
}
