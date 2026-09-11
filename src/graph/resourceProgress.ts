import type {DatasetDescriptor} from '../data/datasetCatalog';

/**
 * Which resources the user has already gathered, so the list doubles as a checklist for actually
 * building the thing. Scoped to the pack and the tree's root item: the same item is a different
 * job in a different pack, and ticking iron off for one build should not tick it off for another.
 *
 * A tick records a place in the tree, by node id, rather than an item: two recipes needing the same
 * thing are two separate errands, and one tick cannot answer for both. Node ids come from the tree's
 * shape, and the pack's publication id is already part of the key, so they mean the same thing on
 * the next launch as they did on this one.
 */
/**
 * Version 2 keys record node ids. Version 1 recorded item identities, which cannot be translated:
 * one identity stood for however many places in the tree wanted that item, and there is no way to
 * tell from it which of them were actually gathered. Guessing would either tick branches nobody
 * touched or silently claim progress, so a version 1 checklist is dropped rather than mistranslated.
 */
export function resourceProgressKey(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
): string {
  return `resourceProgress:2:${descriptor.slug}:${descriptor.publicationId}:${rootKey}`;
}

function legacyResourceProgressKey(
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
    const storage = globalThis.localStorage;
    const raw = storage?.getItem(resourceProgressKey(descriptor, rootKey));
    // A version 1 checklist cannot be carried forward, so it is cleared rather than left behind to
    // sit in storage forever.
    storage?.removeItem(legacyResourceProgressKey(descriptor, rootKey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) {
      throw new Error('Stored resource progress is not a list of node ids.');
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

/**
 * Ticking a section ticks everything under it in one go, so the checklist takes a set rather than
 * one key at a time -- a hundred separate writes would also mean a hundred renders and a hundred
 * saves on the way to the same state.
 */
export function withResourcesCompleted(
  completed: ReadonlySet<string>,
  nodeIds: readonly string[],
  done: boolean,
): Set<string> {
  const next = new Set(completed);
  for (const nodeId of nodeIds) {
    if (done) next.add(nodeId);
    else next.delete(nodeId);
  }
  return next;
}

/**
 * Progress is measured against every gatherable thing the tree needs, which is what a tick records.
 * The flat totals cannot serve: a folded branch appears in them as itself rather than as what it
 * holds, so folding one would drop the ticks inside it and read as no progress at all.
 */
export function gatheredPercentage(
  gatherable: readonly string[],
  completed: ReadonlySet<string>,
): number {
  if (gatherable.length === 0) return 0;
  const done = gatherable.reduce(
    (total, nodeId) => total + (completed.has(nodeId) ? 1 : 0),
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
  for (const nodeId of completed) {
    if (live.has(nodeId)) counted.add(nodeId);
  }
  return counted.size === completed.size ? completed : counted;
}
