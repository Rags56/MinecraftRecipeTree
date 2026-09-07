package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.ModList;

import java.io.IOException;
import java.io.Writer;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.util.Collection;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/** Synthetic ProjectE sources for EMC-valued items that have no ordinary producing recipe. */
final class ProjectEEmcExporter implements ExportJob.PhaseRunner {
    static final String EMC_KEY = "emc|projecte:emc";
    private static final long MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private final ExportContext ctx;
    private final ItemCatalog catalog;
    private final Iterator<ItemStack> stacks;
    private final int total;
    private final Set<String> seen = new HashSet<>();
    private final EmcProxy emc;
    private final JsonArray recipes = new JsonArray();
    private JsonObject category;
    private String directory;
    private int categoryIndex = -1;
    private int done;
    private boolean written;
    private boolean emcFailed;

    ProjectEEmcExporter(ExportContext ctx, IJeiRuntime runtime) throws IOException {
        this.ctx = ctx;
        this.catalog = ctx.catalog(runtime.getIngredientManager());
        Collection<ItemStack> allStacks = catalog.manager.getAllIngredients(VanillaTypes.ITEM_STACK);
        this.stacks = allStacks.iterator();
        this.total = allStacks.size();
        EmcProxy loaded = null;
        if (ModList.get().isLoaded("projecte")) {
            try {
                loaded = EmcProxy.load();
            } catch (ReflectiveOperationException exception) {
                ctx.failure("PROJECTE_EMC_API: ProjectE is loaded but its optional EMC API could not be opened: "
                        + exception);
            }
        }
        this.emc = loaded;
    }

    static boolean shouldExport(boolean alreadyProduced, boolean hasValue, long value) {
        return !alreadyProduced && hasValue && value > 0 && value <= MAX_SAFE_JSON_INTEGER;
    }

    @Override
    public boolean step() {
        if (emc == null || emcFailed || !stacks.hasNext()) {
            return true;
        }
        ItemStack stack = stacks.next();
        done++;
        try {
            var typed = catalog.manager.createTypedIngredient(VanillaTypes.ITEM_STACK, stack);
            if (typed.isEmpty() || ItemCatalog.isEmptyIngredient(typed.get())) {
                return !stacks.hasNext();
            }
            String key = catalog.ensure(typed.get());
            if (!seen.add(key) || ctx.hasProducedRecipe(key) || !emc.hasValue(stack)) {
                return !stacks.hasNext();
            }
            long value = emc.value(stack);
            if (!shouldExport(false, true, value)) {
                if (value > MAX_SAFE_JSON_INTEGER) {
                    ctx.failure("PROJECTE_EMC_VALUE: " + key + " has " + value
                            + " EMC, above the viewer's exact integer limit");
                }
                return !stacks.hasNext();
            }
            ensureCategory();
            addRecipe(key, value);
        } catch (ReflectiveOperationException exception) {
            emcFailed = true;
            ctx.failure("PROJECTE_EMC_LOOKUP: ProjectE lookup failed; remaining EMC sources were skipped: "
                    + exception);
        } catch (Throwable throwable) {
            ctx.failure("PROJECTE_EMC_ITEM: item #" + done + ": " + throwable);
        }
        return !stacks.hasNext();
    }

    private void ensureCategory() {
        if (category != null) {
            return;
        }
        catalog.ensureSynthetic(EMC_KEY, "projecte:emc", "EMC", "projecte", "emc");
        directory = "recipes/" + Naming.uniqueRecipeDir(
                ctx, ResourceLocation.fromNamespaceAndPath("projecte", "emc_transmutation"));
        category = new JsonObject();
        category.addProperty("id", "projecte:emc_transmutation");
        category.addProperty("title", "EMC Transmutation");
        category.addProperty("dir", directory);
        category.add("catalysts", new JsonArray());
        categoryIndex = ctx.registerCategory(category);
    }

    private void addRecipe(String outputKey, long value) {
        int recipeIndex = recipes.size();
        JsonObject recipe = new JsonObject();
        recipe.addProperty("id", "projecte:emc/" + Naming.hash8(outputKey));
        recipe.add("in", slots(EMC_KEY, value));
        recipe.add("out", slots(outputKey, 1));
        recipes.add(recipe);
        ctx.indexRecipe(EMC_KEY, false, categoryIndex, recipeIndex);
        ctx.indexRecipe(outputKey, true, categoryIndex, recipeIndex);
    }

    private static JsonArray slots(String key, long amount) {
        JsonArray pair = new JsonArray();
        pair.add(key);
        pair.add(amount);
        JsonArray slot = new JsonArray();
        slot.add(pair);
        JsonArray slots = new JsonArray();
        slots.add(slot);
        return slots;
    }

    @Override
    public void close() throws IOException {
        if (written || category == null) {
            written = true;
            return;
        }
        category.addProperty("count", recipes.size());
        var file = ctx.root.resolve(directory).resolve("recipes.json");
        Files.createDirectories(file.getParent());
        try (Writer writer = Files.newBufferedWriter(file)) {
            GSON.toJson(recipes, writer);
        }
        ctx.recipeCount += recipes.size();
        written = true;
    }

    @Override public String label() { return "EMC sources"; }
    @Override public int done() { return done; }
    @Override public int total() { return total; }

    static record EmcProxy(Object proxy, Method hasValue, Method getValue) {
        static EmcProxy load() throws ReflectiveOperationException {
            Class<?> proxyApi = Class.forName("moze_intel.projecte.api.proxy.IEMCProxy");
            Object proxy = proxyApi.getField("INSTANCE").get(null);
            if (proxy == null) throw new ReflectiveOperationException("IEMCProxy.INSTANCE returned null");
            return new EmcProxy(
                    proxy,
                    proxyApi.getMethod("hasValue", ItemStack.class),
                    proxyApi.getMethod("getValue", ItemStack.class));
        }

        boolean hasValue(ItemStack stack) throws ReflectiveOperationException {
            return Boolean.TRUE.equals(hasValue.invoke(proxy, normalized(stack)));
        }

        long value(ItemStack stack) throws ReflectiveOperationException {
            Object value = getValue.invoke(proxy, normalized(stack));
            if (!(value instanceof Number number)) throw new ReflectiveOperationException("ProjectE returned a nonnumeric EMC value: " + value);
            return number.longValue();
        }

        private static ItemStack normalized(ItemStack stack) {
            ItemStack copy = stack.copy();
            copy.setCount(1);
            return copy;
        }
    }
}
