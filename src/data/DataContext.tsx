import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {
  BlockDropEntry,
  BlockDropsFile,
  CatalogItem,
  Category,
  DropStat,
  Manifest,
  Mob,
  Recipe,
  RecipeIndex,
  RecipeRef,
  ShardedJsonDescriptor,
  ShardedJsonPart,
} from '../types';
import type {DatasetDescriptor} from './datasetCatalog';
import {normalizeCatalogItemNames} from './catalogPresentation';
import {
  GTNH_1710_DATASET_PROFILE,
  GTNH_PACK_NAME,
  GTNH_PACK_VERSION,
  GTNH_STRUCTURED_DATA_ONLY_POLICY,
  isExactGtnhDatasetAttribution,
  isExactGtnhVisualAssetsPolicy,
} from './datasetAttribution';
import {requireRecipeStructure} from './recipeStructure';
import {applyLegacyRecipeStructures} from './legacyRecipeStructures';
import {
  datasetIdentityFromManifest,
  isDatasetPublicationId,
  versionExportUrl,
} from './datasetIdentity';
import {
  BoundedAbsentItemIconCollector,
  BoundedItemIconFailureReporter,
  type ItemIconLoadFailure,
} from './itemIconDiagnostics';
import {
  PREVIEW_MAX_CATEGORY_BYTES,
  RecipePreviewCategoryDocument,
  RecipePreviewEntry,
  RecipePreviewManifest,
  isCanonicalRecipePreviewImagePath,
  previewAssetUrl,
  recipePreviewImagePath,
  requirePreviewEntries,
  requireRecipePreviewCategory,
  requireRecipePreviewManifest,
  selectRecipePreviewEntries,
  versionPreviewUrl,
} from './previewAssets';
import {
  catalogVisualReferenceCounts,
  recipeVisualReferenceIndices,
  shouldFetchRecipePreviewSidecar,
} from './publicationRights';
import {
  isMetaRecipeCategory,
  isRepairRecipeCategory,
  isSecondaryRecipeCategory,
} from './recipeCategories';
import {applyRecipeStageMetadata} from './recipeStages';
import {reconstructLegacyReplaceableInputs} from './legacyReplaceableInputs';
import {promoteReturnedRecipeIngredients} from './returnedRecipeIngredients';
import {RecipeSessionCache, recipeSessionCacheKey} from './recipeSessionCache';
import {
  MAX_NETWORK_DOCUMENT_BYTES,
  isLocalPackExportUrl,
  runtimeDocumentByteLimit,
} from './runtimeDocumentLimits';
import {readLocalDatasetDocument} from './localDatasetDocument';
import {
  readCachedPublishedDocument,
  writeCachedPublishedDocument,
} from './publishedDatasetCache';
import {localDatasetVisualUri} from './localDatasetVisual';

const SHARDED_JSON_FORMAT = 'mrt-sharded-json-v1';
const MAX_SHARD_BYTES = MAX_NETWORK_DOCUMENT_BYTES;
const MAX_RECIPE_PART_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_RECIPE_PART_CACHE_ENTRIES = 8;
const MAX_PREVIEW_METADATA_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_PREVIEW_METADATA_CACHE_ENTRIES = 32;
const UTF8_ENCODER = new TextEncoder();
const PACKED_IMAGE_ROUTE = /^assets\/s\/(\d+)-(\d+)-(\d+)\.webp$/;
const RECIPE_IMAGE_INVENTORY_FORMAT = 'mrt-recipe-image-inventory-v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const QUALITY_PROFILE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9.]+)*$/;

interface BoundedJsonDocument {
  value: unknown;
  bytes: number;
}

interface RecipePartCacheEntry {
  bytes: number;
  promise: Promise<Recipe[]>;
}

class RecipePartCache {
  private readonly entries = new Map<string, RecipePartCacheEntry>();
  private retainedBytes = 0;

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  getOrLoad(key: string, bytes: number, loader: () => Promise<Recipe[]>): Promise<Recipe[]> {
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.bytes !== bytes) {
        throw new Error(
          `Recipe shard ${key} was requested with conflicting byte lengths ` +
            `(${cached.bytes} and ${bytes}).`,
        );
      }
      // Map insertion order is the LRU order.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }

    const entry = {} as RecipePartCacheEntry;
    entry.bytes = bytes;
    entry.promise = loader().catch(error => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        this.retainedBytes -= entry.bytes;
      }
      throw error;
    });
    this.entries.set(key, entry);
    this.retainedBytes += bytes;

    while (
      this.entries.size > MAX_RECIPE_PART_CACHE_ENTRIES ||
      this.retainedBytes > MAX_RECIPE_PART_CACHE_BYTES
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);
      this.retainedBytes -= oldest.bytes;
    }
    return entry.promise;
  }
}

interface BoundedPromiseCacheEntry<T> {
  bytes: number;
  promise: Promise<T>;
}

class BoundedPromiseCache<T> {
  private readonly entries = new Map<string, BoundedPromiseCacheEntry<T>>();
  private retainedBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }

  getOrLoad(key: string, bytes: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached) {
      if (cached.bytes !== bytes) {
        throw new Error(
          `Preview metadata ${key} was requested with conflicting byte budgets ` +
            `(${cached.bytes} and ${bytes}).`,
        );
      }
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }

    const entry = {} as BoundedPromiseCacheEntry<T>;
    entry.bytes = bytes;
    entry.promise = loader().catch(error => {
      if (this.entries.get(key) === entry) {
        this.entries.delete(key);
        this.retainedBytes -= entry.bytes;
      }
      throw error;
    });
    this.entries.set(key, entry);
    this.retainedBytes += bytes;
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = this.entries.get(oldestKey)!;
      this.entries.delete(oldestKey);
      this.retainedBytes -= oldest.bytes;
    }
    return entry.promise;
  }
}

type RecipeDocument =
  | {kind: 'inline'; url: string; cacheKey: string; bytes: number; count: number}
  | {kind: 'sharded'; descriptor: ShardedJsonDescriptor};

/**
 * Vanilla rewards emitted by entity death code instead of the entity loot table.
 * Older exports cannot discover these through loot-table sampling alone.
 */
const CUSTOM_DEATH_DROPS: Record<string, DropStat[]> = {
  'minecraft:wither': [
    {k: 'item|minecraft:nether_star', c: 1, min: 1, max: 1, avg: 1},
  ],
};

function supplementCustomDeathDrops(exportedMobs: Mob[]): Mob[] {
  return exportedMobs.map(mob => {
    const supplemental = CUSTOM_DEATH_DROPS[mob.id];
    if (!supplemental) return mob;
    const existingKeys = new Set((mob.drops ?? []).map(drop => drop.k));
    const missing = supplemental.filter(drop => !existingKeys.has(drop.k));
    if (missing.length === 0) return mob;
    console.warn('Mob export omitted custom death-code drops; supplementing known drops.', {
      mobId: mob.id,
      itemKeys: missing.map(drop => drop.k),
    });
    return {...mob, drops: [...(mob.drops ?? []), ...missing]};
  });
}

class ExportHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

