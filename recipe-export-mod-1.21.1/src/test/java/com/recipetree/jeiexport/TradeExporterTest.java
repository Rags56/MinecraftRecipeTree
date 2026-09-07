package com.recipetree.jeiexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

final class TradeExporterTest {
    @Test
    void reusedTradesRestoreEveryReferencedCatalogIngredient() {
        JsonObject recipe = new JsonObject();
        recipe.add("in", slots("item|minecraft:emerald", "item|minecraft:bowl"));
        recipe.add("out", slots("item|minecraft:suspicious_stew:[8.160]"));

        var cached = new IncrementalExportCache.CachedRecipe(
                recipe,
                "recipes/jeiexport_trading/r7.png");

        assertEquals(
                java.util.Set.of(
                        "item|minecraft:emerald",
                        "item|minecraft:bowl",
                        "item|minecraft:suspicious_stew:[8.160]"),
                TradeExporter.cachedIngredientKeys(List.of(cached)));
    }

    private static JsonArray slots(String... keys) {
        JsonArray slots = new JsonArray();
        JsonArray alternatives = new JsonArray();
        for (String key : keys) {
            JsonArray pair = new JsonArray();
            pair.add(key);
            pair.add(1);
            alternatives.add(pair);
        }
        slots.add(alternatives);
        return slots;
    }
}
