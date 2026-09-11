import {useCallback, useEffect, useState} from 'react';
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

/**
 * The tree and the resources list both read and write this, so they cannot disagree about what the
 * user has called a tool. Storage alone is not enough for that: two screens that each loaded the
 * list once would each keep their own copy, and a change in one would not show in the other until
 * something remounted. So writes go through here and every reader is told.
 */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeCatalystItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCatalystItem(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  identity: string,
  isCatalyst: boolean,
): ReadonlySet<string> {
  const next = withCatalystItem(loadCatalystItems(descriptor), identity, isCatalyst);
  persistCatalystItems(descriptor, next);
  notify();
  return next;
}

/** The live list for a pack, and the one way to change it. */
export function useCatalystItems(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
): {
  catalysts: ReadonlySet<string>;
  isCatalyst: (item: {key: string; tag?: string; variantCount?: number}) => boolean;
  setCatalyst: (item: {key: string; tag?: string; variantCount?: number}, isCatalyst: boolean) => void;
} {
  const key = catalystItemsKey(descriptor);
  const [catalysts, setCatalysts] = useState<ReadonlySet<string>>(() =>
    loadCatalystItems(descriptor),
  );
  useEffect(() => {
    setCatalysts(loadCatalystItems(descriptor));
    return subscribeCatalystItems(() => setCatalysts(loadCatalystItems(descriptor)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the descriptor's identity.
  }, [key]);
  const isCatalyst = useCallback(
    (item: {key: string; tag?: string; variantCount?: number}) =>
      catalysts.has(catalystItemIdentity(item)),
    [catalysts],
  );
  const setCatalyst = useCallback(
    (item: {key: string; tag?: string; variantCount?: number}, isCatalystNext: boolean) => {
      setCatalysts(setCatalystItem(descriptor, catalystItemIdentity(item), isCatalystNext));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the descriptor's identity.
    [key],
  );
  return {catalysts, isCatalyst, setCatalyst};
}
