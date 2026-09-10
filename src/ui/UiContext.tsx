import React, {createContext, useCallback, useContext, useMemo, useRef, useState} from 'react';
import {Platform} from 'react-native';
import {RecipeRef} from '../types';
import type {GraphDirection} from '../graph/direction';

export type Tab = 'items' | 'graph' | 'mobs' | 'settings';

/** One independently interactive recipe tree; every field here is exclusive to this tree. */
export interface OpenGraphTree {
  id: number;
  rootKey: string;
  /** Exact recipe requested from an item-detail recipe card, for this tree only. */
  recipeRef: RecipeRef | null;
  direction: GraphDirection;
  /** Bumped to force this tree's own remount (e.g. a direction change) without touching others. */
  requestId: number;
}

/** Open trees beyond this are closed oldest-first; each holds a full, independent tree in memory. */
export const MAX_OPEN_GRAPH_TREES = 12;

function loadAnimateMobs(): boolean {
  try {
    return globalThis.localStorage?.getItem('animateMobs') !== '0';
  } catch {
    return true;
  }
}

const ACTIVE_TAB_KEY = 'activeTab';

function isTab(value: unknown): value is Tab {
  return (
    value === 'items' || value === 'graph' || value === 'mobs' || value === 'settings'
  );
}

function loadActiveTab(): Tab | null {
  try {
    const saved = globalThis.localStorage?.getItem(ACTIVE_TAB_KEY);
    return isTab(saved) ? saved : null;
  } catch (error) {
    console.error('The last active tab could not be loaded from localStorage.', error);
    return null;
  }
}

interface Ui {
  tab: Tab;
  setTab(t: Tab): void;
  /** True when this launch resumed the user's last tab, which nothing else may override. */
  restoredLastTab: boolean;
  /** Item-detail modal stack (navigating between items keeps history). */
  itemStack: string[];
  openItem(key: string): void;
  popItem(): void;
  closeItems(): void;
  /** Every currently open, independently interactive recipe tree, oldest first. */
  openGraphTrees: OpenGraphTree[];
  /** Which open tree is focused; new trees and direction changes target this one. */
  activeGraphTreeId: number | null;
  setActiveGraphTree(id: number): void;
  closeGraphTree(id: number): void;
  /** Opens a new tree (appended after the active one) without replacing what's already open. */
  openRecipeInGraph(key: string, ref: RecipeRef, direction?: GraphDirection): void;
  /** Forgets the recipe a tree was opened with, so clearing it can't be undone by a remount. */
  clearGraphTreeRecipe(id: number): void;
  /** Hydrates a saved graph as the one open tree, without changing the user's active workspace tab. */
  restoreGraph(key: string, direction: GraphDirection): void;
  changeGraphDirection(id: number, direction: GraphDirection): void;
  /** Mob sprite animation on/off (persisted). */
  animateMobs: boolean;
  toggleAnimateMobs(): void;
}

const UiContext = createContext<Ui | null>(null);

