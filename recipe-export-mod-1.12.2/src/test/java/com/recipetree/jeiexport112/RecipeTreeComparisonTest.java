package com.recipetree.jeiexport112;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class RecipeTreeComparisonTest {
    private static RecipeTreeComparison.Amount amount(String key, String name, String quantity) {
        return new RecipeTreeComparison.Amount(key, name, null, new BigDecimal(quantity));
    }

    @Test
    public void showsAddedRemovedAndChangedQuantitiesWithoutUnchangedRows() {
        List<RecipeTreeComparison.Difference> rows = RecipeTreeComparison.differences(
                Arrays.asList(amount("iron", "Iron", "12"), amount("gold", "Gold", "5"),
                        amount("water", "Water", "1000.0")),
                Arrays.asList(amount("iron", "Iron", "4"), amount("diamond", "Diamond", "2"),
                        amount("water", "Water", "1000")));
        assertEquals(3, rows.size());
        assertEquals("diamond", rows.get(0).entry.key);
        assertEquals(new BigDecimal("2"), rows.get(0).change);
        assertEquals(BigDecimal.ZERO, rows.get(0).left);
        assertEquals("gold", rows.get(1).entry.key);
        assertEquals(new BigDecimal("-5"), rows.get(1).change);
        assertEquals(BigDecimal.ZERO, rows.get(1).right);
        assertEquals(new BigDecimal("-8"), rows.get(2).change);
    }

    @Test
    public void matchesIdentityRatherThanDisplayNameAndAggregatesDuplicates() {
        List<RecipeTreeComparison.Difference> rows = RecipeTreeComparison.differences(
                Arrays.asList(amount("a", "Copper", "0.25"), amount("a", "Copper", "0.50"),
                        amount("b", "Copper", "1")),
                Arrays.asList(amount("a", "Renamed Copper", "0.75"), amount("b", "Copper", "1.5")));
        assertEquals(1, rows.size());
        assertEquals("b", rows.get(0).entry.key);
        assertEquals(new BigDecimal("0.5"), rows.get(0).change);
    }

    @Test
    public void emptyAndIdenticalListsHaveNoDifferences() {
        assertTrue(RecipeTreeComparison.differences(Collections.emptyList(), Collections.emptyList()).isEmpty());
        List<RecipeTreeComparison.Amount> values = Collections.singletonList(amount("type", "Smelting", "300"));
        assertTrue(RecipeTreeComparison.differences(values, values).isEmpty());
    }

    @Test
    public void reversingTreesReversesTheSignedDifferenceExactly() {
        List<RecipeTreeComparison.Amount> a = Collections.singletonList(amount("fluid", "Fluid", "9223372036854775808.125"));
        List<RecipeTreeComparison.Amount> b = Collections.singletonList(amount("fluid", "Fluid", "9223372036854775809.250"));
        BigDecimal forward = RecipeTreeComparison.differences(a, b).get(0).change;
        assertEquals(new BigDecimal("1.125"), forward);
        assertEquals(forward.negate(), RecipeTreeComparison.differences(b, a).get(0).change);
    }
}
