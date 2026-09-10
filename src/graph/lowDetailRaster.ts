import type {LaidNode} from './layout.ts';
import type {GraphTransform} from './panGesture.ts';

/**
 * Far-zoom nodes are drawn as a square chip on the node's own centre rather than filling the box
 * the layout allocated. An item box is 172 by 58, so drawing it faithfully at this zoom gives a
 * wide empty rectangle with a small icon adrift in the middle of it; the chip is the size the
 * icon actually needs, and the centre is unchanged, so edges still meet it where they always did.
 */
export const LOW_DETAIL_ICON_FILL = 0.78;

export interface LowDetailRasterGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
  iconLeft: number;
  iconTop: number;
  iconSize: number;
}

/**
 * Project graph geometry directly into a fixed viewport canvas. Keeping this
 * projection out of the DOM lets far-zoom trees paint as one inert bitmap.
 */
export function lowDetailRasterGeometry(
  node: Pick<LaidNode, 'x' | 'y' | 'w' | 'h'>,
  transform: GraphTransform,
): LowDetailRasterGeometry {
  if (
    ![
      node.x,
      node.y,
      node.w,
      node.h,
      transform.x,
      transform.y,
      transform.scale,
    ].every(Number.isFinite) ||
    node.w <= 0 ||
    node.h <= 0 ||
    transform.scale <= 0
  ) {
    throw new Error('Low-detail raster geometry requires positive finite dimensions and scale.');
  }

  const centerX = (node.x + node.w / 2) * transform.scale + transform.x;
  const centerY = (node.y + node.h / 2) * transform.scale + transform.y;
  const chip = Math.max(1, Math.min(node.w, node.h) * transform.scale);
  const width = chip;
  const height = chip;
  const iconSize = Math.max(1, chip * LOW_DETAIL_ICON_FILL);
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    iconLeft: centerX - iconSize / 2,
    iconTop: centerY - iconSize / 2,
    iconSize,
  };
}
