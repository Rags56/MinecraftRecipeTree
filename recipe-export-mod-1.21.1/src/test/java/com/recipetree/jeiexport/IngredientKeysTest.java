package com.recipetree.jeiexport;

import mezz.jei.api.ingredients.IIngredientType;
import mezz.jei.api.neoforge.NeoForgeTypes;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class IngredientKeysTest {
    private static final IIngredientType<First.SharedName> FIRST = () -> First.SharedName.class;
    private static final IIngredientType<Second.SharedName> SECOND = () -> Second.SharedName.class;

    @Test
    void customIngredientPrefixesAreStableAndClassQualified() {
        String first = IngredientKeys.typePrefix(FIRST);

        assertEquals(first, IngredientKeys.typePrefix(FIRST));
        assertTrue(first.matches("custom_sharedname_[0-9a-f]{8}"));
    }

    @Test
    void equalSimpleNamesFromDifferentModsDoNotCollide() {
        assertNotEquals(IngredientKeys.typePrefix(FIRST), IngredientKeys.typePrefix(SECOND));
    }

    @Test
    void forgeFluidsUseTheCanonicalFluidPrefix() {
        assertEquals("fluid", IngredientKeys.typePrefix(NeoForgeTypes.FLUID_STACK));
    }

    @Test
    void canonicalFallbackDigestIsStableAndCollisionResistantInShape() {
        String digest = Naming.sha256("{components:{example:1b}}");

        assertEquals(digest, Naming.sha256("{components:{example:1b}}"));
        assertTrue(digest.matches("[0-9a-f]{64}"));
        assertNotEquals(digest, Naming.sha256("{components:{example:2b}}"));
    }

    private static final class First {
        private static final class SharedName {
        }
    }

    private static final class Second {
        private static final class SharedName {
        }
    }
}
