import type {DatasetDescriptor} from '../data/datasetCatalog';
import {treeTotalIdentity} from './treeTotals.ts';

/**
 * Which items the user keeps on the catalysts and tools list. Nothing is put there automatically:
 * a pack marking an item as kept by its recipe says how the craft behaves, not how a person wants
 * to shop for it, and some people would rather see a hammer or a machine on the materials list with
 * everything else. So the two lists start with everything on the materials side, and an item moves
 * only when the user moves it.
 *
 * This decides which list an item is shown on and nothing else. The tree's own idea of what a
 * recipe consumes is untouched, so amounts, byproducts and the graph are exactly as they were.
 *
 * Held per pack rather than per tree: a tool is a tool in every build in that pack. Keyed by
 * logical item identity, so a tag requirement and a concrete one are separate choices, and every
 * place in the tree that asks for the item follows the one the user made.
 */
export function catalystItemsKey(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
): string {
  return `resourceCatalysts:${descriptor.slug}:${descriptor.publicationId}`;
}

export function catalystItemIdentity(item: {
  key: string;
  tag?: string;
  variantCount?: number;
}): string {
  return treeTotalIdentity({key: item.key, tag: item.tag, variants: item.variantCount ?? 1});
}

export function loadCatalystItems(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(catalystItemsKey(descriptor));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) {
      throw new Error('Stored catalyst items are not a list of item identities.');
    }
    return new Set(parsed as string[]);
  } catch (error) {
    console.error('The catalyst list could not be loaded from localStorage.', error);
    return new Set();
  }
}

export function persistCatalystItems(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  catalysts: ReadonlySet<string>,
): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const key = catalystItemsKey(descriptor);
    // Nothing moved is the absence of a list, not a stored empty one.
    if (catalysts.size === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify([...catalysts]));
  } catch (error) {
    console.error('The catalyst list could not be saved to localStorage.', error);
  }
}

export function withCatalystItem(
  catalysts: ReadonlySet<string>,
  identity: string,
  isCatalyst: boolean,
): Set<string> {
  const next = new Set(catalysts);
  if (isCatalyst) next.add(identity);
  else next.delete(identity);
  return next;
}
