import type {DatasetDescriptor} from '../data/datasetCatalog';
import {treeTotalIdentity, type TreeTotal} from './treeTotals.ts';

/**
 * Which resources the user has already gathered, so the list doubles as a checklist for actually
 * building the thing. Scoped to the pack and the tree's root item: the same item is a different
 * job in a different pack, and ticking iron off for one build should not tick it off for another.
 */
/**
 * Totals are grouped by logical identity, not by item key: a recipe asking for any iron ingot and
 * one asking for that exact ingot are different requirements that happen to share a key. Ticking
 * one must not tick the other, and two rows must not collide as the same list entry.
 */
export function resourceIdentity(resource: TreeTotal): string {
  return treeTotalIdentity(resource);
}

export function resourceProgressKey(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
): string {
  return `resourceProgress:${descriptor.slug}:${descriptor.publicationId}:${rootKey}`;
}

export function loadCompletedResources(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(resourceProgressKey(descriptor, rootKey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) {
      throw new Error('Stored resource progress is not a list of item keys.');
    }
    return new Set(parsed as string[]);
  } catch (error) {
    console.error('Resource progress could not be loaded from localStorage.', error);
    return new Set();
  }
}

export function persistCompletedResources(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
  completed: ReadonlySet<string>,
): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const key = resourceProgressKey(descriptor, rootKey);
    // An empty checklist is the absence of one, not a stored empty list.
    if (completed.size === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify([...completed]));
  } catch (error) {
    console.error('Resource progress could not be saved to localStorage.', error);
  }
}

export function toggleCompletedResource(
  completed: ReadonlySet<string>,
  itemKey: string,
): Set<string> {
  const next = new Set(completed);
  if (!next.delete(itemKey)) next.add(itemKey);
  return next;
}




/**
 * Ticking a section ticks everything under it in one go, so the checklist takes a set rather than
 * one key at a time -- a hundred separate writes would also mean a hundred renders and a hundred
 * saves on the way to the same state.
 */
export function withResourcesCompleted(
  completed: ReadonlySet<string>,
  identities: readonly string[],
  done: boolean,
): Set<string> {
  const next = new Set(completed);
  for (const identity of identities) {
    if (done) next.add(identity);
    else next.delete(identity);
  }
  return next;
}

/**
 * Progress is measured against every gatherable thing the tree needs, which is what a tick records.
 * The flat totals cannot serve: a folded branch appears in them as itself rather than as what it
 * holds, so folding one would drop the ticks inside it and read as no progress at all.
 */
export function identityCompletionPercentage(
  gatherable: readonly string[],
  completed: ReadonlySet<string>,
): number {
  if (gatherable.length === 0) return 0;
  const done = gatherable.reduce(
    (total, identity) => total + (completed.has(identity) ? 1 : 0),
    0,
  );
  return Math.round((done / gatherable.length) * 100);
}

/** Ticks for things the tree no longer needs are kept in storage but cannot be counted. */
export function countableCompleted(
  gatherable: readonly string[],
  completed: ReadonlySet<string>,
): ReadonlySet<string> {
  if (completed.size === 0) return completed;
  const live = new Set(gatherable);
  const counted = new Set<string>();
  for (const identity of completed) {
    if (live.has(identity)) counted.add(identity);
  }
  return counted.size === completed.size ? completed : counted;
}
