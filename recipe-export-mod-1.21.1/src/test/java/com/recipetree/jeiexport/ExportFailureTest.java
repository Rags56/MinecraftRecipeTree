package com.recipetree.jeiexport;

import net.minecraft.resources.ResourceLocation;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ExportFailureTest {
    @Test
    void recipeFailuresRetainPackDebuggingContextAndStackTrace() {
        IllegalStateException error = new IllegalStateException("layout exploded");
        ExportFailure failure = ExportFailure.recipe(
                ResourceLocation.fromNamespaceAndPath("brokenmod", "crusher"),
                ResourceLocation.fromNamespaceAndPath("brokenmod", "crushed_ore"),
                17,
                ExportFailureTest.class,
                "Recipe render failed",
                error);

        assertEquals("recipe", failure.scope);
        assertEquals("brokenmod", failure.modId);
        assertEquals("brokenmod:crusher", failure.categoryId);
        assertEquals("brokenmod:crushed_ore", failure.recipeId);
        assertEquals(17, failure.recipeIndex);
        assertEquals(ExportFailureTest.class.getName(), failure.recipeClass);
        assertEquals(IllegalStateException.class.getName(), failure.errorType);
        assertTrue(failure.message.contains("layout exploded"));
        assertNotNull(failure.details);
        assertTrue(failure.details.contains("IllegalStateException: layout exploded"));
    }
}
