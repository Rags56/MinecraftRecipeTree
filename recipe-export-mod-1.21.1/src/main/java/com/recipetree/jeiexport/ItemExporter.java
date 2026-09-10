package com.recipetree.jeiexport;

import mezz.jei.api.ingredients.IIngredientType;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.runtime.IJeiRuntime;

import java.io.IOException;
import java.util.ArrayDeque;

/**
 * Items phase: walks every registered JEI ingredient type (items, fluids, custom types)
 * and pushes every ingredient through the catalog, which renders its icon.
 */
final class ItemExporter implements ExportJob.PhaseRunner {
    private final ExportContext ctx;
    private final ItemCatalog catalog;
    private final ArrayDeque<ITypedIngredient<?>> queue = new ArrayDeque<>();
    private final int total;
    private int done;

    ItemExporter(ExportContext ctx, IJeiRuntime runtime) throws IOException {
        this.ctx = ctx;
        this.catalog = ctx.catalog(runtime.getIngredientManager());
        for (IIngredientType<?> type : catalog.manager.getRegisteredIngredientTypes()) {
            try {
                enqueueAll(type);
            } catch (Throwable t) {
                ctx.failure("ITEM_ENUMERATION: ingredient type "
                        + type.getIngredientClass().getName() + ": " + t);
            }
        }
        this.total = queue.size();
    }

    private <V> void enqueueAll(IIngredientType<V> type) {
        for (V ingredient : catalog.manager.getAllIngredients(type)) {
            catalog.manager.createTypedIngredient(type, ingredient)
                    .filter(typed -> !ItemCatalog.isEmptyIngredient(typed))
                    .ifPresent(queue::add);
        }
    }

    @Override
    public boolean step() {
        ITypedIngredient<?> typed = queue.poll();
        if (typed == null) {
            return true;
        }
        try {
            catalog.ensure(typed);
        } catch (Throwable t) {
            ctx.failure("ITEM_IDENTITY: item catalog export", t);
        }
        done++;
        return queue.isEmpty();
    }

    @Override
    public String label() {
        return "items";
    }

    @Override
    public int done() {
        return done;
    }

    @Override
    public int total() {
        return total;
    }
}