export function UiProvider({children}: {children: React.ReactNode}) {
  const restoredTabRef = useRef(loadActiveTab());
  const [tab, setTabState] = useState<Tab>(restoredTabRef.current ?? 'items');
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try {
      globalThis.localStorage?.setItem(ACTIVE_TAB_KEY, next);
    } catch (error) {
      console.error('The active tab could not be saved to localStorage.', error);
    }
  }, []);
  const [itemStack, setItemStack] = useState<string[]>([]);
  const [openGraphTrees, setOpenGraphTrees] = useState<OpenGraphTree[]>([]);
  const [activeGraphTreeId, setActiveGraphTreeId] = useState<number | null>(null);
  const nextGraphTreeIdRef = useRef(0);
  const [animateMobs, setAnimateMobs] = useState<boolean>(loadAnimateMobs);

  const toggleAnimateMobs = useCallback(() => {
    setAnimateMobs(v => {
      try {
        globalThis.localStorage?.setItem('animateMobs', v ? '0' : '1');
      } catch {
        // no persistence available (native) — in-memory only
      }
      return !v;
    });
  }, []);

  const openItem = useCallback((key: string) => {
    setItemStack(s => (s[s.length - 1] === key ? s : [...s, key]));
  }, []);
  const popItem = useCallback(() => setItemStack(s => s.slice(0, -1)), []);
  const closeItems = useCallback(() => setItemStack([]), []);
  const openRecipeInGraph = useCallback((
    key: string,
    ref: RecipeRef,
    direction: GraphDirection = 'inputs',
  ) => {
    // Native panes stay mounted behind the bottom tabs. Preserve the current
    // item and its resolved recipe cards so returning to Browse is immediate.
    if (Platform.OS === 'web') setItemStack([]);
    const id = nextGraphTreeIdRef.current;
    nextGraphTreeIdRef.current += 1;
    const entry: OpenGraphTree = {id, rootKey: key, recipeRef: ref, direction, requestId: 0};
    setOpenGraphTrees(trees => {
      // Balanced left/right: the first tree stays near the middle as later ones alternate onto
      // either edge, rather than every new tree just queuing up on one side.
      const next = id % 2 === 0 ? [...trees, entry] : [entry, ...trees];
      if (next.length <= MAX_OPEN_GRAPH_TREES) return next;
      // Oldest-first eviction (by id, since array position is now spatial, not chronological).
      const oldest = next.reduce((min, tree) => (tree.id < min.id ? tree : min));
      return next.filter(tree => tree.id !== oldest.id);
    });
    setActiveGraphTreeId(id);
    setTab('graph');
  }, []);
  const restoreGraph = useCallback((key: string, direction: GraphDirection) => {
    const id = nextGraphTreeIdRef.current;
    nextGraphTreeIdRef.current += 1;
    setOpenGraphTrees([{id, rootKey: key, recipeRef: null, direction, requestId: 0}]);
    setActiveGraphTreeId(id);
  }, []);
  const setActiveGraphTree = useCallback((id: number) => {
    setActiveGraphTreeId(id);
  }, []);
  const clearGraphTreeRecipe = useCallback((id: number) => {
    setOpenGraphTrees(trees =>
      trees.map(tree => (tree.id === id ? {...tree, recipeRef: null} : tree)),
    );
  }, []);
  const closeGraphTree = useCallback((id: number) => {
    setOpenGraphTrees(trees => {
      const next = trees.filter(tree => tree.id !== id);
      setActiveGraphTreeId(current => {
        if (current !== id) return current;
        const closedIndex = trees.findIndex(tree => tree.id === id);
        return next[Math.min(closedIndex, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);
  const changeGraphDirection = useCallback((id: number, direction: GraphDirection) => {
    setOpenGraphTrees(trees =>
      trees.map(tree =>
        tree.id === id
          ? {...tree, recipeRef: null, direction, requestId: tree.requestId + 1}
          : tree,
      ),
    );
  }, []);

  const value = useMemo<Ui>(
    () => ({
      tab,
      setTab,
      restoredLastTab: restoredTabRef.current !== null,
      itemStack,
      openItem,
      popItem,
      closeItems,
      openGraphTrees,
      activeGraphTreeId,
      setActiveGraphTree,
      closeGraphTree,
      openRecipeInGraph,
      clearGraphTreeRecipe,
      restoreGraph,
      changeGraphDirection,
      animateMobs,
      toggleAnimateMobs,
    }),
    [
      tab,
      setTab,
      itemStack,
      openGraphTrees,
      activeGraphTreeId,
      setActiveGraphTree,
      closeGraphTree,
      clearGraphTreeRecipe,
      changeGraphDirection,
      animateMobs,
      openItem,
      popItem,
      closeItems,
      openRecipeInGraph,
      restoreGraph,
      toggleAnimateMobs,
    ],
  );
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('UiProvider missing');
  return ui;
}
