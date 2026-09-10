import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTENT_ZOOM_BUTTON_STEP,
  CONTENT_ZOOM_STEP,
  DEFAULT_CONTENT_ZOOM,
  MAXIMUM_CONTENT_ZOOM,
  MINIMUM_CONTENT_ZOOM,
  contentTextScale,
  normalizeContentZoom,
  stepContentZoom,
} from './contentZoom.ts';

test('recipe and item zoom supports twice the former maximum size', () => {
  assert.equal(normalizeContentZoom(DEFAULT_CONTENT_ZOOM), 1);
  assert.equal(normalizeContentZoom(MINIMUM_CONTENT_ZOOM), 0.75);
  assert.equal(normalizeContentZoom(1.5), 1.5);
  assert.equal(normalizeContentZoom(2.25), 2.25);
  assert.equal(normalizeContentZoom(MAXIMUM_CONTENT_ZOOM), 3);
});

test('recipe labels scale more slowly than images and icons', () => {
  assert.equal(contentTextScale(0.75), 0.9375);
  assert.equal(contentTextScale(1), 1);
  assert.equal(contentTextScale(1.9), 1.225);
  assert.equal(contentTextScale(3), 1.5);
  assert.equal(contentTextScale(Number.NaN), 1);
});

test('recipe and item zoom rejects invalid values', () => {
  assert.throws(() => normalizeContentZoom(0.7), /outside the supported slider range/);
  assert.throws(() => normalizeContentZoom(3.05), /outside the supported slider range/);
  assert.throws(() => normalizeContentZoom(1.09), /outside the supported slider range/);
  assert.throws(() => normalizeContentZoom(Number.NaN), /finite number/);
});

test('steps recipe and item zoom in button-sized increments', () => {
  assert.equal(stepContentZoom(1, 1), 1.25);
  assert.equal(stepContentZoom(1, -1), 0.75);
  // Every stop stays on the grid the slider and normalizeContentZoom share.
  assert.equal(normalizeContentZoom(stepContentZoom(1.25, 1)), 1.5);
  // Whole multiple, checked without a float modulo: 0.25 % 0.05 is 0.0499999… in binary.
  const stepsPerPress = Math.round(CONTENT_ZOOM_BUTTON_STEP / CONTENT_ZOOM_STEP);
  assert.ok(Math.abs(stepsPerPress * CONTENT_ZOOM_STEP - CONTENT_ZOOM_BUTTON_STEP) < 1e-9);
});

test('clamps stepping at both ends of the range', () => {
  assert.equal(stepContentZoom(MINIMUM_CONTENT_ZOOM, -1), MINIMUM_CONTENT_ZOOM);
  assert.equal(stepContentZoom(MAXIMUM_CONTENT_ZOOM, 1), MAXIMUM_CONTENT_ZOOM);
  // A value part way through a button step lands on the grid rather than drifting off it.
  assert.equal(stepContentZoom(2.9, 1), MAXIMUM_CONTENT_ZOOM);
  assert.equal(stepContentZoom(0.8, -1), MINIMUM_CONTENT_ZOOM);
});
