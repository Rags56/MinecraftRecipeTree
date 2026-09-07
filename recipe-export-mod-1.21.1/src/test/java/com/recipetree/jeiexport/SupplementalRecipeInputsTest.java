package com.recipetree.jeiexport;

import net.minecraft.resources.ResourceLocation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class SupplementalRecipeInputsTest {
    @Test
    void convertsBloodAltarLpIntoLifeEssenceFluid() {
        var costs = SupplementalRecipeInputs.fluidCosts(
                ResourceLocation.fromNamespaceAndPath("bloodmagic", "altar"),
                new BloodAltarRecipe(2_000));

        assertEquals(1, costs.size());
        assertEquals(
                ResourceLocation.fromNamespaceAndPath("bloodmagic", "life_essence_fluid"),
                costs.get(0).fluidId());
        assertEquals(2_000, costs.get(0).amount());
    }

    @Test
    void ignoresCategoriesWithoutSupplementalResourceCosts() {
        assertEquals(
                0,
                SupplementalRecipeInputs.fluidCosts(
                        ResourceLocation.fromNamespaceAndPath("minecraft", "crafting"),
                        new Object()).size());
    }

    @Test
    void reportsChangedBloodAltarApisInsteadOfDroppingTheCost() {
        assertThrows(
                IllegalStateException.class,
                () -> SupplementalRecipeInputs.fluidCosts(
                        ResourceLocation.fromNamespaceAndPath("bloodmagic", "altar"),
                        new Object()));
    }

    public static final class BloodAltarRecipe {
        private final int syphon;

        private BloodAltarRecipe(int syphon) {
            this.syphon = syphon;
        }

        public int getSyphon() {
            return syphon;
        }
    }
}
