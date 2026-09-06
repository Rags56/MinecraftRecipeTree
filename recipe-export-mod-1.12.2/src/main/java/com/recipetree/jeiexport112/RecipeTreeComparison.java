package com.recipetree.jeiexport112;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Quantity differences keyed by semantic identity, never by tree path or display name. */
final class RecipeTreeComparison {
    static final class Amount {
        final String key;
        final String name;
        final RecipeTreeViewerBridge.Ingredient icon;
        final BigDecimal quantity;

        Amount(String key, String name, RecipeTreeViewerBridge.Ingredient icon, BigDecimal quantity) {
            this.key = key;
            this.name = name;
            this.icon = icon;
            this.quantity = quantity;
        }
    }

    static final class Difference {
        final Amount entry;
        final BigDecimal left;
        final BigDecimal right;
        final BigDecimal change;

        Difference(Amount entry, BigDecimal left, BigDecimal right) {
            this.entry = entry;
            this.left = left;
            this.right = right;
            this.change = right.subtract(left);
        }
    }

    static List<Amount> types(RecipeTreeModel.Summary summary) {
        List<Amount> result = new ArrayList<Amount>();
        for (RecipeTreeModel.ProcessSummary type : summary.processes) {
            result.add(new Amount(type.key, type.title, type.machine, type.crafts));
        }
        return result;
    }

    static List<Amount> items(List<RecipeTreeModel.SummaryEntry> entries) {
        List<Amount> result = new ArrayList<Amount>();
        for (RecipeTreeModel.SummaryEntry entry : entries) {
            result.add(new Amount(entry.ingredient.getKey(), entry.ingredient.getDisplayName(),
                    entry.ingredient, entry.remaining));
        }
        return result;
    }

    static List<Difference> differences(List<Amount> left, List<Amount> right) {
        Map<String, Amount> identities = new LinkedHashMap<String, Amount>();
        Map<String, BigDecimal> a = totals(left, identities);
        Map<String, BigDecimal> b = totals(right, identities);
        List<Difference> result = new ArrayList<Difference>();
        for (Amount entry : identities.values()) {
            BigDecimal before = a.containsKey(entry.key) ? a.get(entry.key) : BigDecimal.ZERO;
            BigDecimal after = b.containsKey(entry.key) ? b.get(entry.key) : BigDecimal.ZERO;
            if (before.compareTo(after) != 0) result.add(new Difference(entry, before, after));
        }
        Collections.sort(result, Comparator.comparing((Difference row) -> row.entry.name,
                String.CASE_INSENSITIVE_ORDER).thenComparing(row -> row.entry.key));
        return Collections.unmodifiableList(result);
    }

    private static Map<String, BigDecimal> totals(List<Amount> entries, Map<String, Amount> identities) {
        Map<String, BigDecimal> result = new LinkedHashMap<String, BigDecimal>();
        for (Amount entry : entries) {
            identities.putIfAbsent(entry.key, entry);
            result.merge(entry.key, entry.quantity, BigDecimal::add);
        }
        return result;
    }
}
