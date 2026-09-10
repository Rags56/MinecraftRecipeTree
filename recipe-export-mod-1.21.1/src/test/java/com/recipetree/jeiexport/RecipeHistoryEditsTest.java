package com.recipetree.jeiexport;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class RecipeHistoryEditsTest {
    @Test
    void ordinaryEditsReplaceTheCurrentHistoryEntry() {
        List<String> history = new ArrayList<>(List.of("tree before edit"));

        int selected = RecipeHistoryEdits.commit(
                history, 0, "tree after edit", false);

        assertEquals(List.of("tree after edit"), history);
        assertEquals(0, selected);
    }

    @Test
    void editingASnapshotPreservesItAndCreatesOneWorkingEntry() {
        List<String> history = new ArrayList<>(List.of("saved snapshot"));

        int selected = RecipeHistoryEdits.commit(
                history, 0, "edited working tree", true);

        assertEquals(List.of("saved snapshot", "edited working tree"), history);
        assertEquals(1, selected);
    }

    @Test
    void editingOlderHistoryDiscardsItsForwardBranchWithoutAppending() {
        List<String> history = new ArrayList<>(List.of("older", "newer"));

        int selected = RecipeHistoryEdits.commit(
                history, 0, "changed older", false);

        assertEquals(List.of("changed older"), history);
        assertEquals(0, selected);
    }
}
