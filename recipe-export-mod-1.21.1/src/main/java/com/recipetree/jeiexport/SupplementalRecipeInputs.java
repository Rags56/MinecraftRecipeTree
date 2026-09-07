package com.recipetree.jeiexport;

import net.minecraft.resources.ResourceLocation;

import java.lang.reflect.InvocationTargetException;
import java.util.List;

/** Resource costs that a JEI category renders without exposing as ingredient slots. */
final class SupplementalRecipeInputs {
    private static final ResourceLocation BLOOD_ALTAR =
            ResourceLocation.fromNamespaceAndPath("bloodmagic", "altar");
    private static final ResourceLocation LIFE_ESSENCE =
            ResourceLocation.fromNamespaceAndPath("bloodmagic", "life_essence_fluid");

    private SupplementalRecipeInputs() {
    }

    static List<FluidCost> fluidCosts(ResourceLocation recipeType, Object recipe) {
        if (!BLOOD_ALTAR.equals(recipeType)) return List.of();
        try {
            Object value = recipe.getClass().getMethod("getSyphon").invoke(recipe);
            if (!(value instanceof Number number) || number.longValue() <= 0) {
                throw new IllegalStateException("Blood Altar getSyphon() returned no positive LP cost");
            }
            return List.of(new FluidCost(LIFE_ESSENCE, number.longValue()));
        } catch (NoSuchMethodException | IllegalAccessException | InvocationTargetException error) {
            throw new IllegalStateException(
                    "Blood Altar recipe does not expose its getSyphon() LP cost",
                    error);
        }
    }

    record FluidCost(ResourceLocation fluidId, long amount) {
    }
}