function parseExportJson<T>(text: string, url: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON from ${url}: ${detail}`);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const local = await readLocalDatasetDocument(url);
  if (local !== null) return parseExportJson<T>(local.text, url);
  // A caller passing cache: 'no-store' wants a genuinely fresh read (only the manifest fetches
  // do this, to reconfirm identity after the rest of a dataset's documents load); respect that
  // over this native-only persistent cache the same way it already bypasses the network's own.
  const bypassCache = init?.cache === 'no-store';
  if (!bypassCache) {
    const cached = await readCachedPublishedDocument(url);
    if (cached !== null) return parseExportJson<T>(cached.text, url);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new ExportHttpError(res.status, url);
  const text = await res.text();
  const parsed = parseExportJson<T>(text, url);
  if (!bypassCache) void writeCachedPublishedDocument(url, text);
  return parsed;
}

async function fetchBoundedJson(
  url: string,
  expectedBytes?: number,
): Promise<BoundedJsonDocument> {
  const local = await readLocalDatasetDocument(url);
  let source: string;
  let bytes: number;
  if (local !== null) {
    source = local.text;
    bytes = local.bytes;
  } else {
    const cached = await readCachedPublishedDocument(url);
    if (cached !== null) {
      source = cached.text;
      bytes = cached.bytes;
    } else {
      const res = await fetch(url);
      if (!res.ok) throw new ExportHttpError(res.status, url);
      source = await res.text();
      bytes = UTF8_ENCODER.encode(source).byteLength;
      void writeCachedPublishedDocument(url, source);
    }
  }
  const maximumBytes = runtimeDocumentByteLimit(url);
  if (bytes > maximumBytes) {
    const compatibilityHint = isLocalPackExportUrl(url)
      ? ' Re-export with the latest exporter to split this legacy document into smaller shards.'
      : '';
    throw new Error(
      `Export document ${url} is ${bytes} UTF-8 bytes, above the ` +
        `${maximumBytes}-byte runtime limit.${compatibilityHint}`,
    );
  }
  if (expectedBytes !== undefined && bytes !== expectedBytes) {
    throw new Error(
      `Export shard ${url} declares ${expectedBytes} UTF-8 bytes but returned ${bytes}.`,
    );
  }
  try {
    return {value: JSON.parse(source) as unknown, bytes};
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON from ${url}: ${detail}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeShardPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.endsWith('.json') || value.startsWith('/')) {
    return false;
  }
  if (value.includes('\\') || value.includes('?') || value.includes('#')) return false;
  const segments = value.split('/');
  return (
    segments.every(
      segment =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        /^[A-Za-z0-9._-]+$/.test(segment),
    ) && segments.length > 1
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function looksLikeShardedDescriptor(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (value.format === SHARDED_JSON_FORMAT ||
      ('parts' in value && ('kind' in value || 'count' in value)))
  );
}

function parseShardedDescriptor(
  value: unknown,
  kind: 'array' | 'object',
  url: string,
): ShardedJsonDescriptor | null {
  if (!looksLikeShardedDescriptor(value)) return null;
  if (
    !hasExactKeys(value, ['format', 'kind', 'count', 'parts']) ||
    value.format !== SHARDED_JSON_FORMAT ||
    value.kind !== kind ||
    !isNonnegativeSafeInteger(value.count) ||
    !Array.isArray(value.parts)
  ) {
    throw new Error(
      `Invalid export document ${url}: expected an exact ${SHARDED_JSON_FORMAT} ` +
        `${kind} descriptor.`,
    );
  }
  if ((value.count === 0) !== (value.parts.length === 0)) {
    throw new Error(
      `Invalid export descriptor ${url}: empty documents must have zero parts and ` +
        `non-empty documents must enumerate their parts.`,
    );
  }
  if (value.parts.length > 10_000) {
    throw new Error(`Invalid export descriptor ${url}: too many shard parts.`);
  }

  const parts: ShardedJsonPart[] = [];
  const seenPaths = new Set<string>();
  let expectedStart = 0;
  let totalCount = 0;
  for (const [partIndex, candidate] of value.parts.entries()) {
    const expectedKeys = kind === 'array'
      ? ['path', 'start', 'count', 'bytes']
      : ['path', 'count', 'bytes'];
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, expectedKeys) ||
      !isSafeShardPath(candidate.path) ||
      !isPositiveSafeInteger(candidate.count) ||
      !isPositiveSafeInteger(candidate.bytes) ||
      candidate.bytes > MAX_SHARD_BYTES
    ) {
      throw new Error(
        `Invalid export descriptor ${url}: shard part ${partIndex} has malformed metadata.`,
      );
    }
    if (seenPaths.has(candidate.path)) {
      throw new Error(
        `Invalid export descriptor ${url}: shard path ${candidate.path} is repeated.`,
      );
    }
    seenPaths.add(candidate.path);
    if (kind === 'array') {
      if (!isNonnegativeSafeInteger(candidate.start) || candidate.start !== expectedStart) {
        throw new Error(
          `Invalid export descriptor ${url}: array part ${partIndex} must start at ` +
            `${expectedStart}.`,
        );
      }
      expectedStart += candidate.count;
    }
    totalCount += candidate.count;
    if (!Number.isSafeInteger(totalCount)) {
      throw new Error(`Invalid export descriptor ${url}: shard counts overflow.`);
    }
    parts.push({
      path: candidate.path,
      ...(kind === 'array' ? {start: candidate.start as number} : {}),
      count: candidate.count,
      bytes: candidate.bytes,
    });
  }
  if (totalCount !== value.count || (kind === 'array' && expectedStart !== value.count)) {
    throw new Error(
      `Invalid export descriptor ${url}: parts contain ${totalCount} entries, ` +
        `expected ${value.count}.`,
    );
  }
  return {format: SHARDED_JSON_FORMAT, kind, count: value.count, parts};
}

function partUrl(base: string, path: string, datasetIdentity: string): string {
  return versionExportUrl(`${base}/${path}`, datasetIdentity);
}

function isCanonicalPackedImagePath(value: string): boolean {
  const match = PACKED_IMAGE_ROUTE.exec(value);
  if (!match) return false;
  const [packText, offsetText, lengthText] = match.slice(1);
  const packNumber = Number(packText);
  const offset = Number(offsetText);
  const length = Number(lengthText);
  return (
    Number.isSafeInteger(packNumber) &&
    packNumber >= 0 &&
    String(packNumber).padStart(3, '0') === packText &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    String(offset) === offsetText &&
    Number.isSafeInteger(length) &&
    length > 0 &&
    String(length) === lengthText &&
    Number.isSafeInteger(offset + length) &&
    offset + length <= 1024 * 1024
  );
}

function isSafeRootImagePath(value: string): boolean {
  if (!/\.(?:png|webp)$/.test(value) || value.startsWith('/')) return false;
  if (value.includes('\\') || value.includes('?') || value.includes('#')) return false;
  return value
    .split('/')
    .every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** Resolve the two explicit recipe-image schemas without reinterpreting embedded paths. */
export function recipeImagePath(categoryDir: string, image: string): string {
  if (image.startsWith('assets/s/')) {
    if (isCanonicalPackedImagePath(image)) return image;
    const error = new Error(`Packed recipe image has a malformed coordinate path: ${image}`);
    console.error(error.message);
    throw error;
  }
  if (image.startsWith('recipe-assets/s/')) {
    if (isCanonicalRecipePreviewImagePath(image)) return image;
    const error = new Error(`External recipe preview has a malformed coordinate path: ${image}`);
    console.error(error.message);
    throw error;
  }
  if (!/^[A-Za-z0-9._-]+\.(?:png|webp)$/.test(image) || !isSafeShardPath(`${categoryDir}/x.json`)) {
    const error = new Error(
      `Legacy recipe image path is malformed: category=${categoryDir}, image=${image}`,
    );
    console.error(error.message);
    throw error;
  }
  return `${categoryDir}/${image}`;
}

async function loadArrayDescriptor<T>(
  descriptor: ShardedJsonDescriptor,
  descriptorUrl: string,
  base: string,
  datasetIdentity: string,
): Promise<T[]> {
  const loaded = await Promise.all(
    descriptor.parts.map(async part => {
      const url = partUrl(base, part.path, datasetIdentity);
      const {value} = await fetchBoundedJson(url, part.bytes);
      if (!Array.isArray(value) || value.length !== part.count) {
        throw new Error(
          `Invalid export shard ${url}: expected an array containing ${part.count} entries.`,
        );
      }
      return value as T[];
    }),
  );
  const result = loaded.flat();
  if (result.length !== descriptor.count) {
    throw new Error(
      `Invalid export descriptor ${descriptorUrl}: assembled ${result.length} array entries, ` +
        `expected ${descriptor.count}.`,
    );
  }
  return result;
}

async function loadObjectDescriptor<T>(
  descriptor: ShardedJsonDescriptor,
  descriptorUrl: string,
  base: string,
  datasetIdentity: string,
): Promise<Record<string, T>> {
  const loaded = await Promise.all(
    descriptor.parts.map(async part => {
      const url = partUrl(base, part.path, datasetIdentity);
      const {value} = await fetchBoundedJson(url, part.bytes);
      if (!isRecord(value) || Object.keys(value).length !== part.count) {
        throw new Error(
          `Invalid export shard ${url}: expected an object containing ${part.count} entries.`,
        );
      }
      return value as Record<string, T>;
    }),
  );
  const result: Record<string, T> = Object.create(null) as Record<string, T>;
  let count = 0;
  for (const shard of loaded) {
    for (const [key, entry] of Object.entries(shard)) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw new Error(
          `Invalid export descriptor ${descriptorUrl}: object key ${key} is repeated.`,
        );
      }
      result[key] = entry;
      count += 1;
    }
  }
  if (count !== descriptor.count) {
    throw new Error(
      `Invalid export descriptor ${descriptorUrl}: assembled ${count} object entries, ` +
        `expected ${descriptor.count}.`,
    );
  }
  return result;
}

function requireRecipeArray(value: unknown, count: number, url: string): Recipe[] {
  if (!Array.isArray(value) || value.length !== count || !value.every(isRecord)) {
    throw new Error(
      `Invalid recipe document ${url}: expected ${count} recipe objects.`,
    );
  }
  return value.map((recipe, recipeIndex) => {
    const typed = recipe as Recipe;
    if (typed.structure !== undefined) {
      typed.structure = requireRecipeStructure(
        typed.structure,
        `${url} recipe ${recipeIndex}.structure`,
      );
    }
    return typed;
  });
}

function isManifestCounts(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['items', 'recipes', 'categories', 'mobs', 'failures'].every(name =>
      isNonnegativeSafeInteger(value[name]),
    )
  );
}

function isManifestSettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.iconScale) &&
    isPositiveSafeInteger(value.recipeScale) &&
    isPositiveSafeInteger(value.mobCanvas)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(name => typeof name === 'string');
}

const PACK_IDENTITY_SOURCES = new Set([
  'explicit-request',
  'curseforge',
  'prism',
  'modrinth-index',
  'game-directory',
]);
const PACK_PROVIDERS = new Set(['curseforge', 'prism', 'modrinth']);
const UNSAFE_PACK_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/u;

function isBoundedPackText(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !UNSAFE_PACK_TEXT.test(value)
  );
}

function isManifestPack(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const allowed = new Set([
    'identitySource',
    'instanceName',
    'name',
    'projectId',
    'provider',
    'version',
    'versionId',
  ]);
  if (Object.keys(value).some(key => !allowed.has(key))) return false;
  if (
    !isBoundedPackText(value.name, 120) ||
    !isBoundedPackText(value.identitySource, 40) ||
    !PACK_IDENTITY_SOURCES.has(value.identitySource)
  ) {
    return false;
  }
  if (value.version !== undefined && !isBoundedPackText(value.version, 80)) return false;
  if (value.instanceName !== undefined && !isBoundedPackText(value.instanceName, 120)) return false;
  if (
    value.provider !== undefined &&
    (!isBoundedPackText(value.provider, 40) || !PACK_PROVIDERS.has(value.provider))
  ) {
    return false;
  }
  if (value.projectId !== undefined && !isBoundedPackText(value.projectId, 120)) return false;
  if (value.versionId !== undefined && !isBoundedPackText(value.versionId, 120)) return false;
  return !(
    (value.projectId !== undefined || value.versionId !== undefined) &&
    value.provider === undefined
  );
}

function isManifestWeb(value: unknown, expectedRecipes: number): boolean {
  const recipeImages = isRecord(value) ? value.recipeImages : undefined;
  const structuredDataOnly =
    isRecord(value) && isExactGtnhVisualAssetsPolicy(value.visualAssets);
  const recipeImageInventory = isRecord(recipeImages) ? recipeImages.inventory : undefined;
  const recipeImageInventoryValid =
    isRecord(recipeImageInventory) &&
    Object.keys(recipeImageInventory).length === 5 &&
    Object.prototype.hasOwnProperty.call(recipeImageInventory, 'format') &&
    Object.prototype.hasOwnProperty.call(recipeImageInventory, 'sha256') &&
    recipeImageInventory.format === RECIPE_IMAGE_INVENTORY_FORMAT &&
    typeof recipeImageInventory.sha256 === 'string' &&
    SHA256_PATTERN.test(recipeImageInventory.sha256) &&
    isNonnegativeSafeInteger(recipeImageInventory.entries) &&
    isNonnegativeSafeInteger(recipeImageInventory.previews) &&
    isNonnegativeSafeInteger(recipeImageInventory.missing) &&
    recipeImageInventory.entries === expectedRecipes &&
    recipeImageInventory.entries ===
      recipeImageInventory.previews + recipeImageInventory.missing;
  const recipeImagesValid =
    (!structuredDataOnly && recipeImages === undefined) ||
    (!structuredDataOnly && isRecord(recipeImages) && recipeImages.mode === 'included') ||
    (isRecord(recipeImages) &&
      recipeImages.mode === 'omitted' &&
      (!structuredDataOnly ||
        hasExactKeys(recipeImages, [
          'mode',
          'reason',
          'policy',
          'references',
          'files',
          'encoding',
          'bytes',
          'inventory',
        ])) &&
      (structuredDataOnly
        ? recipeImages.reason === 'third-party-artwork-rights-not-cleared' &&
          recipeImages.policy === GTNH_STRUCTURED_DATA_ONLY_POLICY
        : recipeImages.reason === 'hosting-archive-budget' && recipeImages.policy === undefined) &&
      typeof recipeImages.references === 'number' &&
      Number.isSafeInteger(recipeImages.references) &&
      recipeImages.references >= 0 &&
      typeof recipeImages.files === 'number' &&
      Number.isSafeInteger(recipeImages.files) &&
      recipeImages.files >= 0 &&
      (recipeImages.encoding === undefined || recipeImages.encoding === 'png') &&
      typeof recipeImages.bytes === 'number' &&
      Number.isSafeInteger(recipeImages.bytes) &&
      recipeImages.bytes >= 0 &&
      recipeImageInventoryValid &&
      recipeImageInventory.previews === recipeImages.references &&
      recipeImageInventory.missing === expectedRecipes - recipeImages.references &&
      recipeImages.files === recipeImages.references);
  return (
    isRecord(value) &&
    value.format === 2 &&
    (structuredDataOnly
      ? value.packedImages === undefined &&
        value.maxPackBytes === undefined &&
        hasExactKeys(value, [
          'format',
          'shardedJson',
          'maxShardBytes',
          'visualAssets',
          'recipeImages',
        ])
      : value.packedImages === 'coordinate-v1' && value.maxPackBytes === 1024 * 1024) &&
    value.shardedJson === SHARDED_JSON_FORMAT &&
    value.maxShardBytes === MAX_SHARD_BYTES &&
    recipeImagesValid
  );
}

function requireStructuredDataOnlyCatalog(
  items: readonly CatalogItem[],
  categories: readonly Category[],
  mobs: readonly Mob[],
  datasetIdentity: string,
): void {
  const counts = catalogVisualReferenceCounts(items, categories, mobs);
  if (counts.itemIcons === 0 && counts.categoryIcons === 0 && counts.mobSprites === 0) return;
  const error = new Error(
    `Dataset ${datasetIdentity} claims ${GTNH_STRUCTURED_DATA_ONLY_POLICY} but its catalog ` +
      `contains exported visual references (itemIcons=${counts.itemIcons}, ` +
      `categoryIcons=${counts.categoryIcons}, mobSprites=${counts.mobSprites}).`,
  );
  console.error(error.message, {
    counts,
  });
  throw error;
}

function requireStructuredDataOnlyRecipes(
  recipes: Recipe[],
  label: string,
): Recipe[] {
  const visualRecipeIndices = recipeVisualReferenceIndices(recipes);
  if (visualRecipeIndices.length === 0) return recipes;
  const error = new Error(
    `${label} violates ${GTNH_STRUCTURED_DATA_ONLY_POLICY}: ` +
      `${visualRecipeIndices.length} recipe records contain exported preview references.`,
  );
  console.error(error.message, {
    recipeIndices: visualRecipeIndices.slice(0, 20),
  });
  throw error;
}

function isExactManifestPublicationPolicy(value: Record<string, unknown>): boolean {
  const gtnh = value.profile === GTNH_1710_DATASET_PROFILE;
  const visualAssets = isRecord(value.web) ? value.web.visualAssets : undefined;
  if (!gtnh) return value.publicationPolicy === undefined && visualAssets === undefined;
  return (
    (value.publicationPolicy === GTNH_STRUCTURED_DATA_ONLY_POLICY &&
      isExactGtnhVisualAssetsPolicy(visualAssets)) ||
    (value.publicationPolicy === undefined && visualAssets === undefined)
  );
}

function isManifestDocument(value: unknown): value is Manifest {
  if (!isRecord(value)) return false;
  const expectedRecipes = isRecord(value.counts) && isNonnegativeSafeInteger(value.counts.recipes)
    ? value.counts.recipes
    : -1;
  return (
    Number.isSafeInteger(value.format) &&
    typeof value.generatedAt === 'string' &&
    value.generatedAt.length > 0 &&
    Number.isFinite(Date.parse(value.generatedAt)) &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    typeof value.minecraft === 'string' &&
    value.minecraft.length > 0 &&
    (value.profile === undefined ||
      (typeof value.profile === 'string' &&
        value.profile.length <= 80 &&
        QUALITY_PROFILE_PATTERN.test(value.profile))) &&
    isExactManifestPublicationPolicy(value) &&
    (value.pack === undefined || isManifestPack(value.pack)) &&
    (value.profile !== GTNH_1710_DATASET_PROFILE ||
      (isRecord(value.pack) &&
        isManifestPack(value.pack) &&
        value.pack.name === GTNH_PACK_NAME &&
        value.pack.version === GTNH_PACK_VERSION &&
        value.pack.identitySource === 'explicit-request' &&
        isExactGtnhDatasetAttribution(value.attribution))) &&
    isDatasetPublicationId(value.publicationId) &&
    typeof value.aborted === 'boolean' &&
    isManifestCounts(value.counts) &&
    isManifestSettings(value.settings) &&
    isStringRecord(value.mods) &&
    (value.web === undefined || isManifestWeb(value.web, expectedRecipes))
  );
}

function requireDocument<T>(
  value: unknown,
  url: string,
  isValid: (candidate: unknown) => candidate is T,
  expected: string,
): T {
  if (!isValid(value)) throw new Error(`Invalid export document ${url}: expected ${expected}.`);
  return value;
}

async function fetchOptionalJson<T>(
  url: string,
  isValid: (candidate: unknown) => candidate is T,
  expected: string,
  emptyValue: T,
): Promise<T> {
  try {
    const value = await fetchJson<unknown>(url);
    if (!isValid(value)) {
      throw new Error(`expected ${expected}`);
    }
    return value;
  } catch (error) {
    if (error instanceof ExportHttpError && error.status === 404) {
      console.info(`Optional export document ${url} is absent; this capability is unavailable.`);
      return emptyValue;
    }
    console.error(`Optional export document ${url} failed validation or transport.`, error);
    throw error;
  }
}

export interface ModInfo {
  id: string;
  name: string;
  itemCount: number;
}

export interface Data {
  descriptor: DatasetDescriptor;
  base: string;
  datasetIdentity: string;
  manifest: Manifest;
  items: CatalogItem[];
  itemsByKey: Map<string, CatalogItem>;
  categories: Category[];
  mobs: Mob[];
  index: RecipeIndex;
  indexStatus: 'idle' | 'loading' | 'ready' | 'error';
  indexError: string | null;
  /** Load and authenticate the reverse-index shards before recipe or graph access. */
  ensureIndex(): Promise<void>;
  mods: ModInfo[];
  /** Block item key -> what breaking that block drops */
  blockDrops: Record<string, BlockDropEntry>;
  /** Item key -> mobs that drop it */
  droppedByMobs: Map<string, {mob: Mob; stat: DropStat}[]>;
  /** Item key -> block item keys whose breaking drops it */
  minedFrom: Map<string, {blockKey: string; stat: DropStat}[]>;
  capabilities: {
    mobs: boolean;
    blockDrops: boolean;
    recipePreviews: boolean;
  };
  /**
   * Category indices for JEI meta-categories (tag listings, info pages) that aren't
   * real recipes — hidden from recipe/usage lists and the graph.
   */
  metaCategories: Set<number>;
  /**
   * Category indices for utility categories (anvil repairs, smithing, trading) that are
   * real but noisy — each gets its own tab in the item view instead of Recipes/Usages,
   * and the graph only uses them when nothing else produces an item.
   */
  secondaryCategories: Set<number>;
  /** Subset of secondaryCategories that are pure repairs (anvil) — last resort in the graph. */
  repairCategories: Set<number>;
  imageUrl(rel?: string): string | undefined;
  /** Report an item asset transport/decoder failure through the dataset-scoped bounded logger. */
  reportItemIconFailure(failure: ItemIconLoadFailure): void;
  /** Load exactly the recipe shards needed by the requested category/index references. */
  getRecipes(refs: readonly RecipeRef[]): Promise<Recipe[]>;
  /** Read a recently resolved recipe without starting another asynchronous load. */
  getCachedRecipe(ref: RecipeRef): Recipe | undefined;
}

export type LoadState =
  | {status: 'loading'; step: string}
  | {status: 'error'; kind: 'load' | 'stale'; message: string; base: string}
  | {status: 'ready'; data: Data};

function exportLoadErrorState(
  error: unknown,
  base: string,
): Extract<LoadState, {status: 'error'}> {
  if (error instanceof ExportHttpError && error.status === 409) {
    return {
      status: 'error',
      kind: 'stale',
      base,
      message:
        'The selected immutable publication was rejected by the dataset service. Reload the ' +
        'catalog before requesting this pack again.',
    };
  }
  return {
    status: 'error',
    kind: 'load',
    base,
    message: String(error instanceof Error ? error.message : error),
  };
}

const DataContext = createContext<LoadState>({status: 'loading', step: 'init'});

export function DataProvider({
  children,
  descriptor,
  base,
  previewBase: configuredPreviewBase,
}: {
  children: React.ReactNode;
  descriptor: DatasetDescriptor;
  base: string;
  previewBase: string;
}) {
  const [state, setState] = useState<LoadState>({status: 'loading', step: 'manifest.json'});
  const recipeDocumentCache = useRef(new Map<number, Promise<RecipeDocument>>());
  const recipePartCache = useRef(new RecipePartCache());
  const recipeSessionCache = useRef(new RecipeSessionCache());
  const previewCategoryCache = useRef(
    new BoundedPromiseCache<RecipePreviewCategoryDocument>(
      MAX_PREVIEW_METADATA_CACHE_ENTRIES,
      MAX_PREVIEW_METADATA_CACHE_BYTES,
    ),
  );
  const previewPartCache = useRef(
    new BoundedPromiseCache<RecipePreviewEntry[]>(
      MAX_PREVIEW_METADATA_CACHE_ENTRIES,
      MAX_PREVIEW_METADATA_CACHE_BYTES,
    ),
  );
  const missingPreviewDiagnostics = useRef(new Set<string>());
  const absentItemIconSummaryDataset = useRef<string | null>(null);
  const indexLoadPromise = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let alive = true;
    recipeDocumentCache.current.clear();
    recipePartCache.current.clear();
    recipeSessionCache.current.clear();
    previewCategoryCache.current.clear();
    previewPartCache.current.clear();
    missingPreviewDiagnostics.current.clear();
    absentItemIconSummaryDataset.current = null;
    indexLoadPromise.current = null;
    (async () => {
      try {
        setState({status: 'loading', step: 'manifest.json'});
        if (!isDatasetPublicationId(descriptor.publicationId)) {
          throw new Error(
            `Dataset ${JSON.stringify(descriptor.slug)} has an invalid publication identity.`,
          );
        }
        if (!isDatasetPublicationId(descriptor.previewAssetSetId)) {
          throw new Error(
            `Dataset ${JSON.stringify(descriptor.slug)} has an invalid preview asset-set identity.`,
          );
        }
        const datasetIdentity = descriptor.publicationId;
        const manifestUrl = `${base}/manifest.json`;
        const versionedManifestUrl = versionExportUrl(manifestUrl, datasetIdentity);
        const manifest = requireDocument<Manifest>(
          await fetchJson<unknown>(versionedManifestUrl, {cache: 'no-store'}),
          versionedManifestUrl,
          isManifestDocument,
          'a manifest object with a SHA-256 publicationId and required export metadata',
        );
        if (datasetIdentityFromManifest(manifest) !== datasetIdentity) {
          throw new Error(
            `Dataset ${JSON.stringify(descriptor.slug)} returned publication ` +
              `${JSON.stringify(manifest.publicationId)} from ${manifestUrl}; expected ` +
              `${JSON.stringify(datasetIdentity)}.`,
          );
        }
        if (manifest.minecraft !== descriptor.minecraftVersion) {
          throw new Error(
            `Dataset ${JSON.stringify(descriptor.slug)} returned Minecraft version ` +
              `${JSON.stringify(manifest.minecraft)}; catalog declares ` +
              `${JSON.stringify(descriptor.minecraftVersion)}.`,
          );
        }
        if (manifest.pack === undefined) {
          console.warn(
            'The active dataset predates exporter-provided pack identity. Catalog labels remain ' +
              'available for compatibility, but every newly prepared publication must contain manifest.pack.',
            {datasetIdentity, slug: descriptor.slug},
          );
        } else {
          if (manifest.pack.name !== descriptor.displayName) {
            throw new Error(
              `Dataset ${JSON.stringify(descriptor.slug)} identifies itself as ` +
                `${JSON.stringify(manifest.pack.name)}; catalog declares ` +
                `${JSON.stringify(descriptor.displayName)}.`,
            );
          }
          if (
            manifest.pack.version !== undefined &&
            manifest.pack.version !== descriptor.packVersion
          ) {
            throw new Error(
              `Dataset ${JSON.stringify(descriptor.slug)} identifies pack version ` +
                `${JSON.stringify(manifest.pack.version)}; catalog declares ` +
                `${JSON.stringify(descriptor.packVersion)}.`,
            );
          }
        }
        if (manifest.aborted) {
          throw new Error(
            `Export manifest ${manifestUrl} is marked aborted; refusing to display partial data.`,
          );
        }
        const structuredDataOnly =
          manifest.publicationPolicy === GTNH_STRUCTURED_DATA_ONLY_POLICY;
        if (structuredDataOnly) {
          console.info(
            `${GTNH_STRUCTURED_DATA_ONLY_POLICY} is active; exported item/category icons, ` +
              'mob sprites, and recipe-preview network requests are disabled. The UI will use ' +
              'deterministic generated placeholders.',
            {datasetIdentity, slug: descriptor.slug},
          );
        } else if (manifest.web?.recipeImages?.mode === 'omitted') {
          console.info(
            `The compact publication stores ${manifest.web.recipeImages.references} JEI layout ` +
              'previews in its required external sidecar.',
          );
          if (manifest.web.recipeImages.encoding !== 'png') {
            console.warn(
              'The active core dataset uses the legacy omitted-WebP byte accounting contract. ' +
                'It remains readable only for zero-downtime migration; every new import must ' +
                'publish encoding="png" and original PNG bytes.',
              {datasetIdentity},
            );
          }
        }
        setState({status: 'loading', step: 'items, categories, mobs, index…'});
        const itemsUrl = versionExportUrl(`${base}/items.json`, datasetIdentity);
        const categoriesUrl = versionExportUrl(`${base}/categories.json`, datasetIdentity);
        const indexUrl = versionExportUrl(`${base}/index.json`, datasetIdentity);
        const externalPreviewsRequired = shouldFetchRecipePreviewSidecar(manifest);
        const expectedExternalPreviewCount =
          externalPreviewsRequired && manifest.web?.recipeImages?.mode === 'omitted'
            ? manifest.web.recipeImages.references
            : null;
        const previewBase = externalPreviewsRequired ? configuredPreviewBase : null;
        const previewManifestUrl = previewBase
          ? versionPreviewUrl(
              `${previewBase}/manifest.json`,
              datasetIdentity,
              descriptor.previewAssetSetId,
            )
          : null;
        const [itemsRoot, categoriesValue, indexRoot, mobsDoc, blockDropsDoc, previewManifest] =
          await Promise.all([
            fetchBoundedJson(itemsUrl),
            fetchJson<unknown>(categoriesUrl),
            fetchBoundedJson(indexUrl),
            fetchOptionalJson<{mobs: Mob[]}>(
              versionExportUrl(`${base}/mobs.json`, datasetIdentity),
              (value): value is {mobs: Mob[]} =>
                isRecord(value) && Array.isArray(value.mobs),
              'an object with a mobs array',
              {mobs: []},
            ),
            fetchOptionalJson<BlockDropsFile>(
              versionExportUrl(`${base}/blockdrops.json`, datasetIdentity),
              (value): value is BlockDropsFile =>
                isRecord(value) && isRecord(value.blocks),
              'an object with a blocks map',
              {blocks: {}},
            ),
            previewManifestUrl
              ? fetchBoundedJson(previewManifestUrl).then(({value}) => {
                  const previewManifest = requireRecipePreviewManifest(value, datasetIdentity);
                  if (previewManifest.assetSetId !== descriptor.previewAssetSetId) {
                    throw new Error(
                      `Dataset ${JSON.stringify(descriptor.slug)} returned preview asset set ` +
                        `${JSON.stringify(previewManifest.assetSetId)}; expected ` +
                        `${JSON.stringify(descriptor.previewAssetSetId)}.`,
                    );
                  }
                  return previewManifest;
                })
              : Promise.resolve<RecipePreviewManifest | null>(null),
          ]);
        const itemsDescriptor = parseShardedDescriptor(itemsRoot.value, 'array', itemsUrl);
        const loadedItems = itemsDescriptor
          ? await loadArrayDescriptor<CatalogItem>(
              itemsDescriptor,
              itemsUrl,
              base,
              datasetIdentity,
            )
          : requireDocument<{items: CatalogItem[]}>(
              itemsRoot.value,
              itemsUrl,
              (value): value is {items: CatalogItem[]} =>
                isRecord(value) && Array.isArray(value.items),
              'a legacy object with an items array or a sharded-array descriptor',
            ).items;
        const {
          items,
          formattedNameCount,
          emptyNameFallbackCount,
        } = normalizeCatalogItemNames(loadedItems);
        if (formattedNameCount > 0) {
          console.info('Minecraft formatting codes were removed from item names.', {
            datasetIdentity,
            formattedNameCount,
          });
        }
        if (emptyNameFallbackCount > 0) {
          console.error(
            'Some item names contained only Minecraft formatting codes; registry ids are being shown instead.',
            {datasetIdentity, emptyNameFallbackCount},
          );
        }
        const categoriesDoc = requireDocument<{categories: Category[]}>(
          categoriesValue,
          categoriesUrl,
          (value): value is {categories: Category[]} =>
            isRecord(value) && Array.isArray(value.categories),
          'an object with a categories array',
        );
        const indexDescriptor = parseShardedDescriptor(indexRoot.value, 'object', indexUrl);
        const initialIndex = indexDescriptor
          ? {}
          : requireDocument<RecipeIndex>(
              indexRoot.value,
              indexUrl,
              (value): value is RecipeIndex => isRecord(value),
              'a legacy object keyed by exported ingredient key or a sharded-object descriptor',
            );
        if (structuredDataOnly) {
          requireStructuredDataOnlyCatalog(
            items,
            categoriesDoc.categories,
            mobsDoc.mobs,
            datasetIdentity,
          );
        }
        if (previewManifest) {
          if (previewManifest.counts.hostedOmittedWebpBytes !== undefined) {
            console.warn(
              'The active recipe-preview sidecar uses legacy omitted-WebP byte accounting. ' +
                'It remains readable only while the zero-downtime sidecar migration is staged.',
              {datasetIdentity, assetSetId: previewManifest.assetSetId},
            );
          }
          if (
            previewManifest.counts.categories !== categoriesDoc.categories.length ||
            previewManifest.counts.recipes !== manifest.counts.recipes ||
            previewManifest.counts.previews !== expectedExternalPreviewCount
          ) {
            throw new Error(
              'Recipe-preview sidecar counts do not match the core dataset publication.',
            );
          }
          const expectedItemIconPixels = 16 * manifest.settings.iconScale;
          if (
            !Number.isSafeInteger(expectedItemIconPixels) ||
            previewManifest.settings.itemIconPixels !== expectedItemIconPixels ||
            previewManifest.settings.recipeScale !== manifest.settings.recipeScale
          ) {
            throw new Error(
              'Recipe-preview sidecar render scales do not match the core dataset publication: ' +
                `expected itemIconPixels=${expectedItemIconPixels} and ` +
                `recipeScale=${manifest.settings.recipeScale}, received ` +
                `itemIconPixels=${previewManifest.settings.itemIconPixels} and ` +
                `recipeScale=${previewManifest.settings.recipeScale}.`,
            );
          }
        }
        // A publication can switch while the required documents are in flight. Re-read the
        // manifest only after they all resolve; a 409 or changed identity makes the entire load
        // fail rather than combining documents from two snapshots.
        const confirmedManifest = requireDocument<Manifest>(
          await fetchJson<unknown>(versionedManifestUrl, {cache: 'no-store'}),
          versionedManifestUrl,
          isManifestDocument,
          'a manifest object with a SHA-256 publicationId and required export metadata',
        );
        if (datasetIdentityFromManifest(confirmedManifest) !== datasetIdentity) {
          throw new Error(
            `Export dataset changed while loading dependent documents from ${base}; reload to obtain one coherent snapshot.`,
          );
        }
        if (!alive) return;

        if (items.length !== manifest.counts.items) {
          throw new Error(
            `Export items document contains ${items.length} entries; manifest declares ` +
              `${manifest.counts.items}.`,
          );
        }
        const mobs = supplementCustomDeathDrops(mobsDoc.mobs);
        const mobsWithoutSprites = mobs.filter(mob => !mob.icon).length;
        if (mobsWithoutSprites > 0) {
          const message = structuredDataOnly
            ? 'The structured-data-only mob catalog intentionally omits exported sprites; deterministic generated placeholders will be rendered.'
            : 'The loaded mob catalog contains entries without sprite URLs; deterministic generated placeholders will be rendered.';
          const detail = {datasetIdentity, missing: mobsWithoutSprites, total: mobs.length};
          if (structuredDataOnly) console.info(message, detail);
          else console.warn(message, detail);
        }
        const itemsByKey = new Map<string, CatalogItem>();
        const counts = new Map<string, number>();
        const absentItemIcons = new BoundedAbsentItemIconCollector();
        for (const i of items) {
          itemsByKey.set(i.k, i);
          counts.set(i.m, (counts.get(i.m) ?? 0) + 1);
          absentItemIcons.observe(i);
        }
        const absentItemIconSummary = absentItemIcons.summary();
        if (
          absentItemIconSummary &&
          absentItemIconSummaryDataset.current !== datasetIdentity
        ) {
          absentItemIconSummaryDataset.current = datasetIdentity;
          const detail = {datasetIdentity, ...absentItemIconSummary};
          if (structuredDataOnly) {
            console.info(
              'The structured-data-only item catalog intentionally omits exported icon URLs; ' +
                'deterministic generated placeholders will be rendered.',
              detail,
            );
          } else {
            console.warn(
              'The loaded item catalog contains entries without icon URLs; named fallbacks will be rendered.',
              detail,
            );
          }
        }
        const itemIconFailureReporter = new BoundedItemIconFailureReporter(datasetIdentity);
        const mods: ModInfo[] = [...counts.entries()]
          .map(([id, itemCount]) => ({id, name: manifest.mods?.[id] ?? id, itemCount}))
          .sort((a, b) => b.itemCount - a.itemCount);

        const blockDrops = blockDropsDoc.blocks ?? {};
        const capabilities = {
          mobs: mobs.length > 0,
          blockDrops: Object.keys(blockDrops).length > 0,
          recipePreviews:
            !structuredDataOnly &&
            (previewManifest !== null || manifest.web?.recipeImages?.mode !== 'omitted'),
        };
        if (!capabilities.mobs) {
          console.info('The loaded export has no mob catalog; mob browsing is disabled.');
        }
        if (!capabilities.blockDrops) {
          console.info('The loaded export has no block-drop catalog; mining-source data is unavailable.');
        }
        const droppedByMobs = new Map<string, {mob: Mob; stat: DropStat}[]>();
        for (const mob of mobs) {
          for (const stat of mob.drops ?? []) {
            const list = droppedByMobs.get(stat.k) ?? [];
            list.push({mob, stat});
            droppedByMobs.set(stat.k, list);
          }
        }
        for (const list of droppedByMobs.values()) list.sort((a, b) => b.stat.c - a.stat.c);
        const minedFrom = new Map<string, {blockKey: string; stat: DropStat}[]>();
        for (const [blockKey, entry] of Object.entries(blockDrops)) {
          for (const stat of [...entry.drops, ...(entry.silk ?? [])]) {
            if (stat.k === blockKey) continue; // block dropping itself isn't interesting as a source
            const list = minedFrom.get(stat.k) ?? [];
            list.push({blockKey, stat});
            minedFrom.set(stat.k, list);
          }
        }
        for (const list of minedFrom.values()) list.sort((a, b) => b.stat.c - a.stat.c);

        const categories = categoriesDoc.categories;
        const metaCategories = new Set<number>();
        const secondaryCategories = new Set<number>();
        const repairCategories = new Set<number>();
        categories.forEach((c, i) => {
          if (isMetaRecipeCategory(c)) {
            metaCategories.add(i);
          } else if (isSecondaryRecipeCategory(c)) {
            secondaryCategories.add(i);
            if (isRepairRecipeCategory(c)) {
              repairCategories.add(i);
            }
          }
        });

        const getRecipeDocument = (catIdx: number): Promise<RecipeDocument> => {
          let promise = recipeDocumentCache.current.get(catIdx);
          if (promise) return promise;

          const category = categories[catIdx];
          if (!category) {
            promise = Promise.reject(
              new Error(`Recipe index requested unknown category ${catIdx}.`),
            );
          } else if (!isNonnegativeSafeInteger(category.count)) {
            promise = Promise.reject(
              new Error(`Recipe category ${category.id} has an invalid declared count.`),
            );
          } else {
            const recipesUrl = versionExportUrl(
              `${base}/${category.dir}/recipes.json`,
              datasetIdentity,
            );
            promise = fetchBoundedJson(recipesUrl).then(async ({value, bytes}) => {
              const descriptor = parseShardedDescriptor(value, 'array', recipesUrl);
              if (descriptor) {
                if (descriptor.count !== category.count) {
                  throw new Error(
                    `Recipe descriptor ${recipesUrl} contains ${descriptor.count} entries; ` +
                      `category metadata declares ${category.count}.`,
                  );
                }
                return {kind: 'sharded', descriptor};
              }
              if (!Array.isArray(value)) {
                throw new Error(
                  `Invalid export document ${recipesUrl}: expected a legacy recipe array or ` +
                    `a sharded-array descriptor.`,
                );
              }
              const recipes = await applyLegacyRecipeStructures(
                requireRecipeArray(value, category.count, recipesUrl),
                datasetIdentity,
                category,
              );
              if (structuredDataOnly) {
                requireStructuredDataOnlyRecipes(recipes, recipesUrl);
              }
              const cacheKey = `${datasetIdentity}:inline:${category.dir}`;
              // Inline documents are the explicit small-document schema. Retain them in the same
              // bounded cache as shards so visiting many categories cannot accumulate every list.
              void recipePartCache.current.getOrLoad(
                cacheKey,
                bytes,
                () => Promise.resolve(recipes),
              );
              return {
                kind: 'inline',
                url: recipesUrl,
                cacheKey,
                bytes,
                count: category.count,
              };
            });
          }
          recipeDocumentCache.current.set(catIdx, promise);
          return promise;
        };

        const getCategoryRecipeSelection = async (
          catIdx: number,
          requestedIndices: ReadonlySet<number>,
        ): Promise<Map<number, Recipe>> => {
          const document = await getRecipeDocument(catIdx);
          const selected = new Map<number, Recipe>();
          if (document.kind === 'inline') {
            const recipes = await recipePartCache.current.getOrLoad(
              document.cacheKey,
              document.bytes,
              async () => {
                const {value} = await fetchBoundedJson(document.url, document.bytes);
                const recipes = requireRecipeArray(value, document.count, document.url);
                return structuredDataOnly
                  ? requireStructuredDataOnlyRecipes(recipes, document.url)
                  : recipes;
              },
            );
            for (const recipeIdx of requestedIndices) {
              const recipe = recipes[recipeIdx];
              if (!recipe) {
                throw new Error(
                  `Recipe reference ${catIdx}:${recipeIdx} is outside its inline document.`,
                );
              }
              selected.set(recipeIdx, recipe);
            }
            return selected;
          }

          const requestsByPath = new Map<
            string,
            {part: ShardedJsonPart; recipeIndices: number[]}
          >();
          for (const recipeIdx of requestedIndices) {
            const part = document.descriptor.parts.find(candidate => {
              const start = candidate.start!;
              return recipeIdx >= start && recipeIdx < start + candidate.count;
            });
            if (!part) {
              throw new Error(
                `Recipe reference ${catIdx}:${recipeIdx} is not covered by its shard descriptor.`,
              );
            }
            const request = requestsByPath.get(part.path) ?? {part, recipeIndices: []};
            request.recipeIndices.push(recipeIdx);
            requestsByPath.set(part.path, request);
          }

          await Promise.all(
            [...requestsByPath.values()].map(async ({part, recipeIndices}) => {
              const shardUrl = partUrl(base, part.path, datasetIdentity);
              const recipes = await recipePartCache.current.getOrLoad(
                `${datasetIdentity}:${part.path}`,
                part.bytes,
                async () => {
                  const {value} = await fetchBoundedJson(shardUrl, part.bytes);
                  if (
                    !Array.isArray(value) ||
                    value.length !== part.count ||
                    !value.every(isRecord)
                  ) {
                    throw new Error(
                      `Invalid recipe shard ${shardUrl}: expected ${part.count} recipe objects.`,
                    );
                  }
                  const recipes = value as unknown as Recipe[];
                  return structuredDataOnly
                    ? requireStructuredDataOnlyRecipes(recipes, shardUrl)
                    : recipes;
                },
              );
              for (const recipeIdx of recipeIndices) {
                const recipe = recipes[recipeIdx - part.start!];
                if (!recipe) {
                  throw new Error(
                    `Recipe shard ${shardUrl} omitted requested reference ` +
                      `${catIdx}:${recipeIdx}.`,
                  );
                }
                selected.set(recipeIdx, recipe);
              }
            }),
          );
          return selected;
        };

        const getPreviewCategoryDocument = (
          catIdx: number,
        ): Promise<RecipePreviewCategoryDocument> => {
          if (!previewBase || !previewManifest) {
            return Promise.reject(
              new Error('External recipe previews were requested without a validated sidecar.'),
            );
          }
          const category = categories[catIdx];
          if (!category) {
            return Promise.reject(
              new Error(`Recipe preview requested unknown category ${catIdx}.`),
            );
          }
          const path = `categories/${String(catIdx).padStart(3, '0')}.json`;
          const url = versionPreviewUrl(
            `${previewBase}/${path}`,
            datasetIdentity,
            previewManifest.assetSetId,
          );
          return previewCategoryCache.current.getOrLoad(
            `${datasetIdentity}:${path}`,
            PREVIEW_MAX_CATEGORY_BYTES,
            () => fetchBoundedJson(url).then(({value, bytes}) => {
              if (bytes > PREVIEW_MAX_CATEGORY_BYTES) {
                throw new Error(
                  `Recipe-preview category ${url} is ${bytes} bytes, above the ` +
                    `${PREVIEW_MAX_CATEGORY_BYTES}-byte sidecar contract.`,
                );
              }
              return requireRecipePreviewCategory(
                value,
                catIdx,
                category.id,
                category.count,
                url,
                previewManifest.packs,
              );
            }),
          );
        };

        const getPreviewPart = (
          path: string,
          start: number,
          count: number,
          bytes: number,
        ): Promise<RecipePreviewEntry[]> => {
          if (!previewBase || !previewManifest) {
            return Promise.reject(
              new Error('Recipe-preview metadata was requested without a validated sidecar.'),
            );
          }
          const cacheKey = `${datasetIdentity}:${path}`;
          const url = versionPreviewUrl(
            `${previewBase}/${path}`,
            datasetIdentity,
            previewManifest.assetSetId,
          );
          return previewPartCache.current.getOrLoad(cacheKey, bytes, () =>
            fetchBoundedJson(url, bytes)
              .then(({value}) =>
                requirePreviewEntries(value, count, url, previewManifest.packs),
              )
              .catch(error => {
                console.error('Required recipe-preview metadata shard failed.', {
                  path,
                  start,
                  count,
                  error,
                });
                throw error;
              }),
          );
        };

        const getCategoryPreviewSelection = async (
          catIdx: number,
          requestedIndices: ReadonlySet<number>,
        ): Promise<Map<number, RecipePreviewEntry>> => {
          const document = await getPreviewCategoryDocument(catIdx);
          return selectRecipePreviewEntries(
            document,
            requestedIndices,
            part => getPreviewPart(part.path, part.start, part.count, part.bytes),
          );
        };

        const loadRecipeBatch = async (refs: readonly RecipeRef[]): Promise<Recipe[]> => {
          const indicesByCategory = new Map<number, Set<number>>();
          for (const ref of refs) {
            if (
              !Array.isArray(ref) ||
              ref.length !== 2 ||
              !isNonnegativeSafeInteger(ref[0]) ||
              !isNonnegativeSafeInteger(ref[1])
            ) {
              throw new Error(`Recipe access received a malformed reference: ${String(ref)}.`);
            }
            const category = categories[ref[0]];
            if (!category || !isNonnegativeSafeInteger(category.count) || ref[1] >= category.count) {
              throw new Error(`Recipe access received an out-of-range reference ${ref[0]}:${ref[1]}.`);
            }
            const indices = indicesByCategory.get(ref[0]) ?? new Set<number>();
            indices.add(ref[1]);
            indicesByCategory.set(ref[0], indices);
          }

          const [recipeSelections, previewSelections] = await Promise.all([
            Promise.all(
              [...indicesByCategory.entries()].map(async ([catIdx, indices]) => [
                catIdx,
                await getCategoryRecipeSelection(catIdx, indices),
              ] as const),
            ),
            previewManifest
              ? Promise.all(
                  [...indicesByCategory.entries()].map(async ([catIdx, indices]) => [
                    catIdx,
                    await getCategoryPreviewSelection(catIdx, indices),
                  ] as const),
                )
              : Promise.resolve(null),
          ]);
          const selectedByCategory = new Map<number, Map<number, Recipe>>(recipeSelections);
          const previewsByCategory = previewSelections
            ? new Map<number, Map<number, RecipePreviewEntry>>(previewSelections)
            : null;
          return refs.map(([catIdx, recipeIdx]) => {
            const selectedRecipe = selectedByCategory.get(catIdx)?.get(recipeIdx);
            if (!selectedRecipe) {
              throw new Error(`Recipe access did not resolve reference ${catIdx}:${recipeIdx}.`);
            }
            const recipe = promoteReturnedRecipeIngredients(
              reconstructLegacyReplaceableInputs(
                applyRecipeStageMetadata(selectedRecipe, descriptor),
                categories[catIdx],
                descriptor.minecraftVersion,
                itemsByKey,
              ),
            );
            if (previewsByCategory) {
              if (!previewsByCategory.get(catIdx)?.has(recipeIdx)) {
                throw new Error(
                  `Recipe-preview access did not resolve reference ${catIdx}:${recipeIdx}.`,
                );
              }
              if (recipe.img) {
                throw new Error(
                  `Core recipe ${catIdx}:${recipeIdx} unexpectedly contains an image while its ` +
                    'external preview sidecar is active.',
                );
              }
              const preview = previewsByCategory.get(catIdx)!.get(recipeIdx)!;
              if (preview) {
                return {
                  ...recipe,
                  img: recipePreviewImagePath(preview),
                  w: preview[3],
                  h: preview[4],
                };
              }
              const missingKey = `${catIdx}:${recipeIdx}`;
              if (!missingPreviewDiagnostics.current.has(missingKey)) {
                missingPreviewDiagnostics.current.add(missingKey);
                console.error(
                  'JEI layout preview is unavailable because the exporter did not produce one; ' +
                    'the structured recipe remains visible.',
                  {categoryIndex: catIdx, recipeIndex: recipeIdx, recipeId: recipe.id},
                );
              }
            }
            return recipe;
          });
        };

        const getRecipes = async (refs: readonly RecipeRef[]): Promise<Recipe[]> => {
          const resolved = new Array<Recipe>(refs.length);
          const missingByKey = new Map<string, {ref: RecipeRef; positions: number[]}>();
          refs.forEach((ref, position) => {
            const cached = recipeSessionCache.current.get(ref);
            if (cached) {
              resolved[position] = cached;
              return;
            }
            const key = recipeSessionCacheKey(ref);
            const missing = missingByKey.get(key) ?? {ref, positions: []};
            missing.positions.push(position);
            missingByKey.set(key, missing);
          });

          const missing = [...missingByKey.values()];
          if (missing.length > 0) {
            const loaded = await loadRecipeBatch(missing.map(entry => entry.ref));
            missing.forEach((entry, index) => {
              const recipe = loaded[index];
              recipeSessionCache.current.set(entry.ref, recipe);
              entry.positions.forEach(position => {
                resolved[position] = recipe;
              });
            });
          }
          return resolved;
        };

        let loadedIndex: RecipeIndex | null = indexDescriptor ? null : initialIndex;
        const ensureIndex = (): Promise<void> => {
          if (loadedIndex) return Promise.resolve();
          if (indexLoadPromise.current) return indexLoadPromise.current;
          if (!indexDescriptor) {
            const error = new Error('Reverse-index loader has no descriptor for the active dataset.');
            console.error(error.message, {datasetIdentity});
            return Promise.reject(error);
          }

          setState(previous =>
            previous.status === 'ready' && previous.data.datasetIdentity === datasetIdentity
              ? {
                  status: 'ready',
                  data: {...previous.data, indexStatus: 'loading', indexError: null},
                }
              : previous,
          );
          const pending = (async () => {
            const nextIndex = await loadObjectDescriptor<RecipeIndex[string]>(
              indexDescriptor,
              indexUrl,
              base,
              datasetIdentity,
            );
            const confirmedManifest = requireDocument<Manifest>(
              await fetchJson<unknown>(versionedManifestUrl, {cache: 'no-store'}),
              versionedManifestUrl,
              isManifestDocument,
              'a manifest object with a SHA-256 publicationId and required export metadata',
            );
            if (datasetIdentityFromManifest(confirmedManifest) !== datasetIdentity) {
              throw new Error('Dataset identity changed while loading reverse-index shards.');
            }
            loadedIndex = nextIndex;
            if (alive) {
              setState(previous =>
                previous.status === 'ready' && previous.data.datasetIdentity === datasetIdentity
                  ? {
                      status: 'ready',
                      data: {
                        ...previous.data,
                        index: nextIndex,
                        indexStatus: 'ready',
                        indexError: null,
                      },
                    }
                  : previous,
              );
            }
          })()
            .catch(error => {
              console.error('Required reverse-index shards could not be loaded.', {
                datasetIdentity,
                error,
              });
              if (alive) {
                const message = String(error instanceof Error ? error.message : error);
                setState(previous =>
                  previous.status === 'ready' && previous.data.datasetIdentity === datasetIdentity
                    ? {
                        status: 'ready',
                        data: {...previous.data, indexStatus: 'error', indexError: message},
                      }
                    : previous,
                );
              }
              throw error;
            })
            .finally(() => {
              if (!loadedIndex) indexLoadPromise.current = null;
            });
          indexLoadPromise.current = pending;
          return pending;
        };

        const data: Data = {
          descriptor,
          base,
          datasetIdentity,
          manifest,
          items,
          itemsByKey,
          categories,
          mobs,
          index: initialIndex,
          indexStatus: indexDescriptor ? 'idle' : 'ready',
          indexError: null,
          ensureIndex,
          mods,
          blockDrops,
          droppedByMobs,
          minedFrom,
          capabilities,
          metaCategories,
          secondaryCategories,
          repairCategories,
          imageUrl: rel => {
            if (!rel) return undefined;
            if (structuredDataOnly) {
              const error = new Error(
                `${GTNH_STRUCTURED_DATA_ONLY_POLICY} refused exported visual reference ${rel}.`,
              );
              console.error(error.message, {datasetIdentity});
              throw error;
            }
            if (isCanonicalRecipePreviewImagePath(rel)) {
              if (!previewBase || !previewManifest) {
                const error = new Error(
                  'A recipe-preview coordinate was resolved without a validated preview sidecar.',
                );
                console.error(error.message);
                throw error;
              }
              return previewAssetUrl(
                rel,
                datasetIdentity,
                previewManifest.assetSetId,
                previewBase,
              );
            }
            if (
              !isSafeRootImagePath(rel) ||
              (manifest.web !== undefined && !isCanonicalPackedImagePath(rel))
            ) {
              const error = new Error(`Export image path is malformed for this publication: ${rel}`);
              console.error(error.message);
              throw error;
            }
            return localDatasetVisualUri(
              versionExportUrl(`${base}/${rel}`, datasetIdentity),
            );
          },
          reportItemIconFailure: failure => itemIconFailureReporter.report(failure),
          getCachedRecipe: ref => recipeSessionCache.current.peek(ref),
          getRecipes: refs =>
            getRecipes(refs).catch(error => {
              console.error('Required recipe references could not be loaded.', {
                referenceCount: refs.length,
                references: refs.slice(0, 40),
                error,
              });
              if (alive) setState(exportLoadErrorState(error, base));
              throw error;
            }),
        };
        setState({status: 'ready', data});
      } catch (e) {
        if (alive) setState(exportLoadErrorState(e, base));
      }
    })();
    return () => {
      alive = false;
    };
  }, [base, configuredPreviewBase, descriptor, descriptor.previewAssetSetId, descriptor.publicationId]);

  return <DataContext.Provider value={state}>{children}</DataContext.Provider>;
}

export function useLoadState(): LoadState {
  return useContext(DataContext);
}

/** Only call from components rendered after loading succeeded. */
export function useData(): Data {
  const s = useContext(DataContext);
  if (s.status !== 'ready') throw new Error('Data not ready');
  return s.data;
}
