package com.recipetree.jeiexport;

import net.minecraft.resources.ResourceLocation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class RecipeCategoryFilterTest {
    @Test
    void excludesJeiTagAndInformationPagesButKeepsRealRecipes() {
        assertTrue(RecipeExporter.isMetaCategory(ResourceLocation.fromNamespaceAndPath("jei", "tag_recipes/item")));
        assertTrue(RecipeExporter.isMetaCategory(ResourceLocation.fromNamespaceAndPath("minecraft", "tag_recipes/block")));
        assertTrue(RecipeExporter.isMetaCategory(ResourceLocation.fromNamespaceAndPath("jei", "information")));

        assertFalse(RecipeExporter.isMetaCategory(ResourceLocation.fromNamespaceAndPath("minecraft", "crafting")));
        assertFalse(RecipeExporter.isMetaCategory(ResourceLocation.fromNamespaceAndPath("create", "mixing")));
    }
}
