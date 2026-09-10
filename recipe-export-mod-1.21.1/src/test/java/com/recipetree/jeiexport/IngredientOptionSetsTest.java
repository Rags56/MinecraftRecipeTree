package com.recipetree.jeiexport;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class IngredientOptionSetsTest {
    @Test
    void keepsOnlyOptionsAcceptedByBothTagIngredients() {
        assertEquals(
                List.of("oak", "birch"),
                IngredientOptionSets.sharedOptions(
                        List.of("oak", "spruce", "birch"),
                        List.of("birch", "oak", "crimson"),
                        String::equals));
    }

    @Test
    void doesNotMergeTagIngredientsWithoutACommonOption() {
        assertEquals(
                List.of(),
                IngredientOptionSets.sharedOptions(
                        List.of("oak", "spruce"),
                        List.of("crimson", "warped"),
                        String::equals));
    }

    @Test
    void removesEquivalentDuplicatesFromTheSharedChoices() {
        assertEquals(
                List.of("Oak"),
                IngredientOptionSets.sharedOptions(
                        List.of("Oak", "oak"),
                        List.of("OAK"),
                        String::equalsIgnoreCase));
    }
}
