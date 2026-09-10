package com.recipetree.jeiexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

final class IncrementalExportCacheTest {
    @Test
    void recipeFingerprintIgnoresImageLocationAndObjectPropertyOrder() {
        JsonObject previous = recipe("item|minecraft:iron_ingot", 1);
        previous.addProperty("img", "r42.png");
        previous.addProperty("bg", "bg3.png");

        JsonObject current = new JsonObject();
        current.add("out", previous.get("out").deepCopy());
        current.add("in", previous.get("in").deepCopy());
        current.addProperty("h", 40);
        current.addProperty("w", 80);
        current.addProperty("id", "minecraft:test");

        assertEquals(
                IncrementalExportCache.structuralFingerprint(previous),
                IncrementalExportCache.structuralFingerprint(current));
    }

    @Test
    void recipeFingerprintChangesWhenAnIngredientAmountChanges() {
        JsonObject one = recipe("item|minecraft:iron_ingot", 1);
        JsonObject two = recipe("item|minecraft:iron_ingot", 2);

        assertNotEquals(
                IncrementalExportCache.structuralFingerprint(one),
                IncrementalExportCache.structuralFingerprint(two));
    }

    @Test
    void duplicateStructuralRecipesAreConsumedAtMostOnceEach() {
        JsonObject recipe = recipe("item|minecraft:iron_ingot", 1);
        String fingerprint = IncrementalExportCache.structuralFingerprint(recipe);
        var matches = new java.util.HashMap<String,
                java.util.ArrayDeque<IncrementalExportCache.CachedRecipe>>();
        var queue = new java.util.ArrayDeque<IncrementalExportCache.CachedRecipe>();
        queue.add(new IncrementalExportCache.CachedRecipe(recipe, "recipes/test/r0.png"));
        matches.put(fingerprint, queue);
        var cache = new IncrementalExportCache.RecipeCategoryCache(matches, java.util.List.copyOf(queue));

        assertNotNull(cache.consume(recipe));
        assertNull(cache.consume(recipe));
    }

    private static JsonObject recipe(String key, int amount) {
        JsonObject recipe = new JsonObject();
        recipe.addProperty("id", "minecraft:test");
        recipe.addProperty("w", 80);
        recipe.addProperty("h", 40);
        JsonArray pair = new JsonArray();
        pair.add(key);
        pair.add(amount);
        JsonArray alternatives = new JsonArray();
        alternatives.add(pair);
        JsonArray slots = new JsonArray();
        slots.add(alternatives);
        recipe.add("in", slots);
        recipe.add("out", new JsonArray());
        return recipe;
    }
}
