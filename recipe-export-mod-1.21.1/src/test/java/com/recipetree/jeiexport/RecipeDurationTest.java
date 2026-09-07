package com.recipetree.jeiexport;

import org.junit.jupiter.api.Test;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CookingBookCategory;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.minecraft.world.item.crafting.SmeltingRecipe;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RecipeDurationTest {
    @Test
    void readsCookingDurationFromJeiRecipeHolder() {
        var recipe = new SmeltingRecipe("", CookingBookCategory.MISC,
                Ingredient.of(Items.RAW_IRON), new ItemStack(Items.IRON_INGOT), 0.7f, 200);
        var holder = new RecipeHolder<>(ResourceLocation.fromNamespaceAndPath("minecraft", "iron_ingot"), recipe);
        assertEquals(200, RecipeDuration.ticks(holder).orElseThrow());
    }

    @Test
    void readsCommonDurationAccessor() {
        assertEquals(240, RecipeDuration.ticks(new TimedRecipe()).orElseThrow());
    }

    @Test
    void derivesTicksFromJeiEnergyLabels() {
        assertEquals(50, RecipeDuration.ticks(new EnergyRecipe()).orElseThrow());
    }

    @Test
    void rejectsNonIntegralEnergyRatios() {
        assertTrue(RecipeDuration.ticks(new AmbiguousEnergyRecipe()).isEmpty());
    }

    public static final class TimedRecipe {
        public int getProcessingTime() { return 240; }
    }

    public static final class EnergyRecipe {
        public long getTotalEnergy() { return 10_000_000L; }
        public long getEnergyPerTick() { return 200_000L; }
    }

    public static final class AmbiguousEnergyRecipe {
        public long getTotalEnergy() { return 10L; }
        public long getEnergyPerTick() { return 3L; }
    }
}
