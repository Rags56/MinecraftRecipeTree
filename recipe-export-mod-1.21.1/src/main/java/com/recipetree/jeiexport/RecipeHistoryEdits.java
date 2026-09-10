package com.recipetree.jeiexport;

import java.util.List;

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
        if (currentIndex + 1 < entries.size()) {
            entries.subList(currentIndex + 1, entries.size()).clear();
        }
        if (preserveCurrentSnapshot) {
            entries.add(editedEntry);
            return entries.size() - 1;
        }
        entries.set(currentIndex, editedEntry);
        return currentIndex;
    }
}
