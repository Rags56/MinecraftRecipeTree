import {useCallback, useEffect, useState} from 'react';
import type {DatasetDescriptor} from '../data/datasetCatalog';

/**
 * Which places in the tree the user has called a tool or a catalyst. Nothing is put there
 * automatically: a pack marking an item as kept by its recipe says how the craft behaves, not how a
 * person wants to shop for it, and some people would rather see a hammer or a machine among the
 * materials. So a tree starts with everything counted as a material, and an item becomes a tool only
 * when the user says so.
 *
 * Recorded by node id -- the one place picked, not every place that asks for the same item. Two
 * recipes wanting the same hammer are two separate decisions, exactly as they are two separate
 * errands for the checklist, and marking one is not an opinion about the other.
 *
 * Node ids come from the tree's shape and the pack's publication id is part of the key, so a mark
 * means the same thing on the next launch as it did on this one.
 */
export function catalystItemsKey(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
): string {
  return `resourceCatalysts:2:${descriptor.slug}:${descriptor.publicationId}:${rootKey}`;
}

export function loadCatalystItems(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
): ReadonlySet<string> {
  try {
    const storage = globalThis.localStorage;
    const raw = storage?.getItem(catalystItemsKey(descriptor, rootKey));
    // Version 1 recorded item identities, which stood for however many places in the tree wanted
    // that item; nothing in one says which of them the user actually meant, so it is cleared rather
    // than spread over places that were never picked.
    storage?.removeItem(`resourceCatalysts:${descriptor.slug}:${descriptor.publicationId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.some(entry => typeof entry !== 'string')) {
      throw new Error('Stored catalysts are not a list of node ids.');
    }
    return new Set(parsed as string[]);
  } catch (error) {
    console.error('The catalyst list could not be loaded from localStorage.', error);
    return new Set();
  }
}

export function persistCatalystItems(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string,
  catalysts: ReadonlySet<string>,
): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const key = catalystItemsKey(descriptor, rootKey);
    // Nothing marked is the absence of a list, not a stored empty one.
    if (catalysts.size === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify([...catalysts]));
  } catch (error) {
    console.error('The catalyst list could not be saved to localStorage.', error);
  }
}

export function withCatalystItem(
  catalysts: ReadonlySet<string>,
  nodeId: string,
  isCatalyst: boolean,
): Set<string> {
  const next = new Set(catalysts);
  if (isCatalyst) next.add(nodeId);
  else next.delete(nodeId);
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
  rootKey: string,
  nodeId: string,
  isCatalyst: boolean,
): ReadonlySet<string> {
  const next = withCatalystItem(loadCatalystItems(descriptor, rootKey), nodeId, isCatalyst);
  persistCatalystItems(descriptor, rootKey, next);
  notify();
  return next;
}

/** The live list for a tree, and the one way to change it. */
export function useCatalystItems(
  descriptor: Pick<DatasetDescriptor, 'slug' | 'publicationId'>,
  rootKey: string | null,
): {
  catalysts: ReadonlySet<string>;
  isCatalyst: (node: {id: string}) => boolean;
  setCatalyst: (node: {id: string}, isCatalyst: boolean) => void;
} {
  const key = rootKey === null ? null : catalystItemsKey(descriptor, rootKey);
  const [catalysts, setCatalysts] = useState<ReadonlySet<string>>(() =>
    rootKey === null ? new Set() : loadCatalystItems(descriptor, rootKey),
  );
  useEffect(() => {
    if (rootKey === null) {
      setCatalysts(new Set());
      return undefined;
    }
    const read = () => setCatalysts(loadCatalystItems(descriptor, rootKey));
    read();
    return subscribeCatalystItems(read);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the tree's identity.
  }, [key]);
  const isCatalyst = useCallback(
    (node: {id: string}) => catalysts.has(node.id),
    [catalysts],
  );
  const setCatalyst = useCallback(
    (node: {id: string}, isCatalystNext: boolean) => {
      if (rootKey === null) return;
      setCatalysts(setCatalystItem(descriptor, rootKey, node.id, isCatalystNext));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the tree's identity.
    [key],
  );
  return {catalysts, isCatalyst, setCatalyst};
}
