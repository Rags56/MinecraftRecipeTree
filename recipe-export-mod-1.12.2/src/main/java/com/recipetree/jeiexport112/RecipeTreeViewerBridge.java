package com.recipetree.jeiexport112;

import mezz.jei.api.IJeiRuntime;
import mezz.jei.api.IRecipeRegistry;
import mezz.jei.api.gui.IDrawable;
import mezz.jei.api.gui.IRecipeLayoutDrawable;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRegistry;
import mezz.jei.api.ingredients.IIngredientRenderer;
import mezz.jei.api.ingredients.VanillaTypes;
import mezz.jei.api.recipe.IFocus;
import mezz.jei.api.recipe.IIngredientType;
import mezz.jei.api.recipe.IRecipeCategory;
import mezz.jei.api.recipe.IRecipeWrapper;
import mezz.jei.api.recipe.wrapper.ICraftingRecipeWrapper;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.util.ITooltipFlag;
import net.minecraft.enchantment.EnchantmentData;
import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.fluids.FluidStack;
import net.minecraftforge.fml.common.registry.ForgeRegistries;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Runtime-neutral semantic bridge between JEI/HEI 4 and the in-game recipe planner.
 *
 * <p>Recipe semantics are recorded directly from {@link IRecipeWrapper#getIngredients}. Native
 * layouts are deliberately created later and cached separately, so a broken third-party recipe
 * renderer can never remove an otherwise valid recipe from the planner graph.</p>
 */
public final class RecipeTreeViewerBridge {
    static final int MAX_CACHED_LAYOUTS = 64;
    static final int MAX_CACHED_QUERIES = RecipeTreeModel.MAX_NODES;
    static final int MAX_CACHED_QUERY_RECIPES = 4096;
    static final int MAX_RECIPES_PER_CACHED_QUERY = 1024;
    static final int MAX_CACHED_AVAILABILITY_QUERIES = 4096;
    static final int MAX_CACHED_INGREDIENTS = 32768;
    static final int MAX_REGISTERED_INGREDIENT_TYPES = 128;
    static final int MAX_RESTORE_LOOKUP_SCAN_PER_TYPE = 250000;
    static final int MAX_RESTORE_LOOKUP_SCAN_TOTAL = 300000;
    private static final int FULL_FLUID_ICON_AMOUNT_MB = 1000;
    static final String EMC_CATEGORY_UID = "projecte:emc_transmutation";
    static final String EMC_CATEGORY_TITLE = "EMC Transmutation";
    static final int EMC_RECIPE_WIDTH = 86;
    static final int EMC_RECIPE_HEIGHT = 78;
    static final String THAUMIC_ASPECT_SOURCE_CATEGORY_UID =
            "THAUMCRAFT_ASPECT_FROM_ITEMSTACK";
    static final int THAUMIC_ASPECT_SOURCE_RECIPE_WIDTH = 78;
    static final int THAUMIC_ASPECT_SOURCE_RECIPE_HEIGHT = 38;
    private static final String THAUMIC_ASPECT_SOURCE_WRAPPER =
            "com.buuz135.thaumicjei.category.AspectFromItemStackCategory$" +
                    "AspectFromItemStackWrapper";
    static final String THAUMIC_CRUCIBLE_CATEGORY_UID = "THAUMCRAFT_CRUCIBLE";
    private static final String THAUMIC_CRUCIBLE_WRAPPER =
            "com.buuz135.thaumicjei.category.CrucibleCategory$CrucibleWrapper";
    private static final String THERMAL_TRANSPOSER_CONTAINER_WRAPPER =
            "cofh.thermalexpansion.plugins.jei.machine.transposer." +
                    "TransposerRecipeWrapperContainer";
    private static final String THERMAL_TRANSPOSER_MULTI_WRAPPER =
            "cofh.thermalexpansion.plugins.jei.machine.transposer." +
                    "TransposerRecipeWrapperMulti";
    private static final String VANILLA_BREWING_WRAPPER =
            "mezz.jei.plugins.vanilla.brewing.BrewingRecipeWrapper";
    private static final String CRAFTTWEAKER_BREWING_WRAPPER =
            "crafttweaker.mods.jei.recipeWrappers.BrewingRecipeCWrapper";

    private final IIngredientRegistry ingredientRegistry;
    private final IRecipeRegistry recipeRegistry;
    private final Object recipesGui;
    private final ProjectEEmcSupport emcSupport;
    private final Ingredient emcCatalyst;
    private final Map<String, Ingredient> ingredientsByKey =
            new LinkedHashMap<String, Ingredient>(16, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Ingredient> eldest) {
                    boolean remove = size() > MAX_CACHED_INGREDIENTS;
                    if (remove) {
                        JeiExportMod.LOGGER.debug("[jeiexport] Recipe Tree evicted bounded ingredient " +
                                "identity {} from its runtime lookup", eldest.getKey());
                    }
                    return remove;
                }
            };
    private final Map<String, Ingredient> restoredIngredientsByKey =
            new HashMap<String, Ingredient>();
    private final Map<QueryKey, QueryResult> semanticQueries =
            new LinkedHashMap<QueryKey, QueryResult>(16, 0.75F, true);
    private final Map<QueryKey, Boolean> recipeAvailability =
            new LinkedHashMap<QueryKey, Boolean>(128, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<QueryKey, Boolean> eldest) {
                    return size() > MAX_CACHED_AVAILABILITY_QUERIES;
                }
            };
    private final Set<String> loggedSemanticFailureSignatures = new HashSet<String>();
    private final Set<String> attemptedRestoreTypePrefixes = new HashSet<String>();
    private Map<String, IIngredientType<?>> registeredTypesByPrefix;
    private int cachedQueryRecipeCount;
    private int restoreLookupValuesScanned;
    private final Map<Recipe, LayoutResult> nativeLayouts =
            new LinkedHashMap<Recipe, LayoutResult>(16, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<Recipe, LayoutResult> eldest) {
                    return size() > MAX_CACHED_LAYOUTS;
                }
            };
    public RecipeTreeViewerBridge(IJeiRuntime runtime, IIngredientRegistry ingredientRegistry) {
        if (runtime == null) {
            throw new IllegalArgumentException("JEI runtime must not be null");
        }
        if (ingredientRegistry == null) {
            throw new IllegalArgumentException("JEI ingredient registry must not be null");
        }
        IRecipeRegistry registry = runtime.getRecipeRegistry();
        if (registry == null) {
            throw new IllegalArgumentException("JEI runtime returned a null recipe registry");
        }
        this.ingredientRegistry = ingredientRegistry;
        this.recipeRegistry = registry;
        this.recipesGui = runtime.getRecipesGui();
        ProjectEEmcSupport loadedEmc = null;
        Ingredient loadedCatalyst = null;
        if (ProjectEEmcSupport.isAvailable()) {
            try {
                loadedEmc = ProjectEEmcSupport.load();
                loadedCatalyst = loadProjectETransmutationTable();
                JeiExportMod.LOGGER.info(
                        "[jeiexport] Recipe Tree enabled live ProjectE EMC source recipes");
            } catch (Exception exception) {
                JeiExportMod.LOGGER.error(
                        "[jeiexport] ProjectE is loaded but Recipe Tree could not enable live EMC "
                                + "source recipes",
                        exception);
            }
        }
        this.emcSupport = loadedEmc;
        this.emcCatalyst = loadedCatalyst;
    }

    /** Converts a registered JEI ingredient value into its stable planner representation. */
    @SuppressWarnings("unchecked")
    public Ingredient ingredient(Object value) {
        if (value == null) {
            throw new IllegalArgumentException("ingredient value must not be null");
        }
        IIngredientType<Object> type =
                (IIngredientType<Object>) ingredientRegistry.getIngredientType(value);
        if (type == null) {
            throw new IllegalArgumentException("JEI has no registered ingredient type for " +
                    value.getClass().getName());
        }
        try {
            return ingredient(type, value);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree could not convert ingredient {}: {}",
                    value.getClass().getName(), throwable.toString(), throwable);
            throw asRuntime("Could not convert JEI ingredient " + value.getClass().getName(), throwable);
        }
    }

    public Ingredient ingredient(ItemStack stack) {
        if (stack == null || stack.isEmpty()) {
            throw new IllegalArgumentException("ItemStack ingredient must not be null or empty");
        }
        return ingredient((Object) stack);
    }

    /**
     * Resolves a persistent stable key. Query results and direct conversions are checked first.
     * On a cache miss, only the registered ingredient family identified by the stable-key prefix
     * is indexed. This restores fluids, gases, aspects, energy, and other custom HEI ingredients
     * without eagerly walking every ingredient in a large pack. Per-type and aggregate hard caps
     * prevent a malformed registry from turning history restore into an unbounded scan.
     */
    public Ingredient findIngredient(String stableKey) {
        if (stableKey == null || stableKey.trim().isEmpty()) {
            throw new IllegalArgumentException("stable ingredient key must not be null or blank");
        }
        if (ProjectEEmcPhase.EMC_KEY.equals(stableKey)) {
            return Ingredient.emc(BigDecimal.ONE);
        }
        synchronized (ingredientsByKey) {
            Ingredient cached = ingredientsByKey.get(stableKey);
            if (cached != null) {
                return cached;
            }
        }
        synchronized (restoredIngredientsByKey) {
            Ingredient restored = restoredIngredientsByKey.get(stableKey);
            if (restored != null) {
                return restored;
            }
        }
        Ingredient restored = scanRegisteredTypeForKey(stableKey);
        if (restored != null) {
            return restored;
        }
        synchronized (ingredientsByKey) {
            Ingredient cached = ingredientsByKey.get(stableKey);
            if (cached != null) {
                return cached;
            }
        }
        synchronized (restoredIngredientsByKey) {
            return restoredIngredientsByKey.get(stableKey);
        }
    }

    /** Returns focused recipes in JEI's category and wrapper order. */
    @SuppressWarnings({"rawtypes", "unchecked"})
    public List<RecipeGroup> query(Ingredient focusIngredient, IFocus.Mode mode) {
        if (focusIngredient == null) {
            throw new IllegalArgumentException("focused ingredient must not be null");
        }
        if (mode == null) {
            throw new IllegalArgumentException("focus mode must not be null");
        }
        if (focusIngredient.isEmc()) {
            return Collections.emptyList();
        }
        QueryKey queryKey = new QueryKey(focusIngredient.key, mode);
        synchronized (semanticQueries) {
            QueryResult cached = semanticQueries.get(queryKey);
            if (cached != null) {
                return cached.groups;
            }
        }
        final IFocus<?> focus;
        try {
            focus = recipeRegistry.createFocus(mode, focusIngredient.value);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree focused query could not create {} focus " +
                            "for {}: {}", mode, focusIngredient.key, throwable.toString(), throwable);
            throw asRuntime("Could not create JEI focus for " + focusIngredient.key, throwable);
        }
        if (focus == null) {
            IllegalStateException failure = new IllegalStateException(
                    "JEI returned a null " + mode + " focus for " + focusIngredient.key);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree {}", failure.getMessage());
            throw failure;
        }

        final List<IRecipeCategory> categories;
        try {
            categories = recipeRegistry.getRecipeCategories((IFocus) focus);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree category query failed for {}: {}",
                    focusIngredient.key, throwable.toString(), throwable);
            throw asRuntime("Could not query JEI categories for " + focusIngredient.key, throwable);
        }

        List<RecipeGroup> groups = new ArrayList<RecipeGroup>();
        boolean complete = true;
        if (categories == null) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned a null category list for {}",
                    focusIngredient.key);
            return Collections.emptyList();
        }
        for (IRecipeCategory category : categories) {
            if (category == null) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned a null category for {}",
                        focusIngredient.key);
                complete = false;
                continue;
            }
            String categoryUid;
            String categoryTitle;
            try {
                categoryUid = requiredText(category.getUid(), "recipe category UID");
                if (isMetaCategory(categoryUid)) {
                    continue;
                }
                categoryTitle = requiredText(category.getTitle(),
                        "recipe category title for " + categoryUid);
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree rejected a category while querying {}: {}",
                        focusIngredient.key, throwable.toString(), throwable);
                complete = false;
                continue;
            }

            Ingredient catalyst = firstCatalyst(category, categoryUid);
            int[] dimensions = categoryDimensions(category, categoryUid);
            final List<IRecipeWrapper> wrappers;
            try {
                wrappers = recipeRegistry.getRecipeWrappers(category, (IFocus) focus);
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree wrapper query failed for category {} " +
                                "and focus {}: {}", categoryUid, focusIngredient.key,
                        throwable.toString(), throwable);
                complete = false;
                continue;
            }
            if (wrappers == null) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned a null wrapper list for {}",
                        categoryUid);
                complete = false;
                continue;
            }

            List<Recipe> recipes = new ArrayList<Recipe>(wrappers.size());
            for (IRecipeWrapper wrapper : wrappers) {
                if (wrapper == null) {
                    JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned a null wrapper in {}",
                            categoryUid);
                    complete = false;
                    continue;
                }
                try {
                    RecordingIngredients recording = new RecordingIngredients(ingredientRegistry);
                    wrapper.getIngredients(recording);
                    String wrapperClass = wrapper.getClass().getName();
                    List<Slot> inputs = normalizeThaumicCrucibleInputs(
                            categoryUid, wrapperClass, normalizeBrewingInputs(
                                    wrapperClass, slots(recording.allInputs())));
                    List<Slot> outputs = slots(recording.allOutputs());
                    if (outputs.isEmpty()) {
                        throw new IllegalArgumentException("recipe has no semantic output slots");
                    }
                    if (THAUMIC_ASPECT_SOURCE_CATEGORY_UID.equals(categoryUid)) {
                        recipes.add(aspectSourcePage(categoryUid, categoryTitle, catalyst,
                                wrapperClass, inputs, outputs, dimensions, category, wrapper,
                                focus));
                        continue;
                    }
                    CorrelatedSlots correlated = correlateAlternatives(
                            wrapperClass, focusIngredient.key, inputs, outputs);
                    inputs = correlated.inputs;
                    outputs = correlated.outputs;
                    if (correlated.failure != null) {
                        throw new IllegalArgumentException(
                                "Thermal Expansion Transposer alternatives could not be " +
                                        "correlated for focus " + focusIngredient.key + ": " +
                                        correlated.failure + "; recipe rejected instead of " +
                                        "substituting the wrong fluid");
                    }
                    IFocus<?> nativeFocus = nativeLayoutFocus(
                            wrapperClass, correlated, focus);
                    String recipeKey = recipeKey(categoryUid, wrapper, inputs, outputs);
                    recipes.add(new Recipe(recipeKey, categoryUid, categoryTitle, catalyst,
                            inputs, outputs, dimensions[0], dimensions[1], category, wrapper,
                            nativeFocus));
                } catch (Throwable throwable) {
                    FatalErrors.rethrowIfFatal(throwable);
                    logSemanticRecordingFailure(categoryUid, wrapper, throwable);
                    complete = false;
                }
            }
            if (!recipes.isEmpty()) {
                groups.add(new RecipeGroup(categoryUid, categoryTitle, catalyst, recipes));
            }
        }
        complete &= appendProjectEEmcRecipe(groups, focusIngredient, mode);
        List<RecipeGroup> result = Collections.unmodifiableList(groups);
        boolean cached = cacheSemanticQuery(queryKey, result);
        cacheRecipeAvailability(queryKey, recipeCount(result) > 0);
        if (!complete) {
            if (cached) {
                JeiExportMod.LOGGER.warn("[jeiexport] Recipe Tree cached the successfully recorded " +
                                "subset of incomplete focused query {} ({}); failed entries were " +
                                "logged and the cache will be cleared when the JEI runtime reloads",
                        focusIngredient.key, mode);
            } else {
                JeiExportMod.LOGGER.warn("[jeiexport] Recipe Tree could not cache incomplete focused " +
                                "query {} ({}) because it exceeded the bounded semantic cache; " +
                                "failed entries were logged and successful entries are still returned",
                        focusIngredient.key, mode);
            }
        }
        return result;
    }

    private Recipe aspectSourcePage(
            String categoryUid,
            String categoryTitle,
            Ingredient catalyst,
            String wrapperClass,
            List<Slot> inputs,
            List<Slot> outputs,
            int[] dimensions,
            IRecipeCategory<?> category,
            IRecipeWrapper wrapper,
            IFocus<?> focus) {
        if (!THAUMIC_ASPECT_SOURCE_WRAPPER.equals(wrapperClass)) {
            throw new IllegalArgumentException("recognized ThaumicJEI aspect-source category " +
                    "uses unexpected wrapper " + wrapperClass);
        }
        if (outputs.size() != 1 || outputs.get(0).alternatives.size() != 1) {
            throw new IllegalArgumentException("recognized ThaumicJEI aspect-source wrapper no " +
                    "longer exposes exactly one aspect output");
        }
        if (inputs.isEmpty()) {
            throw new IllegalArgumentException("recognized ThaumicJEI aspect-source wrapper has " +
                    "no selectable item sources");
        }
        List<Ingredient> sources = new ArrayList<Ingredient>(inputs.size());
        for (Slot input : inputs) {
            if (input.alternatives.size() != 1
                    || input.alternatives.get(0).type != VanillaTypes.ITEM) {
                throw new IllegalArgumentException("recognized ThaumicJEI aspect-source wrapper " +
                        "no longer exposes one item per selectable source");
            }
            sources.add(input.alternatives.get(0));
        }
        Ingredient primaryAspect = outputs.get(0).alternatives.get(0);
        Map<String, List<Ingredient>> sourceOutputs =
                aspectSourceOutputs(sources, primaryAspect);
        String recipeKey = recipeKey(categoryUid, wrapper, inputs, outputs);
        return Recipe.aspectSourcePage(recipeKey, categoryUid, categoryTitle, catalyst,
                inputs, outputs, dimensions[0], dimensions[1], category, wrapper, focus,
                sources, sourceOutputs);
    }

    private Map<String, List<Ingredient>> aspectSourceOutputs(
            List<Ingredient> sources,
            Ingredient primaryAspect) {
        if (primaryAspect == null || primaryAspect.value == null || primaryAspect.type == null) {
            throw new IllegalArgumentException(
                    "ThaumicJEI aspect-source page has no typed primary aspect");
        }
        final Class<?> aspectListClass = primaryAspect.value.getClass();
        final Field aspectsField;
        final Constructor<?> fromItem;
        final Constructor<?> empty;
        final Object primaryAspectKey;
        try {
            aspectsField = aspectListClass.getField("aspects");
            fromItem = aspectListClass.getConstructor(ItemStack.class);
            empty = aspectListClass.getConstructor();
            Map<?, ?> primaryMap = aspectMap(aspectsField, primaryAspect.value);
            if (primaryMap.size() != 1) {
                throw new IllegalArgumentException(
                        "ThaumicJEI primary aspect list contains " + primaryMap.size() +
                                " entries instead of one");
            }
            primaryAspectKey = primaryMap.keySet().iterator().next();
        } catch (ReflectiveOperationException exception) {
            throw new IllegalStateException(
                    "Could not inspect the supported Thaumcraft AspectList shape", exception);
        }

        Map<String, List<Ingredient>> result =
                new LinkedHashMap<String, List<Ingredient>>();
        for (Ingredient source : sources) {
            List<Ingredient> extras = new ArrayList<Ingredient>();
            try {
                if (!(source.value instanceof ItemStack)) {
                    throw new IllegalArgumentException(
                            "ThaumicJEI aspect source is not an ItemStack: " + source.key);
                }
                Object allAspects = fromItem.newInstance(source.value);
                Map<?, ?> allAspectMap = aspectMap(aspectsField, allAspects);
                Object primaryAmount = allAspectMap.get(primaryAspectKey);
                if (!(primaryAmount instanceof Number)
                        || source.amount.compareTo(new BigDecimal(primaryAmount.toString())) != 0) {
                    throw new IllegalArgumentException(
                            "ThaumicJEI aspect amount for " + source.key + " does not match " +
                                    "Thaumcraft object tags");
                }
                for (Map.Entry<?, ?> entry : allAspectMap.entrySet()) {
                    if (!(entry.getValue() instanceof Number)
                            || ((Number) entry.getValue()).intValue() <= 0) {
                        throw new IllegalArgumentException(
                                "Thaumcraft object tags contain a non-positive aspect amount for " +
                                        source.key);
                    }
                    Object singleton = empty.newInstance();
                    @SuppressWarnings("unchecked")
                    Map<Object, Object> singletonMap =
                            (Map<Object, Object>) aspectMap(aspectsField, singleton);
                    singletonMap.put(entry.getKey(), entry.getValue());
                    Ingredient aspect = ingredientUnchecked(primaryAspect.type, singleton);
                    if (primaryAspectKey.equals(entry.getKey())) {
                        extras.add(0, aspect);
                    } else {
                        extras.add(aspect);
                    }
                }
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Could not resolve Thaumcraft aspect byproducts for {}; " +
                                "the source remains selectable without hidden byproducts: {}",
                        source.key, throwable.toString(), throwable);
                extras.clear();
            }
            result.put(Recipe.aspectSourceIdentity(source),
                    Collections.unmodifiableList(new ArrayList<Ingredient>(extras)));
        }
        return Collections.unmodifiableMap(result);
    }

    private static Map<?, ?> aspectMap(Field aspectsField, Object aspectList)
            throws IllegalAccessException {
        Object value = aspectsField.get(aspectList);
        if (!(value instanceof Map)) {
            throw new IllegalStateException("Thaumcraft AspectList.aspects is not a Map");
        }
        return (Map<?, ?>) value;
    }

    /**
     * Checks recipe availability without semantically recording every wrapper. Tree rendering only
     * needs this boolean, so it must not perform the much more expensive picker query per node.
     */
    @SuppressWarnings({"rawtypes", "unchecked"})
    public boolean hasRecipes(Ingredient focusIngredient, IFocus.Mode mode) {
        if (focusIngredient == null || mode == null) {
            throw new IllegalArgumentException("focus ingredient and mode must not be null");
        }
        if (focusIngredient.isEmc()) return false;
        QueryKey key = new QueryKey(focusIngredient.key, mode);
        synchronized (semanticQueries) {
            QueryResult semantic = semanticQueries.get(key);
            if (semantic != null) return semantic.recipeCount > 0;
        }
        synchronized (recipeAvailability) {
            Boolean cached = recipeAvailability.get(key);
            if (cached != null) return cached.booleanValue();
        }

        boolean available = false;
        boolean complete = true;
        try {
            IFocus<?> focus = recipeRegistry.createFocus(mode, focusIngredient.value);
            if (focus == null) {
                throw new IllegalStateException("JEI returned a null " + mode + " focus");
            }
            List<IRecipeCategory> categories = recipeRegistry.getRecipeCategories((IFocus) focus);
            if (categories == null) {
                throw new IllegalStateException("JEI returned a null recipe category list");
            }
            for (IRecipeCategory category : categories) {
                if (category == null) {
                    complete = false;
                    JeiExportMod.LOGGER.error(
                            "[jeiexport] Recipe Tree availability query found a null category for {}",
                            focusIngredient.key);
                    continue;
                }
                String categoryUid = category.getUid();
                if (categoryUid == null || isMetaCategory(categoryUid)) continue;
                List<IRecipeWrapper> wrappers = recipeRegistry.getRecipeWrappers(
                        category, (IFocus) focus);
                if (wrappers == null) {
                    complete = false;
                    JeiExportMod.LOGGER.error(
                            "[jeiexport] Recipe Tree availability query found null wrappers for {}",
                            categoryUid);
                    continue;
                }
                for (IRecipeWrapper wrapper : wrappers) {
                    if (wrapper != null) {
                        available = true;
                        break;
                    }
                }
                if (available) break;
            }
            if (!available && mode == IFocus.Mode.OUTPUT) {
                available = hasProjectEEmcRecipe(focusIngredient);
            }
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            complete = false;
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Recipe Tree availability query failed for {} ({}); treating it " +
                            "as unavailable until the JEI runtime reloads: {}",
                    focusIngredient.key, mode, throwable.toString(), throwable);
        }
        cacheRecipeAvailability(key, available);
        if (!complete) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Recipe Tree cached the logged availability result for {} ({}) " +
                            "to prevent a render-loop query storm",
                    focusIngredient.key, mode);
        }
        return available;
    }

    /**
     * Lazily creates the native JEI layout. A null return is always accompanied by an error log;
     * the semantic {@link Recipe} remains valid and available to the caller.
     */
    @SuppressWarnings({"rawtypes", "unchecked"})
    public IRecipeLayoutDrawable nativeLayout(Recipe recipe) {
        if (recipe == null) {
            throw new IllegalArgumentException("recipe must not be null");
        }
        if (recipe.isEmcTransmutation()) {
            throw new IllegalArgumentException(
                    "ProjectE EMC recipes use Recipe Tree's explicit Transmutation Table renderer");
        }
        synchronized (nativeLayouts) {
            LayoutResult cached = nativeLayouts.get(recipe);
            if (cached != null) {
                return cached.layout;
            }
            try {
                IRecipeLayoutDrawable layout = recipeRegistry.createRecipeLayoutDrawable(
                        (IRecipeCategory) recipe.category, recipe.wrapper, recipe.focus);
                if (layout == null) {
                    JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned a null native layout " +
                            "for recipe {} in {}; semantic recipe retained", recipe.key,
                            recipe.categoryUid);
                }
                nativeLayouts.put(recipe, new LayoutResult(layout));
                return layout;
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree native layout failed for recipe {} " +
                                "in {}: {}; semantic recipe retained", recipe.key,
                        recipe.categoryUid, throwable.toString(), throwable);
                nativeLayouts.put(recipe, new LayoutResult(null));
                return null;
            }
        }
    }

    /**
     * Lets Modular Machinery render its live structure preview inside Recipe Tree. Its 1.12
     * wrapper refuses to draw unless HEI's concrete recipe GUI is reported as the current screen,
     * even when the wrapper is being rendered through JEI's public drawable API. The substitution
     * is limited to that category and to the synchronous native draw call.
     */
    NativeRenderScope beginNativeRender(Recipe recipe, Minecraft client) {
        if (recipe == null || !ModularMachineryStructure.isPreviewCategory(recipe.categoryUid)) {
            return NativeRenderScope.noOp();
        }
        return NativeRenderScope.enter(client, recipesGui, recipe.key);
    }

    ModularMachineryPreviewScope beginStructurePreview(
            Recipe recipe, Minecraft client, int left, int top, float scale) {
        if (!ModularMachineryStructure.isPreviewCategory(recipe.categoryUid)) return null;
        // Original Modular Machinery uses a different renderer; this adapter is for MMCE.
        try {
            recipe.wrapper.getClass().getMethod("getGuiBlueprintScreenJEI");
        } catch (NoSuchMethodException originalModularMachinery) {
            return null;
        }
        try {
            return new ModularMachineryPreviewScope(recipe.wrapper, client,
                    recipe.getWidth(), recipe.getHeight(), left, top, scale);
        } catch (ReflectiveOperationException error) {
            throw new IllegalStateException("Could not align MMCE structure preview " + recipe.key,
                    error);
        }
    }

    static final class NativeRenderScope {
        private static final String HEI_RECIPES_GUI = "mezz.jei.gui.recipes.RecipesGui";
        private static final NativeRenderScope NO_OP =
                new NativeRenderScope(null, null, null, 0, 0, false);

        private final Minecraft client;
        private final GuiScreen previousScreen;
        private final GuiScreen recipesScreen;
        private final int previousWidth;
        private final int previousHeight;
        private final boolean active;
        private boolean closed;

        private NativeRenderScope(Minecraft client, GuiScreen previousScreen,
                                  GuiScreen recipesScreen, int previousWidth,
                                  int previousHeight, boolean active) {
            this.client = client;
            this.previousScreen = previousScreen;
            this.recipesScreen = recipesScreen;
            this.previousWidth = previousWidth;
            this.previousHeight = previousHeight;
            this.active = active;
        }

        static NativeRenderScope noOp() {
            return NO_OP;
        }

        static NativeRenderScope enter(Minecraft client, Object recipesGui, String recipeKey) {
            if (client == null) {
                throw new IllegalArgumentException(
                        "Minecraft client is required for Modular Machinery structure preview " +
                                recipeKey);
            }
            if (!(recipesGui instanceof GuiScreen)) {
                throw new IllegalStateException(
                        "HEI returned no GuiScreen for Modular Machinery structure preview " +
                                recipeKey);
            }
            if (!hasClassNamed(recipesGui.getClass(), HEI_RECIPES_GUI)) {
                throw new IllegalStateException(
                        "HEI recipe screen " + recipesGui.getClass().getName() +
                                " does not satisfy Modular Machinery's required " +
                                HEI_RECIPES_GUI + " contract for " + recipeKey);
            }
            GuiScreen previous = client.currentScreen;
            GuiScreen target = (GuiScreen) recipesGui;
            if (previous == null) {
                throw new IllegalStateException(
                        "Minecraft has no active screen while drawing Modular Machinery preview " +
                                recipeKey);
            }
            if (previous == target) {
                return noOp();
            }
            int oldWidth = target.width;
            int oldHeight = target.height;
            target.width = previous.width;
            target.height = previous.height;
            client.currentScreen = target;
            return new NativeRenderScope(client, previous, target, oldWidth, oldHeight, true);
        }

        private static boolean hasClassNamed(Class<?> type, String expectedName) {
            Class<?> current = type;
            while (current != null) {
                if (expectedName.equals(current.getName())) {
                    return true;
                }
                current = current.getSuperclass();
            }
            return false;
        }

        void close() {
            if (!active || closed) {
                return;
            }
            closed = true;
            if (client.currentScreen != recipesScreen) {
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Modular Machinery changed the active screen while Recipe " +
                                "Tree was drawing its structure preview; restoring Recipe Tree");
            }
            client.currentScreen = previousScreen;
            recipesScreen.width = previousWidth;
            recipesScreen.height = previousHeight;
        }
    }

    public void releaseNativeLayout(Recipe recipe) {
        if (recipe == null) {
            return;
        }
        synchronized (nativeLayouts) {
            nativeLayouts.remove(recipe);
        }
    }

    public void clearNativeLayouts() {
        synchronized (nativeLayouts) {
            nativeLayouts.clear();
        }
    }

    /** Clears focused semantic results so staged or dynamically hidden recipes are queried again. */
    public void clearSemanticQueries() {
        synchronized (semanticQueries) {
            semanticQueries.clear();
            cachedQueryRecipeCount = 0;
        }
        synchronized (recipeAvailability) {
            recipeAvailability.clear();
        }
        synchronized (loggedSemanticFailureSignatures) {
            loggedSemanticFailureSignatures.clear();
        }
    }

    /** Releases every runtime-derived cache owned by this bridge. */
    public void clearCaches() {
        clearNativeLayouts();
        clearSemanticQueries();
    }

    private boolean cacheSemanticQuery(QueryKey key, List<RecipeGroup> groups) {
        int recipeCount = recipeCount(groups);
        if (recipeCount > MAX_RECIPES_PER_CACHED_QUERY) {
            JeiExportMod.LOGGER.warn("[jeiexport] Recipe Tree focused query {} ({}) contains {} " +
                            "recipes, above the per-query cache cap {}; returning the full result " +
                            "without caching it", key.ingredientKey, key.mode, recipeCount,
                    MAX_RECIPES_PER_CACHED_QUERY);
            return false;
        }

        synchronized (semanticQueries) {
            QueryResult previous = semanticQueries.remove(key);
            if (previous != null) {
                cachedQueryRecipeCount -= previous.recipeCount;
            }
            while (!semanticQueries.isEmpty() &&
                    (semanticQueries.size() >= MAX_CACHED_QUERIES ||
                            cachedQueryRecipeCount + recipeCount > MAX_CACHED_QUERY_RECIPES)) {
                Map.Entry<QueryKey, QueryResult> eldest =
                        semanticQueries.entrySet().iterator().next();
                semanticQueries.remove(eldest.getKey());
                cachedQueryRecipeCount -= eldest.getValue().recipeCount;
                JeiExportMod.LOGGER.debug("[jeiexport] Recipe Tree evicted bounded focused query {} " +
                                "({}); cache now holds {} queries and {} recipes",
                        eldest.getKey().ingredientKey, eldest.getKey().mode,
                        semanticQueries.size(), cachedQueryRecipeCount);
            }
            semanticQueries.put(key, new QueryResult(groups, recipeCount));
            cachedQueryRecipeCount += recipeCount;
        }
        return true;
    }

    private void cacheRecipeAvailability(QueryKey key, boolean available) {
        synchronized (recipeAvailability) {
            recipeAvailability.put(key, Boolean.valueOf(available));
        }
    }

    private void logSemanticRecordingFailure(
            String categoryUid,
            IRecipeWrapper wrapper,
            Throwable throwable) {
        String wrapperClass = wrapper.getClass().getName();
        String signature = categoryUid + '\n' + wrapperClass + '\n'
                + throwable.getClass().getName() + '\n' + String.valueOf(throwable.getMessage());
        boolean first;
        synchronized (loggedSemanticFailureSignatures) {
            first = loggedSemanticFailureSignatures.add(signature);
        }
        if (first) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree semantic recording failed for " +
                            "category {} wrapper {}: {}; recipe omitted while the query continues",
                    categoryUid, wrapperClass, throwable.toString(), throwable);
        } else {
            JeiExportMod.LOGGER.debug("[jeiexport] Recipe Tree suppressed a repeated semantic " +
                            "recording stack for category {} wrapper {}: {}",
                    categoryUid, wrapperClass, throwable.toString());
        }
    }

    private boolean hasProjectEEmcRecipe(Ingredient focusIngredient)
            throws ReflectiveOperationException {
        if (emcSupport == null || focusIngredient.type != VanillaTypes.ITEM
                || !(focusIngredient.value instanceof ItemStack)) {
            return false;
        }
        ItemStack stack = ((ItemStack) focusIngredient.value).copy();
        stack.setCount(1);
        boolean hasValue = emcSupport.hasValue(stack);
        long value = hasValue ? emcSupport.value(stack) : 0L;
        return ProjectEEmcSupport.isUsableValue(hasValue, value);
    }

    private static int recipeCount(List<RecipeGroup> groups) {
        int total = 0;
        for (RecipeGroup group : groups) {
            if (group != null) {
                total += group.recipes.size();
            }
        }
        return total;
    }

    int semanticQueryCacheSizeForTesting() {
        synchronized (semanticQueries) {
            return semanticQueries.size();
        }
    }

    int semanticQueryCacheRecipeCountForTesting() {
        synchronized (semanticQueries) {
            return cachedQueryRecipeCount;
        }
    }

    int recipeAvailabilityCacheSizeForTesting() {
        synchronized (recipeAvailability) {
            return recipeAvailability.size();
        }
    }

    int semanticFailureSignatureCountForTesting() {
        synchronized (loggedSemanticFailureSignatures) {
            return loggedSemanticFailureSignatures.size();
        }
    }

    /** Draws a compact-node ingredient with JEI's registered renderer. */
    @SuppressWarnings("unchecked")
    public void renderIngredient(Ingredient ingredient, Minecraft minecraft, int x, int y) {
        if (ingredient == null || minecraft == null) {
            throw new IllegalArgumentException("ingredient and Minecraft must not be null");
        }
        if (ingredient.isEmc()) {
            Gui.drawRect(x + 1, y + 1, x + 15, y + 15, 0xFF5A176B);
            Gui.drawRect(x + 3, y + 3, x + 13, y + 13, 0xFF9C4EB0);
            minecraft.fontRenderer.drawStringWithShadow("E", x + 5, y + 4, 0xFFFFFFFF);
            return;
        }
        try {
            IIngredientType<Object> type = (IIngredientType<Object>) ingredient.type;
            IIngredientRenderer<Object> renderer = ingredientRegistry.getIngredientRenderer(type);
            if (renderer == null) {
                throw new IllegalStateException("JEI returned a null renderer for " + ingredient.key);
            }
            Object renderValue = ingredient.value;
            if (ingredient.type == VanillaTypes.ITEM) {
                renderValue = ItemCatalog.catalogRenderIngredient(type, renderValue);
            } else if (ingredient.type == VanillaTypes.FLUID
                    && renderValue instanceof FluidStack) {
                FluidStack fullIconFluid = ((FluidStack) renderValue).copy();
                fullIconFluid.amount = FULL_FLUID_ICON_AMOUNT_MB;
                renderValue = fullIconFluid;
            }
            renderer.render(minecraft, x, y, renderValue);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree ingredient render failed for {}: {}",
                    ingredient.key, throwable.toString(), throwable);
            throw asRuntime("Could not render ingredient " + ingredient.key, throwable);
        }
    }

    /** Returns a defensive immutable copy of JEI's native ingredient tooltip. */
    @SuppressWarnings("unchecked")
    public List<String> getTooltip(Ingredient ingredient, Minecraft minecraft) {
        if (ingredient == null || minecraft == null) {
            throw new IllegalArgumentException("ingredient and Minecraft must not be null");
        }
        if (ingredient.isEmc()) {
            List<String> tooltip = new ArrayList<String>();
            tooltip.add("EMC");
            tooltip.add("ProjectE transmutation value");
            return Collections.unmodifiableList(tooltip);
        }
        try {
            IIngredientType<Object> type = (IIngredientType<Object>) ingredient.type;
            IIngredientRenderer<Object> renderer = ingredientRegistry.getIngredientRenderer(type);
            if (renderer == null) {
                throw new IllegalStateException("JEI returned a null renderer for " + ingredient.key);
            }
            ITooltipFlag flag = minecraft.gameSettings.advancedItemTooltips
                    ? ITooltipFlag.TooltipFlags.ADVANCED
                    : ITooltipFlag.TooltipFlags.NORMAL;
            List<String> tooltip = renderer.getTooltip(minecraft, ingredient.value, flag);
            if (tooltip == null) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned a null tooltip for {}; " +
                        "using an empty tooltip", ingredient.key);
                return Collections.emptyList();
            }
            return Collections.unmodifiableList(new ArrayList<String>(tooltip));
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree ingredient tooltip failed for {}: {}",
                    ingredient.key, throwable.toString(), throwable);
            throw asRuntime("Could not read ingredient tooltip " + ingredient.key, throwable);
        }
    }

    private synchronized Ingredient scanRegisteredTypeForKey(String stableKey) {
        String prefix = stableKeyPrefix(stableKey);
        if (attemptedRestoreTypePrefixes.contains(prefix)) {
            synchronized (ingredientsByKey) {
                Ingredient cached = ingredientsByKey.get(stableKey);
                if (cached != null) {
                    return cached;
                }
            }
            synchronized (restoredIngredientsByKey) {
                return restoredIngredientsByKey.get(stableKey);
            }
        }
        attemptedRestoreTypePrefixes.add(prefix);

        IIngredientType<?> type = registeredTypesByPrefix().get(prefix);
        if (type == null) {
            JeiExportMod.LOGGER.warn("[jeiexport] Recipe Tree cannot restore {} because JEI/HEI has " +
                    "no registered ingredient type for stable-key prefix {}", stableKey, prefix);
            return null;
        }

        return scanRegisteredType(type, prefix, stableKey);
    }

    private Ingredient loadProjectETransmutationTable() {
        Block block = ForgeRegistries.BLOCKS.getValue(
                new ResourceLocation("projecte", "transmutation_table"));
        if (block == null) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] ProjectE's projecte:transmutation_table block is unavailable; "
                            + "EMC recipes will retain the table GUI but have no machine icon");
            return null;
        }
        Item item = Item.getItemFromBlock(block);
        if (item == null) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] ProjectE's transmutation table has no item form; EMC recipes "
                            + "will retain the table GUI but have no machine icon");
            return null;
        }
        return ingredient(new ItemStack(item));
    }

    private boolean appendProjectEEmcRecipe(
            List<RecipeGroup> groups,
            Ingredient focusIngredient,
            IFocus.Mode mode) {
        if (emcSupport == null || mode != IFocus.Mode.OUTPUT
                || focusIngredient.type != VanillaTypes.ITEM
                || !(focusIngredient.value instanceof ItemStack)) {
            return true;
        }
        try {
            ItemStack outputStack = ((ItemStack) focusIngredient.value).copy();
            outputStack.setCount(1);
            boolean hasValue = emcSupport.hasValue(outputStack);
            long value = hasValue ? emcSupport.value(outputStack) : 0L;
            if (!ProjectEEmcSupport.isUsableValue(hasValue, value)) {
                if (value > ProjectEEmcSupport.MAX_SAFE_INTEGER) {
                    JeiExportMod.LOGGER.error(
                            "[jeiexport] Recipe Tree omitted live EMC source for {} because {} "
                                    + "exceeds its exact integer limit",
                            focusIngredient.key, value);
                }
                return true;
            }
            Ingredient output = ingredient(outputStack);
            Ingredient emc = Ingredient.emc(BigDecimal.valueOf(value));
            List<Slot> inputs = Collections.singletonList(
                    new Slot(Collections.singletonList(emc)));
            List<Slot> outputs = Collections.singletonList(
                    new Slot(Collections.singletonList(output)));
            Recipe recipe = Recipe.emc(output.key, emcCatalyst, inputs, outputs);
            groups.add(new RecipeGroup(EMC_CATEGORY_UID, EMC_CATEGORY_TITLE,
                    emcCatalyst, Collections.singletonList(recipe)));
            return true;
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Recipe Tree ProjectE EMC lookup failed for {}; the EMC recipe "
                            + "was not added",
                    focusIngredient.key, throwable);
            return false;
        }
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Map<String, IIngredientType<?>> registeredTypesByPrefix() {
        if (registeredTypesByPrefix != null) {
            return registeredTypesByPrefix;
        }

        final Collection<IIngredientType> registered;
        try {
            registered = ingredientRegistry.getRegisteredIngredientTypes();
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree could not enumerate registered JEI/HEI " +
                    "ingredient types for history restore: {}", throwable.toString(), throwable);
            registeredTypesByPrefix = Collections.emptyMap();
            return registeredTypesByPrefix;
        }
        if (registered == null) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI/HEI returned null registered " +
                    "ingredient types for history restore");
            registeredTypesByPrefix = Collections.emptyMap();
            return registeredTypesByPrefix;
        }

        Map<String, IIngredientType<?>> indexed = new LinkedHashMap<String, IIngredientType<?>>();
        int seen = 0;
        for (IIngredientType type : registered) {
            if (seen >= MAX_REGISTERED_INGREDIENT_TYPES) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree registered ingredient type scan hit " +
                                "its hard cap of {} while JEI/HEI reported {} types; later types cannot " +
                                "be restored from saved history", MAX_REGISTERED_INGREDIENT_TYPES,
                        registered.size());
                break;
            }
            seen++;
            if (type == null) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree ignored a null registered ingredient " +
                        "type while building the bounded history lookup");
                continue;
            }
            String typePrefix;
            try {
                typePrefix = ingredientPrefix(type);
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree could not identify registered " +
                                "ingredient type {}: {}", type.getClass().getName(),
                        throwable.toString(), throwable);
                continue;
            }
            IIngredientType<?> previous = indexed.put(typePrefix, type);
            if (previous != null && previous != type) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree found duplicate registered ingredient " +
                                "prefix {}; {} replaces {} for history restore", typePrefix,
                        type.getIngredientClass().getName(), previous.getIngredientClass().getName());
            }
        }
        registeredTypesByPrefix = Collections.unmodifiableMap(indexed);
        return registeredTypesByPrefix;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private Ingredient scanRegisteredType(IIngredientType type, String prefix, String stableKey) {
        final Collection<?> registered;
        try {
            registered = ingredientRegistry.getAllIngredients(type);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree could not enumerate {} ingredients " +
                    "for history restore: {}", prefix, throwable.toString(), throwable);
            return null;
        }
        if (registered == null) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI/HEI returned a null {} ingredient " +
                    "registry for history restore", prefix);
            return null;
        }
        if (registered.size() > MAX_RESTORE_LOOKUP_SCAN_PER_TYPE) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree refused to index {} {} ingredients; " +
                            "the per-type history-restore safety cap is {}", registered.size(), prefix,
                    MAX_RESTORE_LOOKUP_SCAN_PER_TYPE);
            return null;
        }
        if (restoreLookupValuesScanned + registered.size() > MAX_RESTORE_LOOKUP_SCAN_TOTAL) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree refused to index {} {} ingredients because " +
                            "the aggregate history-restore scan would exceed its hard cap of {} " +
                            "(already scanned {})", registered.size(), prefix,
                    MAX_RESTORE_LOOKUP_SCAN_TOTAL, restoreLookupValuesScanned);
            return null;
        }

        restoreLookupValuesScanned += registered.size();
        JeiExportMod.LOGGER.info("[jeiexport] Recipe Tree indexing {} {} ingredients for saved-history " +
                "restore (aggregate {}/{})", registered.size(), prefix,
                restoreLookupValuesScanned, MAX_RESTORE_LOOKUP_SCAN_TOTAL);
        int indexed = 0;
        int rejected = 0;
        Ingredient requested = null;
        for (Object value : registered) {
            if (value == null || value instanceof ItemStack && ((ItemStack) value).isEmpty()) {
                rejected++;
                continue;
            }
            try {
                Ingredient converted = ingredient(type, value, false);
                synchronized (restoredIngredientsByKey) {
                    restoredIngredientsByKey.put(converted.key, converted);
                }
                indexed++;
                if (stableKey.equals(converted.key)) {
                    requested = converted;
                }
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                rejected++;
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree rejected a {} ingredient while " +
                                "building the bounded history lookup: {}", prefix,
                        throwable.toString(), throwable);
            }
        }
        JeiExportMod.LOGGER.info("[jeiexport] Recipe Tree {} history index complete: {} indexed, " +
                "{} rejected", prefix, indexed, rejected);
        return requested;
    }

    private static String stableKeyPrefix(String stableKey) {
        int separator = stableKey.indexOf('|');
        if (separator <= 0) {
            throw new IllegalArgumentException("stable ingredient key has no type prefix: " + stableKey);
        }
        return stableKey.substring(0, separator);
    }

    private Ingredient firstCatalyst(IRecipeCategory<?> category, String categoryUid) {
        final List<Object> catalysts;
        try {
            catalysts = recipeRegistry.getRecipeCatalysts(category);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree catalyst query failed for {}: {}",
                    categoryUid, throwable.toString(), throwable);
            return null;
        }
        if (catalysts == null) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree JEI returned null catalysts for {}",
                    categoryUid);
            return null;
        }
        for (Object catalyst : catalysts) {
            if (catalyst == null) {
                continue;
            }
            try {
                return ingredient(catalyst);
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree rejected catalyst {} for {}: {}",
                        catalyst.getClass().getName(), categoryUid, throwable.toString(), throwable);
            }
        }
        return null;
    }

    private static int[] categoryDimensions(IRecipeCategory<?> category, String categoryUid) {
        try {
            IDrawable background = category.getBackground();
            if (background == null) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree category {} has no background; " +
                        "using logged minimum native-card dimensions 1x1", categoryUid);
                return new int[]{1, 1};
            }
            int width = background.getWidth();
            int height = background.getHeight();
            if (width <= 0 || height <= 0) {
                JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree category {} returned invalid native-card " +
                                "dimensions {}x{}; using logged minimums", categoryUid, width, height);
            }
            return new int[]{Math.max(1, width), Math.max(1, height)};
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree could not read native-card dimensions " +
                            "for {}; using logged minimums 1x1: {}", categoryUid,
                    throwable.toString(), throwable);
            return new int[]{1, 1};
        }
    }

    private List<Slot> slots(Map<IIngredientType<?>, List<List<?>>> recorded) {
        List<Slot> result = new ArrayList<Slot>();
        for (Map.Entry<IIngredientType<?>, List<List<?>>> entry : recorded.entrySet()) {
            IIngredientType<?> type = entry.getKey();
            if (type == null) {
                throw new IllegalArgumentException("recorded ingredient slot has a null type");
            }
            List<List<?>> typedSlots = entry.getValue();
            if (typedSlots == null) {
                throw new IllegalArgumentException("recorded ingredient slots are null for " +
                        type.getIngredientClass().getName());
            }
            for (List<?> alternatives : typedSlots) {
                if (alternatives == null || alternatives.isEmpty()) {
                    throw new IllegalArgumentException("recorded ingredient slot has no alternatives for " +
                            type.getIngredientClass().getName());
                }
                List<Ingredient> converted = new ArrayList<Ingredient>(alternatives.size());
                for (Object alternative : alternatives) {
                    if (alternative == null) {
                        throw new IllegalArgumentException("recorded ingredient alternative is null for " +
                                type.getIngredientClass().getName());
                    }
                    converted.add(ingredientUnchecked(type, alternative));
                }
                result.add(new Slot(converted));
            }
        }
        return Collections.unmodifiableList(result);
    }

    @SuppressWarnings("unchecked")
    private Ingredient ingredientUnchecked(IIngredientType<?> type, Object value) {
        return ingredient((IIngredientType<Object>) type, value);
    }

    private <T> Ingredient ingredient(IIngredientType<T> type, T value) {
        return ingredient(type, value, true);
    }

    private <T> Ingredient ingredient(IIngredientType<T> type, T value, boolean cacheForRuntimeLookup) {
        if (type == null || value == null) {
            throw new IllegalArgumentException("ingredient type and value must not be null");
        }
        IIngredientHelper<T> helper = ingredientRegistry.getIngredientHelper(type);
        if (helper == null) {
            throw new IllegalStateException("JEI returned a null helper for " +
                    type.getIngredientClass().getName());
        }

        String resourceId = safeHelperText(helper, value, HelperText.RESOURCE_ID);
        String displayName = safeHelperText(helper, value, HelperText.DISPLAY_NAME);
        String uid = safeHelperText(helper, value, HelperText.UNIQUE_ID);
        String modId = safeHelperText(helper, value, HelperText.MOD_ID);
        uid = ItemNbtIdentity.refine(uid, resourceId, value);
        try {
            LegacyIngredientIdentity.Identity identity = LegacyIngredientIdentity.adapt(
                    value, uid, resourceId, displayName, modId, this::nestedItemIdentity);
            uid = identity.uid;
            resourceId = identity.resourceId;
            displayName = identity.displayName;
            modId = identity.modId;
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree exact legacy identity adapter failed " +
                            "for {}: {}; ingredient rejected", value.getClass().getName(),
                    throwable.toString(), throwable);
            throw asRuntime("Exact legacy identity adapter failed for " +
                    value.getClass().getName(), throwable);
        }
        if (uid == null || uid.trim().isEmpty()) {
            String seed = value.getClass().getName() + "|" + identityPart(resourceId) + "|" +
                    identityPart(displayName);
            uid = "jeiexport-fallback:" + Naming.hash8(seed);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree helper identity was null/blank for {}; " +
                    "using logged deterministic identity {}", value.getClass().getName(), uid);
        }
        if (displayName == null || displayName.trim().isEmpty()) {
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree helper display name was null/blank for {}; " +
                    "using stable identity as its label", value.getClass().getName());
            displayName = uid;
        }
        displayName = Naming.plainText(displayName);
        if (displayName == null || displayName.trim().isEmpty()) {
            displayName = uid;
        }

        BigDecimal amount = IngredientQuantity.amount(value,
                new IngredientQuantity.UnknownQuantityReporter() {
                    @Override
                    public void report(Class<?> ingredientClass) {
                        throw new IllegalArgumentException("No exact quantity adapter is registered for " +
                                ingredientClass.getName());
                    }
                });
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("Ingredient quantity must be exact and positive for " +
                    value.getClass().getName() + ", got " + amount);
        }

        Ingredient converted = new Ingredient(type, value, ingredientPrefix(type) + "|" + uid,
                displayName, amount);
        if (cacheForRuntimeLookup) {
            synchronized (ingredientsByKey) {
                Ingredient existing = ingredientsByKey.get(converted.key);
                if (existing == null) {
                    ingredientsByKey.put(converted.key, converted);
                }
            }
        }
        return converted;
    }

    private String nestedItemIdentity(Object nested) {
        if (!(nested instanceof ItemStack)) {
            throw new IllegalArgumentException("expected nested Meteor catalyst ItemStack, got " +
                    (nested == null ? "null" : nested.getClass().getName()));
        }
        ItemStack stack = (ItemStack) nested;
        IIngredientHelper<ItemStack> helper =
                ingredientRegistry.getIngredientHelper(VanillaTypes.ITEM);
        String uid = helper.getUniqueId(stack);
        if (uid == null || uid.trim().isEmpty()) {
            throw new IllegalArgumentException("JEI item helper returned a null/blank nested identity");
        }
        return uid + "|count=" + stack.getCount();
    }

    private static <T> String safeHelperText(IIngredientHelper<T> helper, T value,
                                             HelperText property) {
        try {
            switch (property) {
                case RESOURCE_ID:
                    return helper.getResourceId(value);
                case DISPLAY_NAME:
                    return helper.getDisplayName(value);
                case UNIQUE_ID:
                    return helper.getUniqueId(value);
                case MOD_ID:
                    return helper.getDisplayModId(value);
                default:
                    throw new AssertionError(property);
            }
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            JeiExportMod.LOGGER.error("[jeiexport] Recipe Tree helper {} failed for {}: {}; " +
                            "identity fallback remains explicit", property.label,
                    value.getClass().getName(), throwable.toString(), throwable);
            return null;
        }
    }

    private static String recipeKey(String categoryUid, IRecipeWrapper wrapper,
                                    List<Slot> inputs, List<Slot> outputs) {
        if (wrapper instanceof ICraftingRecipeWrapper) {
            ResourceLocation registryName = ((ICraftingRecipeWrapper) wrapper).getRegistryName();
            if (registryName != null) {
                return categoryUid + "|" + registryName.toString();
            }
        }
        return semanticRecipeKey(categoryUid, semanticSlots(inputs), semanticSlots(outputs));
    }

    private static List<List<String>> semanticSlots(List<Slot> slots) {
        List<List<String>> result = new ArrayList<List<String>>(slots.size());
        for (Slot slot : slots) {
            List<String> alternatives = new ArrayList<String>(slot.alternatives.size());
            for (Ingredient ingredient : slot.alternatives) {
                alternatives.add(ingredient.key + "\u0000" + decimal(ingredient.amount));
            }
            result.add(alternatives);
        }
        return result;
    }

    static CorrelatedSlots correlateAlternatives(
            String wrapperClass,
            String focusKey,
            List<Slot> inputs,
            List<Slot> outputs) {
        if (!isThermalTransposerParallelWrapper(wrapperClass)) {
            return CorrelatedSlots.unchanged(inputs, outputs);
        }
        int cardinality = parallelAlternativeCardinality(inputs, outputs);
        if (cardinality < 0) {
            return CorrelatedSlots.failed(inputs, outputs,
                    "parallel slots have different alternative counts");
        }
        if (cardinality <= 1) {
            return CorrelatedSlots.unchanged(inputs, outputs);
        }

        Set<Integer> candidates = new HashSet<Integer>();
        collectUniqueFocusIndexes(inputs, focusKey, cardinality, candidates);
        collectUniqueFocusIndexes(outputs, focusKey, cardinality, candidates);
        if (candidates.size() != 1) {
            return CorrelatedSlots.failed(inputs, outputs,
                    "focus matched " + candidates.size() + " unambiguous variant indexes across " +
                            cardinality + " parallel alternatives");
        }
        int selectedIndex = candidates.iterator().next();
        return CorrelatedSlots.applied(
                narrowParallelSlots(inputs, cardinality, selectedIndex),
                narrowParallelSlots(outputs, cardinality, selectedIndex),
                selectedIndex);
    }

    /**
     * JEI's brewing wrapper records the three visual brewing-stand bottle positions as three
     * identical inputs. One recipe result is still one bottle, so planner quantities must model
     * one potion input plus the brewing ingredient instead of multiplying every brewing step by
     * three.
     */
    static List<Slot> normalizeBrewingInputs(String wrapperClass, List<Slot> inputs) {
        if (!VANILLA_BREWING_WRAPPER.equals(wrapperClass)
                && !CRAFTTWEAKER_BREWING_WRAPPER.equals(wrapperClass)) {
            return inputs;
        }
        if (inputs == null || inputs.size() != 4
                || !sameSemanticSlot(inputs.get(0), inputs.get(1))
                || !sameSemanticSlot(inputs.get(0), inputs.get(2))) {
            throw new IllegalArgumentException(
                    "recognized brewing wrapper no longer exposes three identical bottle slots " +
                            "followed by one brewing ingredient slot");
        }
        List<Slot> normalized = new ArrayList<Slot>(2);
        normalized.add(inputs.get(0));
        normalized.add(inputs.get(3));
        return Collections.unmodifiableList(normalized);
    }

    /**
     * ThaumicJEI 1.7.0 publishes every stack accepted by a Crucible catalyst Ingredient through
     * flat {@code setInputs}, even though its native layout consumes only the first HEI slot as
     * one rotating catalyst. Preserve that actual recipe contract by combining those item slots
     * into one interchangeable slot; aspect slots remain independent required inputs.
     */
    static List<Slot> normalizeThaumicCrucibleInputs(
            String categoryUid,
            String wrapperClass,
            List<Slot> inputs) {
        boolean categoryMatches = THAUMIC_CRUCIBLE_CATEGORY_UID.equals(categoryUid);
        boolean wrapperMatches = THAUMIC_CRUCIBLE_WRAPPER.equals(wrapperClass);
        if (!categoryMatches && !wrapperMatches) {
            return inputs;
        }
        if (!categoryMatches || !wrapperMatches) {
            throw new IllegalArgumentException(
                    "recognized ThaumicJEI Crucible category/wrapper pair no longer matches");
        }
        if (inputs == null || inputs.isEmpty()) {
            throw new IllegalArgumentException(
                    "recognized ThaumicJEI Crucible wrapper has no semantic inputs");
        }

        int firstItemSlot = -1;
        int itemSlotCount = 0;
        List<Ingredient> catalystAlternatives = new ArrayList<Ingredient>();
        for (int slotIndex = 0; slotIndex < inputs.size(); slotIndex++) {
            Slot slot = inputs.get(slotIndex);
            if (slot == null || slot.alternatives.isEmpty()) {
                throw new IllegalArgumentException(
                        "recognized ThaumicJEI Crucible wrapper has an empty input slot");
            }
            boolean hasItem = false;
            boolean hasOther = false;
            for (Ingredient alternative : slot.alternatives) {
                if (alternative.type == VanillaTypes.ITEM) hasItem = true;
                else hasOther = true;
            }
            if (hasItem && hasOther) {
                throw new IllegalArgumentException(
                        "recognized ThaumicJEI Crucible wrapper mixes item and aspect " +
                                "alternatives in one slot");
            }
            if (!hasItem) continue;
            if (firstItemSlot < 0) firstItemSlot = slotIndex;
            itemSlotCount++;
            catalystAlternatives.addAll(slot.alternatives);
        }
        if (firstItemSlot < 0) {
            throw new IllegalArgumentException(
                    "recognized ThaumicJEI Crucible wrapper has no catalyst item slot");
        }
        if (itemSlotCount == 1) {
            return inputs;
        }

        List<Slot> normalized = new ArrayList<Slot>(inputs.size() - itemSlotCount + 1);
        for (int slotIndex = 0; slotIndex < inputs.size(); slotIndex++) {
            Slot slot = inputs.get(slotIndex);
            boolean itemSlot = slot.alternatives.get(0).type == VanillaTypes.ITEM;
            if (slotIndex == firstItemSlot) {
                normalized.add(new Slot(catalystAlternatives));
            } else if (!itemSlot) {
                normalized.add(slot);
            }
        }
        return Collections.unmodifiableList(normalized);
    }

    private static boolean sameSemanticSlot(Slot left, Slot right) {
        if (left == null || right == null
                || left.alternatives.size() != right.alternatives.size()) {
            return false;
        }
        for (int index = 0; index < left.alternatives.size(); index++) {
            Ingredient leftIngredient = left.alternatives.get(index);
            Ingredient rightIngredient = right.alternatives.get(index);
            if (!leftIngredient.key.equals(rightIngredient.key)
                    || leftIngredient.amount.compareTo(rightIngredient.amount) != 0) {
                return false;
            }
        }
        return true;
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private IFocus<?> nativeLayoutFocus(
            String wrapperClass,
            CorrelatedSlots correlated,
            IFocus<?> originalFocus) {
        if (!isThermalTransposerParallelWrapper(wrapperClass)
                || correlated.selectedIndex < 0) {
            return originalFocus;
        }
        for (Slot input : correlated.inputs) {
            for (Ingredient ingredient : input.alternatives) {
                if (ingredient.type == VanillaTypes.FLUID) {
                    JeiExportMod.LOGGER.debug(
                            "[jeiexport] Recipe Tree focused Thermal Transposer native layout on " +
                                    "correlated fluid input {} so its tank and item variant agree",
                            ingredient.key);
                    return recipeRegistry.createFocus(IFocus.Mode.INPUT, ingredient.value);
                }
            }
        }
        for (Slot output : correlated.outputs) {
            for (Ingredient ingredient : output.alternatives) {
                if (ingredient.type == VanillaTypes.FLUID) {
                    JeiExportMod.LOGGER.debug(
                            "[jeiexport] Recipe Tree focused Thermal Transposer native layout on " +
                                    "correlated fluid output {} so its tank and item variant agree",
                            ingredient.key);
                    return recipeRegistry.createFocus(IFocus.Mode.OUTPUT, ingredient.value);
                }
            }
        }
        throw new IllegalArgumentException(
                "correlated Thermal Transposer recipe contains no fluid ingredient for its " +
                        "native tank focus");
    }

    static boolean isThermalTransposerParallelWrapper(String wrapperClass) {
        return THERMAL_TRANSPOSER_CONTAINER_WRAPPER.equals(wrapperClass)
                || THERMAL_TRANSPOSER_MULTI_WRAPPER.equals(wrapperClass);
    }

    private static int parallelAlternativeCardinality(
            List<Slot> inputs,
            List<Slot> outputs) {
        int cardinality = 1;
        for (Slot slot : joinedSlots(inputs, outputs)) {
            int size = slot.alternatives.size();
            if (size <= 1) continue;
            if (cardinality > 1 && cardinality != size) return -1;
            cardinality = size;
        }
        return cardinality;
    }

    private static List<Slot> joinedSlots(List<Slot> inputs, List<Slot> outputs) {
        List<Slot> joined = new ArrayList<Slot>(inputs.size() + outputs.size());
        joined.addAll(inputs);
        joined.addAll(outputs);
        return joined;
    }

    private static void collectUniqueFocusIndexes(
            List<Slot> slots,
            String focusKey,
            int cardinality,
            Set<Integer> candidates) {
        for (Slot slot : slots) {
            if (slot.alternatives.size() != cardinality) continue;
            int match = -1;
            for (int index = 0; index < cardinality; index++) {
                if (!focusKey.equals(slot.alternatives.get(index).key)) continue;
                if (match >= 0) {
                    match = -2;
                    break;
                }
                match = index;
            }
            if (match >= 0) candidates.add(match);
        }
    }

    private static List<Slot> narrowParallelSlots(
            List<Slot> slots,
            int cardinality,
            int selectedIndex) {
        List<Slot> narrowed = new ArrayList<Slot>(slots.size());
        for (Slot slot : slots) {
            if (slot.alternatives.size() == cardinality) {
                narrowed.add(new Slot(Collections.singletonList(
                        slot.alternatives.get(selectedIndex))));
            } else {
                narrowed.add(slot);
            }
        }
        return Collections.unmodifiableList(narrowed);
    }

    /** Pure deterministic helper kept package-visible for Java 8 unit tests. */
    static String semanticRecipeKey(String categoryUid, List<List<String>> inputSlots,
                                    List<List<String>> outputSlots) {
        String category = requiredText(categoryUid, "semantic recipe category UID");
        StringBuilder canonical = new StringBuilder("recipe-tree-semantic-v1;");
        appendField(canonical, category);
        appendSlots(canonical, "inputs", inputSlots);
        appendSlots(canonical, "outputs", outputSlots);
        return category + "|semantic-v1:" + sha256(canonical.toString());
    }

    static boolean isMetaCategory(String uid) {
        return "jei.information".equals(uid) || "jei:information".equals(uid) ||
                "jei.description".equals(uid) || "jei:description".equals(uid);
    }

    private static void appendSlots(StringBuilder target, String role, List<List<String>> slots) {
        if (slots == null) {
            throw new IllegalArgumentException(role + " slots must not be null");
        }
        appendField(target, role);
        target.append(slots.size()).append(';');
        for (List<String> slot : slots) {
            if (slot == null || slot.isEmpty()) {
                throw new IllegalArgumentException(role + " slot must contain alternatives");
            }
            List<String> alternatives = new ArrayList<String>(slot);
            Collections.sort(alternatives);
            target.append(alternatives.size()).append(';');
            for (String alternative : alternatives) {
                appendField(target, requiredText(alternative, role + " alternative"));
            }
        }
    }

    private static void appendField(StringBuilder target, String value) {
        target.append(value.length()).append(':').append(value).append(';');
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(64);
            for (byte next : digest) {
                result.append(String.format(Locale.ROOT, "%02x", next & 0xff));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("JVM is missing SHA-256", exception);
        }
    }

    static String ingredientPrefix(IIngredientType<?> type) {
        if (type == VanillaTypes.ITEM) {
            return "item";
        }
        if (type == VanillaTypes.FLUID) {
            return "fluid";
        }
        if (type.getIngredientClass() == EnchantmentData.class) {
            return "enchant";
        }
        String className = type.getIngredientClass().getName().toLowerCase(Locale.ROOT);
        return "custom_" + Naming.sanitize(className) + "_" + Naming.hash8(className);
    }

    private static String decimal(BigDecimal value) {
        BigDecimal normalized = value.stripTrailingZeros();
        return normalized.scale() < 0 ? normalized.setScale(0).toPlainString() :
                normalized.toPlainString();
    }

    private static String requiredText(String value, String label) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(label + " must not be null or blank");
        }
        return value.trim();
    }

    private static String identityPart(String value) {
        return value == null || value.trim().isEmpty() ? "<missing>" : value.trim();
    }

    private static RuntimeException asRuntime(String message, Throwable throwable) {
        return throwable instanceof RuntimeException ? (RuntimeException) throwable :
                new IllegalStateException(message, throwable);
    }

    private enum HelperText {
        RESOURCE_ID("resource ID"),
        DISPLAY_NAME("display name"),
        UNIQUE_ID("unique ID"),
        MOD_ID("display mod ID");

        final String label;

        HelperText(String label) {
            this.label = label;
        }
    }

    private static final class QueryKey {
        final String ingredientKey;
        final IFocus.Mode mode;

        QueryKey(String ingredientKey, IFocus.Mode mode) {
            this.ingredientKey = ingredientKey;
            this.mode = mode;
        }

        @Override
        public boolean equals(Object other) {
            if (this == other) {
                return true;
            }
            if (!(other instanceof QueryKey)) {
                return false;
            }
            QueryKey that = (QueryKey) other;
            return ingredientKey.equals(that.ingredientKey) && mode == that.mode;
        }

        @Override
        public int hashCode() {
            return 31 * ingredientKey.hashCode() + mode.hashCode();
        }
    }

    private static final class QueryResult {
        final List<RecipeGroup> groups;
        final int recipeCount;

        QueryResult(List<RecipeGroup> groups, int recipeCount) {
            this.groups = groups;
            this.recipeCount = recipeCount;
        }
    }

    private static final class LayoutResult {
        final IRecipeLayoutDrawable layout;

        LayoutResult(IRecipeLayoutDrawable layout) {
            this.layout = layout;
        }
    }

    static final class CorrelatedSlots {
        final List<Slot> inputs;
        final List<Slot> outputs;
        final int selectedIndex;
        final String failure;

        private CorrelatedSlots(
                List<Slot> inputs,
                List<Slot> outputs,
                int selectedIndex,
                String failure) {
            this.inputs = inputs;
            this.outputs = outputs;
            this.selectedIndex = selectedIndex;
            this.failure = failure;
        }

        static CorrelatedSlots unchanged(List<Slot> inputs, List<Slot> outputs) {
            return new CorrelatedSlots(inputs, outputs, -1, null);
        }

        static CorrelatedSlots applied(
                List<Slot> inputs,
                List<Slot> outputs,
                int selectedIndex) {
            return new CorrelatedSlots(inputs, outputs, selectedIndex, null);
        }

        static CorrelatedSlots failed(
                List<Slot> inputs,
                List<Slot> outputs,
                String failure) {
            return new CorrelatedSlots(inputs, outputs, -1, failure);
        }
    }

    /** Immutable typed JEI ingredient and its exact recipe quantity. */
    public static final class Ingredient {
        private final IIngredientType<?> type;
        private final Object value;
        private final String key;
        private final String displayName;
        private final BigDecimal amount;

        Ingredient(IIngredientType<?> type, Object value, String key, String displayName,
                   BigDecimal amount) {
            this.type = type;
            this.value = value;
            this.key = key;
            this.displayName = displayName;
            this.amount = amount;
        }

        static Ingredient emc(BigDecimal amount) {
            return new Ingredient(null, ProjectEEmcPhase.EMC_KEY,
                    ProjectEEmcPhase.EMC_KEY, "EMC", amount);
        }

        public boolean isEmc() {
            return ProjectEEmcPhase.EMC_KEY.equals(key);
        }

        public IIngredientType<?> getType() {
            return type;
        }

        public Object getValue() {
            return value;
        }

        public String getKey() {
            return key;
        }

        public String getDisplayName() {
            return displayName;
        }

        public BigDecimal getAmount() {
            return amount;
        }
    }

    /** One ordered recipe slot; values inside it are interchangeable JEI alternatives. */
    public static final class Slot {
        private final List<Ingredient> alternatives;

        Slot(List<Ingredient> alternatives) {
            this.alternatives = Collections.unmodifiableList(
                    new ArrayList<Ingredient>(alternatives));
        }

        public List<Ingredient> getAlternatives() {
            return alternatives;
        }
    }

    /** Semantic recipe plus opaque native-layout handles retained by this bridge. */
    public static final class Recipe {
        private final String key;
        private final String categoryUid;
        private final String categoryTitle;
        private final Ingredient catalystMachine;
        private final List<Slot> inputs;
        private final List<Slot> outputs;
        private final int width;
        private final int height;
        private final IRecipeCategory<?> category;
        private final IRecipeWrapper wrapper;
        private final IFocus<?> focus;
        private final boolean emcTransmutation;
        private final List<Ingredient> selectableAspectSources;
        private final Map<String, List<Ingredient>> aspectSourceOutputs;
        private final boolean selectedAspectSource;

        Recipe(String key, String categoryUid, String categoryTitle,
               Ingredient catalystMachine, List<Slot> inputs, List<Slot> outputs,
               int width, int height, IRecipeCategory<?> category,
               IRecipeWrapper wrapper, IFocus<?> focus) {
            this(key, categoryUid, categoryTitle, catalystMachine, inputs, outputs,
                    width, height, category, wrapper, focus, false,
                    Collections.<Ingredient>emptyList(),
                    Collections.<String, List<Ingredient>>emptyMap(), false);
        }

        private Recipe(String key, String categoryUid, String categoryTitle,
               Ingredient catalystMachine, List<Slot> inputs, List<Slot> outputs,
               int width, int height, IRecipeCategory<?> category,
               IRecipeWrapper wrapper, IFocus<?> focus, boolean emcTransmutation,
               List<Ingredient> selectableAspectSources,
               Map<String, List<Ingredient>> aspectSourceOutputs,
               boolean selectedAspectSource) {
            this.key = key;
            this.categoryUid = categoryUid;
            this.categoryTitle = categoryTitle;
            this.catalystMachine = catalystMachine;
            this.inputs = inputs;
            this.outputs = outputs;
            this.width = width;
            this.height = height;
            this.category = category;
            this.wrapper = wrapper;
            this.focus = focus;
            this.emcTransmutation = emcTransmutation;
            this.selectableAspectSources = Collections.unmodifiableList(
                    new ArrayList<Ingredient>(selectableAspectSources));
            this.aspectSourceOutputs = immutableAspectSourceOutputs(
                    aspectSourceOutputs);
            this.selectedAspectSource = selectedAspectSource;
        }

        static Recipe emc(String outputKey, Ingredient catalystMachine,
                          List<Slot> inputs, List<Slot> outputs) {
            return new Recipe("projecte:emc/" + Naming.hash8(outputKey),
                    EMC_CATEGORY_UID, EMC_CATEGORY_TITLE, catalystMachine,
                    inputs, outputs, EMC_RECIPE_WIDTH, EMC_RECIPE_HEIGHT,
                    null, null, null, true, Collections.<Ingredient>emptyList(),
                    Collections.<String, List<Ingredient>>emptyMap(), false);
        }

        static Recipe aspectSourcePage(
                String key, String categoryUid, String categoryTitle,
                Ingredient catalystMachine, List<Slot> inputs, List<Slot> outputs,
                int width, int height, IRecipeCategory<?> category,
                IRecipeWrapper wrapper, IFocus<?> focus, List<Ingredient> sources,
                Map<String, List<Ingredient>> sourceOutputs) {
            return new Recipe(key, categoryUid, categoryTitle, catalystMachine, inputs, outputs,
                    width, height, category, wrapper, focus, false, sources,
                    sourceOutputs, false);
        }

        public Recipe selectAspectSource(Ingredient source) {
            if (!isAspectSourcePage() || source == null) return null;
            boolean found = false;
            for (Ingredient candidate : selectableAspectSources) {
                if (candidate.key.equals(source.key)
                        && candidate.amount.compareTo(source.amount) == 0) {
                    source = candidate;
                    found = true;
                    break;
                }
            }
            if (!found) return null;
            // ThaumicJEI reports the aspect value on each selectable item input. In the
            // planner that value is the recipe yield, not the number of items consumed.
            // One selected item therefore produces source.amount aspects.
            Ingredient selectedInput = withAmount(source, BigDecimal.ONE);
            Ingredient aspectOutput = withAmount(
                    outputs.get(0).alternatives.get(0), source.amount);
            List<Slot> selectedInputs = Collections.singletonList(
                    new Slot(Collections.singletonList(selectedInput)));
            List<Slot> selectedOutputs = new ArrayList<Slot>();
            selectedOutputs.add(new Slot(Collections.singletonList(aspectOutput)));
            for (Ingredient byproduct : getAspectSourceByproducts(source)) {
                selectedOutputs.add(new Slot(Collections.singletonList(byproduct)));
            }
            // Keep the stable key based on ThaumicJEI's original semantic values so histories
            // written before this quantity correction continue to resolve.
            String selectedKey = aspectSourceKey(Collections.singletonList(
                    new Slot(Collections.singletonList(source))));
            return new Recipe(selectedKey, categoryUid, categoryTitle, catalystMachine,
                    selectedInputs, selectedOutputs, THAUMIC_ASPECT_SOURCE_RECIPE_WIDTH,
                    THAUMIC_ASPECT_SOURCE_RECIPE_HEIGHT, category, wrapper, focus, false,
                    Collections.<Ingredient>emptyList(),
                    Collections.<String, List<Ingredient>>emptyMap(), true);
        }

        static String aspectSourceIdentity(Ingredient source) {
            return source.key + "\u0000" + decimal(source.amount);
        }

        public List<Ingredient> getAspectSourceByproducts(Ingredient source) {
            List<Ingredient> result = new ArrayList<Ingredient>();
            String primaryKey = outputs.get(0).alternatives.get(0).key;
            for (Ingredient aspect : getAspectSourceOutputs(source)) {
                if (!primaryKey.equals(aspect.key)) result.add(aspect);
            }
            return Collections.unmodifiableList(result);
        }

        public List<Ingredient> getAspectSourceOutputs(Ingredient source) {
            if (source == null) return Collections.emptyList();
            List<Ingredient> result = aspectSourceOutputs.get(aspectSourceIdentity(source));
            return result == null ? Collections.<Ingredient>emptyList() : result;
        }

        private static Map<String, List<Ingredient>> immutableAspectSourceOutputs(
                Map<String, List<Ingredient>> source) {
            Map<String, List<Ingredient>> result =
                    new LinkedHashMap<String, List<Ingredient>>();
            if (source != null) {
                for (Map.Entry<String, List<Ingredient>> entry : source.entrySet()) {
                    List<Ingredient> values = entry.getValue() == null
                            ? Collections.<Ingredient>emptyList() : entry.getValue();
                    result.put(entry.getKey(), Collections.unmodifiableList(
                            new ArrayList<Ingredient>(values)));
                }
            }
            return Collections.unmodifiableMap(result);
        }

        private static Ingredient withAmount(Ingredient ingredient, BigDecimal amount) {
            return new Ingredient(ingredient.type, ingredient.value, ingredient.key,
                    ingredient.displayName, amount);
        }

        public Recipe resolveAspectSource(String selectedKey) {
            if (!isAspectSourcePage() || selectedKey == null) return null;
            for (Ingredient source : selectableAspectSources) {
                List<Slot> selectedInputs = Collections.singletonList(
                        new Slot(Collections.singletonList(source)));
                if (selectedKey.equals(aspectSourceKey(selectedInputs))) {
                    return selectAspectSource(source);
                }
            }
            return null;
        }

        private String aspectSourceKey(List<Slot> selectedInputs) {
            return semanticRecipeKey(
                    categoryUid, semanticSlots(selectedInputs), semanticSlots(outputs));
        }

        public String getKey() {
            return key;
        }

        public String getCategoryUid() {
            return categoryUid;
        }

        public String getCategoryTitle() {
            return categoryTitle;
        }

        public Ingredient getCatalystMachine() {
            return catalystMachine;
        }

        public List<Slot> getInputs() {
            return inputs;
        }

        public List<Slot> getOutputs() {
            return outputs;
        }

        public int getWidth() {
            return width;
        }

        public int getHeight() {
            return height;
        }

        public boolean isEmcTransmutation() {
            return emcTransmutation;
        }

        public boolean isAspectSourcePage() {
            return !selectableAspectSources.isEmpty();
        }

        public boolean isSelectedAspectSource() {
            return selectedAspectSource;
        }

        public List<Ingredient> getSelectableAspectSources() {
            return selectableAspectSources;
        }
    }

    /** Natural JEI category grouping for focused planner results. */
    public static final class RecipeGroup {
        private final String categoryUid;
        private final String categoryTitle;
        private final Ingredient catalystMachine;
        private final List<Recipe> recipes;

        private RecipeGroup(String categoryUid, String categoryTitle,
                            Ingredient catalystMachine, List<Recipe> recipes) {
            this.categoryUid = categoryUid;
            this.categoryTitle = categoryTitle;
            this.catalystMachine = catalystMachine;
            this.recipes = Collections.unmodifiableList(new ArrayList<Recipe>(recipes));
        }

        public String getCategoryUid() {
            return categoryUid;
        }

        public String getCategoryTitle() {
            return categoryTitle;
        }

        public Ingredient getCatalystMachine() {
            return catalystMachine;
        }

        public List<Recipe> getRecipes() {
            return recipes;
        }
    }
}
