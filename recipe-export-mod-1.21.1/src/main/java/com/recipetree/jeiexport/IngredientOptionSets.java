package com.recipetree.jeiexport;

import java.util.ArrayList;
import java.util.List;
import java.util.function.BiPredicate;

final class IngredientOptionSets {
    private IngredientOptionSets() {
    }

    static <T> List<T> sharedOptions(
            List<T> first,
            List<T> second,
            BiPredicate<T, T> sameOption) {
        List<T> shared = new ArrayList<>();
        for (T option : first) {
            if (second.stream().anyMatch(other -> sameOption.test(option, other))
                    && shared.stream().noneMatch(existing -> sameOption.test(existing, option))) {
                shared.add(option);
            }
        }
        return List.copyOf(shared);
    }
}
