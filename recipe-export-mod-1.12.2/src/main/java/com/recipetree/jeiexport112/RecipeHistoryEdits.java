package com.recipetree.jeiexport112;

import java.util.List;

/** Pure history mutation policy shared by the planner screen and unit tests. */
final class RecipeHistoryEdits {
    private RecipeHistoryEdits() {
    }

    static <T> int commit(
            List<T> entries,
            int currentIndex,
            T editedEntry,
            boolean preserveCurrentSnapshot) {
        if (currentIndex < 0 || currentIndex >= entries.size()) {
            entries.add(editedEntry);
            return entries.size() - 1;
        }
        if (preserveCurrentSnapshot) {
            entries.add(currentIndex + 1, editedEntry);
            return currentIndex + 1;
        }
        entries.set(currentIndex, editedEntry);
        return currentIndex;
    }

    /**
     * Saves the selected state as an immutable version and leaves an identical working version
     * selected. Subsequent edits replace only that working version, so a snapshot immediately
     * creates a useful two-version history without retaining the old unsaved duplicate.
     */
    static <T> int saveSnapshot(
            List<T> entries,
            int currentIndex,
            T savedEntry,
            T workingEntry) {
        if (currentIndex < 0 || currentIndex >= entries.size()) {
            entries.add(savedEntry);
        } else {
            if (currentIndex + 1 < entries.size()) {
                entries.subList(currentIndex + 1, entries.size()).clear();
            }
            entries.set(currentIndex, savedEntry);
        }
        entries.add(workingEntry);
        return entries.size() - 1;
    }

    /** Removes exactly one history entry and keeps the current selection aligned. */
    static <T> int delete(List<T> entries, int currentIndex, int deletedIndex) {
        if (deletedIndex < 0 || deletedIndex >= entries.size()) return currentIndex;
        entries.remove(deletedIndex);
        if (currentIndex == deletedIndex) return -1;
        return currentIndex > deletedIndex ? currentIndex - 1 : currentIndex;
    }
}
