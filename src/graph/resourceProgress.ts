import type {DatasetDescriptor} from '../data/datasetCatalog';
import type {TreeTotal} from './treeTotals';

/**
 * Which resources the user has already gathered, so the list doubles as a checklist for actually
 * building the thing. Scoped to the pack and the tree's root item: the same item is a different
 * job in a different pack, and ticking iron off for one build should not tick it off for another.
 */
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
 * Counted per resource rather than per item, so one stack of cobblestone does not outweigh every
 * other line on the list. Resources that have since left the tree do not count towards it.
 */
export function resourceCompletionPercentage(
  resources: readonly TreeTotal[],
  completed: ReadonlySet<string>,
): number {
  if (resources.length === 0) return 0;
  const done = resources.reduce(
    (total, resource) => total + (completed.has(resource.key) ? 1 : 0),
    0,
  );
  return Math.round((done / resources.length) * 100);
}

/** Drops ticks for resources the tree no longer needs, so the percentage cannot exceed its list. */
export function prunedCompletedResources(
  resources: readonly TreeTotal[],
  completed: ReadonlySet<string>,
): ReadonlySet<string> {
  if (completed.size === 0) return completed;
  const live = new Set(resources.map(resource => resource.key));
  const pruned = new Set<string>();
  for (const key of completed) {
    if (live.has(key)) pruned.add(key);
  }
  return pruned.size === completed.size ? completed : pruned;
}
