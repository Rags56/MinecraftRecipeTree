package com.recipetree.jeiexport112;

import org.junit.Test;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public final class ThaumicAspectSourceRecipeTest {
    @Test
    public void selectingOneSourceConsumesOneItemAndProducesItsExactAspectAmount() {
        RecipeTreeViewerBridge.Ingredient first = ingredient("item|example:first", "First", 500);
        RecipeTreeViewerBridge.Ingredient second = ingredient("item|example:second", "Second", 142);
        RecipeTreeViewerBridge.Ingredient aspect = ingredient("aspect|metallum", "Metallum", 1);
        RecipeTreeViewerBridge.Recipe page = page(first, second, aspect);

        RecipeTreeViewerBridge.Recipe selected = page.selectAspectSource(second);

        assertNotNull(selected);
        assertTrue(selected.isSelectedAspectSource());
        assertFalse(selected.isAspectSourcePage());
        assertEquals(1, selected.getInputs().size());
        assertEquals(1, selected.getInputs().get(0).getAlternatives().size());
        assertEquals("item|example:second",
                selected.getInputs().get(0).getAlternatives().get(0).getKey());
        assertEquals(BigDecimal.ONE,
                selected.getInputs().get(0).getAlternatives().get(0).getAmount());
        assertEquals(new BigDecimal("142"),
                selected.getOutputs().get(0).getAlternatives().get(0).getAmount());
        assertEquals(RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_RECIPE_WIDTH,
                selected.getWidth());
        assertEquals(RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_RECIPE_HEIGHT,
                selected.getHeight());
    }

    @Test
    public void selectedKeysAreStableDistinctAndResolvableWithoutExpandingThePageCache() {
        RecipeTreeViewerBridge.Ingredient first = ingredient("item|example:first", "First", 500);
        RecipeTreeViewerBridge.Ingredient second = ingredient("item|example:second", "Second", 142);
        RecipeTreeViewerBridge.Recipe page = page(first, second,
                ingredient("aspect|metallum", "Metallum", 1));

        RecipeTreeViewerBridge.Recipe firstChoice = page.selectAspectSource(first);
        RecipeTreeViewerBridge.Recipe secondChoice = page.selectAspectSource(second);

        assertNotEquals(firstChoice.getKey(), secondChoice.getKey());
        assertEquals(secondChoice.getKey(),
                page.resolveAspectSource(secondChoice.getKey()).getKey());
        assertNull(page.resolveAspectSource("missing"));
        assertNull(page.selectAspectSource(
                ingredient("item|example:outside", "Outside", 7)));
        assertEquals(2, page.getSelectableAspectSources().size());
    }

    @Test
    public void selectingOneSourceAddsItsOtherAspectsAsByproducts() {
        RecipeTreeViewerBridge.Ingredient source =
                ingredient("item|example:source", "Source", 45);
        RecipeTreeViewerBridge.Ingredient primary =
                ingredient("aspect|aer", "Aer", 1);
        RecipeTreeViewerBridge.Ingredient motus =
                ingredient("aspect|motus", "Motus", 8);
        RecipeTreeViewerBridge.Ingredient volatus =
                ingredient("aspect|volatus", "Volatus", 3);
        RecipeTreeViewerBridge.Ingredient primaryYield =
                ingredient("aspect|aer", "Aer", 45);
        Map<String, List<RecipeTreeViewerBridge.Ingredient>> byproducts =
                new LinkedHashMap<String, List<RecipeTreeViewerBridge.Ingredient>>();
        byproducts.put(RecipeTreeViewerBridge.Recipe.aspectSourceIdentity(source),
                Arrays.asList(primaryYield, motus, volatus));
        RecipeTreeViewerBridge.Recipe page = RecipeTreeViewerBridge.Recipe.aspectSourcePage(
                "page", RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_CATEGORY_UID,
                "Aspect from ItemStack", null,
                Collections.singletonList(slot(source)), Collections.singletonList(slot(primary)),
                220, 140, null, null, null, Collections.singletonList(source), byproducts);

        RecipeTreeViewerBridge.Recipe selected = page.selectAspectSource(source);

        assertEquals(Arrays.asList(motus, volatus), page.getAspectSourceByproducts(source));
        assertEquals(Arrays.asList(primaryYield, motus, volatus),
                page.getAspectSourceOutputs(source));
        assertEquals(new BigDecimal("45"), page.getAspectSourceOutputs(source).get(0).getAmount());
        assertEquals(3, selected.getOutputs().size());
        assertEquals("aspect|aer", selected.getOutputs().get(0).getAlternatives().get(0).getKey());
        assertEquals("aspect|motus", selected.getOutputs().get(1).getAlternatives().get(0).getKey());
        assertEquals("aspect|volatus", selected.getOutputs().get(2).getAlternatives().get(0).getKey());
    }

    private static RecipeTreeViewerBridge.Recipe page(
            RecipeTreeViewerBridge.Ingredient first,
            RecipeTreeViewerBridge.Ingredient second,
            RecipeTreeViewerBridge.Ingredient output) {
        return RecipeTreeViewerBridge.Recipe.aspectSourcePage(
                "page", RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_CATEGORY_UID,
                "Aspect from ItemStack", null,
                Arrays.asList(slot(first), slot(second)), Collections.singletonList(slot(output)),
                220, 140, null, null, null, Arrays.asList(first, second),
                Collections.<String, List<RecipeTreeViewerBridge.Ingredient>>emptyMap());
    }

    private static RecipeTreeViewerBridge.Slot slot(
            RecipeTreeViewerBridge.Ingredient ingredient) {
        return new RecipeTreeViewerBridge.Slot(Collections.singletonList(ingredient));
    }

    private static RecipeTreeViewerBridge.Ingredient ingredient(
            String key, String name, int amount) {
        return new RecipeTreeViewerBridge.Ingredient(
                null, key, key, name, BigDecimal.valueOf(amount));
    }
}
