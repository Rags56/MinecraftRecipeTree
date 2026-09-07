package com.recipetree.jeiexport;

import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.forge.ForgeTypes;
import mezz.jei.api.ingredients.IIngredientType;

import java.util.Locale;

/**
 * Keys are how items.json, recipes and the index reference each other:
 * {@code "<typePrefix>|<jei unique id>"}, e.g. {@code "item|minecraft:stone"} or
 * {@code "fluid|minecraft:water"}. The JEI unique id includes subtype data
 * (potion type, enchantments, ...) when a subtype interpreter is registered.
 */
final class IngredientKeys {
    private IngredientKeys() {
    }

    static String typePrefix(IIngredientType<?> type) {
        if (type == ProjectEPlanner.EMC) return "emc";
        if (type == VanillaTypes.ITEM_STACK) {
            return "item";
        }
        if (type == ForgeTypes.FLUID_STACK) {
            return "fluid";
        }
        Class<?> ingredientClass = type.getIngredientClass();
        String simpleName = ingredientClass.getSimpleName();
        if (simpleName.isBlank()) {
            simpleName = "ingredient";
        }
        // JEI ingredient types do not expose a registry id. A simple class name alone
        // collides when two mods define e.g. GasStack, so include the binary class name.
        return "custom_" + Naming.sanitize(simpleName.toLowerCase(Locale.ROOT))
                + "_" + Naming.hash8(ingredientClass.getName());
    }
}
