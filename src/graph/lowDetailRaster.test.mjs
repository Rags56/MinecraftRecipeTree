import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOW_DETAIL_ICON_FILL,
  lowDetailRasterGeometry,
} from './lowDetailRaster.ts';

test('draws far-zoom nodes as a square chip on the node centre', () => {
  // The 200x100 box would project to 20x10 -- a wide sliver -- so the chip takes the smaller
  // side, and the centre stays exactly where the layout put it so edges still meet it.
  const geometry = lowDetailRasterGeometry(
    {x: 1_000, y: 500, w: 200, h: 100},
    {x: -25, y: 10, scale: 0.1},
  );
  assert.deepEqual(geometry, {
    left: 80,
    top: 60,
    width: 10,
    height: 10,
    iconLeft: 85 - (10 * LOW_DETAIL_ICON_FILL) / 2,
    iconTop: 65 - (10 * LOW_DETAIL_ICON_FILL) / 2,
    iconSize: 10 * LOW_DETAIL_ICON_FILL,
  });
  assert.equal(geometry.left + geometry.width / 2, 85);
  assert.equal(geometry.top + geometry.height / 2, 65);
});

test('gives the icon most of the chip rather than a fraction of it', () => {
  const geometry = lowDetailRasterGeometry(
    {x: 0, y: 0, w: 172, h: 58},
    {x: 0, y: 0, scale: 0.42},
  );
  assert.ok(
    geometry.iconSize / geometry.width > 0.7,
    `icon filled only ${geometry.iconSize / geometry.width} of its chip`,
  );
});

test('keeps far-zoom geometry visible below one screen pixel', () => {
  const geometry = lowDetailRasterGeometry(
    {x: 0, y: 0, w: 16, h: 16},
    {x: 0, y: 0, scale: 0.001},
  );
  assert.equal(geometry.width, 1);
  assert.equal(geometry.height, 1);
  assert.equal(geometry.iconSize, 1);
});

test('rejects invalid far-zoom raster geometry', () => {
  assert.throws(
    () =>
      lowDetailRasterGeometry(
        {x: 0, y: 0, w: 0, h: 16},
        {x: 0, y: 0, scale: 1},
      ),
    /positive finite dimensions and scale/,
  );
  assert.throws(
    () =>
      lowDetailRasterGeometry(
        {x: 0, y: 0, w: 16, h: 16},
        {x: 0, y: 0, scale: Number.NaN},
      ),
    /positive finite dimensions and scale/,
  );
});
