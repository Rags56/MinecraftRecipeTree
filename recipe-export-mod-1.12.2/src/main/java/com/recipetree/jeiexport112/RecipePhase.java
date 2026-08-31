package com.recipetree.jeiexport112;

import com.google.gson.stream.JsonWriter;
import com.recipetree.jeiexport112.compat.MultiblockedScissorBridge;
import mezz.jei.api.IRecipeRegistry;
import mezz.jei.api.gui.IDrawable;
import mezz.jei.api.gui.IRecipeLayoutDrawable;
import mezz.jei.api.ingredients.IIngredientRegistry;
import mezz.jei.api.recipe.IFocus;
import mezz.jei.api.recipe.IIngredientType;
import mezz.jei.api.recipe.IRecipeCategory;
import mezz.jei.api.recipe.IRecipeWrapper;
import mezz.jei.api.recipe.wrapper.ICraftingRecipeWrapper;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.renderer.GlStateManager;
import net.minecraft.init.Blocks;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.fluids.FluidStack;

import java.awt.image.BufferedImage;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class RecipePhase implements ExportPhase {
    private static final int PAD = 4;
    private static final int BACKGROUND_ARGB = 0xffc6c6c6;

    private final ExportContext context;
    private final IRecipeRegistry recipeRegistry;
    private final IIngredientRegistry ingredientRegistry;
    private final ItemCatalog catalog;
    private final List<IRecipeCategory> categories;
    private final IFocus<?> renderFocus;
    private final int scaledScreenWidth;
    private int categoryCursor;
    private IRecipeCategory currentCategory;
    private List<IRecipeWrapper> currentRecipes = Collections.emptyList();
    private int recipeCursor;
    private List<Integer> sampledSourceIndexes = Collections.emptyList();
    private int sampledSourceCursor;
    private int registeredCategory = -1;
    private String currentDirectory;
    private String currentTitle = "";
    private JsonWriter recipesWriter;
    private int exportedTotal;
    private int currentCatalystCount;
    private int currentExportedCount;
    private ExportContext.CategoryMeta currentCategoryMeta;

    @SuppressWarnings("unchecked")
    RecipePhase(ExportContext context, IRecipeRegistry recipeRegistry, IIngredientRegistry ingredientRegistry)
            throws IOException {
        this.context = context;
        this.recipeRegistry = recipeRegistry;
        this.ingredientRegistry = ingredientRegistry;
        this.catalog = context.catalog(ingredientRegistry);
        List<IRecipeCategory> selectedCategories = new ArrayList<IRecipeCategory>();
        Map<String, IRecipeCategory> sampledCategories =
                new LinkedHashMap<String, IRecipeCategory>();
        for (IRecipeCategory category : (List<IRecipeCategory>) recipeRegistry.getRecipeCategories()) {
            String uid;
            try {
                uid = category.getUid();
            } catch (Throwable throwable) {
                FatalErrors.rethrowIfFatal(throwable);
                context.failure("reading category id while filtering: " + throwable + "; retaining category");
                uid = null;
            }
            if ("jei.information".equals(uid) || "jei:information".equals(uid)
                    || "jei.description".equals(uid) || "jei:description".equals(uid)) {
                JeiExportMod.LOGGER.info("[jeiexport] Skipping HEI metadata category {}", uid);
            } else if (context.request.qualitySample == null ||
                    context.request.qualitySample.includesCategory(uid)) {
                if (context.request.qualitySample == null) {
                    selectedCategories.add(category);
                } else if (sampledCategories.put(uid, category) != null) {
                    throw new IOException("Quality sample category " + uid +
                            " occurs more than once in HEI");
                }
            }
        }

        if (context.request.qualitySample != null) {
            Set<String> missing = new LinkedHashSet<String>(context.request.qualitySample.categoryUids());
            missing.removeAll(sampledCategories.keySet());
            if (!missing.isEmpty()) {
                throw new IOException("Quality sample categories are absent from HEI: " + missing);
            }
            for (String categoryUid : context.request.qualitySample.categoryUids()) {
                selectedCategories.add(sampledCategories.get(categoryUid));
            }
        }
        this.categories = selectedCategories;

        ItemStack sentinel = new ItemStack(Blocks.BARRIER, 1, Short.MAX_VALUE);
        NBTTagCompound sentinelTag = new NBTTagCompound();
        sentinelTag.setBoolean("jeiexport_nonmatching_focus", true);
        sentinel.setTagCompound(sentinelTag);
        this.renderFocus = recipeRegistry.createFocus(IFocus.Mode.INPUT, sentinel);
        if (renderFocus == null) {
            throw new IOException("HEI returned a null focus for the nonmatching render sentinel");
        }
        this.scaledScreenWidth = new ScaledResolution(Minecraft.getMinecraft()).getScaledWidth();
        if (scaledScreenWidth <= 0) {
            throw new IOException("Minecraft reported invalid scaled screen width " +
                    scaledScreenWidth + " before recipe capture");
        }
        JeiExportMod.LOGGER.info("[jeiexport] Recipe phase: {} HEI categories after metadata-only filter",
                categories.size());
    }

    @Override
    public boolean step() throws IOException {
        if (currentCategory == null || currentCategoryComplete()) {
            closeCurrentCategory();
            if (categoryCursor >= categories.size()) {
                verifyQualitySampleComplete();
                return true;
            }
            beginCategory(categories.get(categoryCursor++));
            return false;
        }

        int sourceIndex;
        if (context.request.qualitySample == null) {
            sourceIndex = recipeCursor++;
        } else {
            sourceIndex = sampledSourceIndexes.get(sampledSourceCursor++);
            recipeCursor = sourceIndex + 1;
        }
        int exportedIndex = currentExportedCount;
        IRecipeWrapper recipe = currentRecipes.get(sourceIndex);
        RecipeData data = new RecipeData();
        ResourceLocation registryName = registryName(recipe);
        if (registryName != null) {
            data.id = registryName.toString();
        }
        RecipeDuration.ticks(recipe).ifPresent(value -> data.durationTicks = value);

        int semanticFailuresBefore = context.failureCount();
        try {
            collectSemantics(recipe, data, sourceIndex);
        } catch (IOException e) {
            throw e;
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            if (context.request.qualitySample != null) {
                throw new IOException("Quality sample recipe semantics " + safeCurrentUid() + " #" +
                        sourceIndex + " failed", throwable);
            }
            data.error = true;
            context.failure("recipe semantics " + safeCurrentUid() + " #" + sourceIndex + ": " + throwable);
        }

        if (!data.error) {
            data.structure = extractModularMachineryStructure(recipe, sourceIndex);
        }

        if (data.excluded) {
            if (context.request.qualitySample != null) {
                throw new IOException("Quality sample selected excluded recipe " + safeCurrentUid() +
                        " #" + sourceIndex);
            }
            data.usedKeys.clear();
            data.outputKeys.clear();
            return false;
        }
        if (context.request.qualitySample != null && data.error) {
            throw new IOException("Quality sample recipe semantics " + safeCurrentUid() + " #" +
                    sourceIndex + " were marked erroneous");
        }
        if (context.request.qualitySample != null &&
                context.failureCount() != semanticFailuresBefore) {
            throw new IOException("Quality sample recipe semantics " + safeCurrentUid() + " #" +
                    sourceIndex + " recorded " +
                    (context.failureCount() - semanticFailuresBefore) + " failure event(s)");
        }

        try {
            renderRecipe(currentCategory, recipe, data, sourceIndex, exportedIndex);
        } catch (RecipeLayoutCompatibility.DriftException e) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Recipe-layout compatibility contract drifted; aborting instead of " +
                            "silently exporting a missing or fabricated preview: {}", e.getMessage());
            throw e;
        } catch (IOException e) {
            if (context.request.qualitySample != null) {
                throw new IOException("Quality sample recipe image " + safeCurrentUid() + " #" +
                        sourceIndex + " failed", e);
            }
            context.failure("recipe image " + safeCurrentUid() + " #" + exportedIndex +
                    " cause=" + describeCauseChain(e));
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            if (context.request.qualitySample != null) {
                throw new IOException("Quality sample recipe image " + safeCurrentUid() + " #" +
                        sourceIndex + " failed", throwable);
            }
            context.failure("recipe image " + safeCurrentUid() + " #" + exportedIndex +
                    " cause=" + describeCauseChain(throwable));
        }
        if (context.request.qualitySample != null &&
                (data.image == null || data.image.isEmpty() || data.width <= 0 || data.height <= 0)) {
            throw new IOException("Quality sample recipe image " + safeCurrentUid() + " #" +
                    sourceIndex + " is missing or has invalid logical dimensions");
        }

        writeRecipe(data);
        for (String key : data.usedKeys) {
            context.index(key, false, registeredCategory, exportedIndex);
        }
        for (String key : data.outputKeys) {
            context.index(key, true, registeredCategory, exportedIndex);
        }
        currentExportedCount++;
        currentCategoryMeta.count = currentExportedCount;
        context.recipeCount++;
        exportedTotal++;
        if (exportedTotal % 1000 == 0) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Recipes progress: {} total, category {}/{} {} {}/{} (PNG pending {})",
                    exportedTotal, categoryCursor, categories.size(), currentTitle, recipeCursor,
                    currentRecipes.size(), context.pngWriter.getPending());
        }
        return false;
    }

    private ModularMachineryStructure.Data extractModularMachineryStructure(
            IRecipeWrapper recipe, int sourceIndex) throws IOException {
        String categoryUid = safeCurrentUid();
        if (!ModularMachineryStructure.isPreviewCategory(categoryUid)) {
            return null;
        }
        context.recordModularMachineryStructurePreview();
        try {
            ModularMachineryStructure.Data structure = ModularMachineryStructure.extract(
                    categoryUid, recipe, catalog);
            if (structure == null) {
                throw new IOException("extractor returned no structure");
            }
            context.recordModularMachineryStructureSuccess();
            return structure;
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            context.recordModularMachineryStructureFailure();
            String diagnostic = "MODULAR_MACHINERY_STRUCTURE_EXPORT_FAILED category=" +
                    categoryUid + " sourceIndex=" + sourceIndex + " wrapper=" +
                    recipe.getClass().getName() + " cause=" + describeCauseChain(throwable);
            if (context.request.qualitySample != null) {
                throw new IOException(diagnostic, throwable);
            }
            context.failure(diagnostic);
            return null;
        }
    }

    private static String describeCauseChain(Throwable throwable) {
        StringBuilder message = new StringBuilder();
        Throwable current = throwable;
        int depth = 0;
        while (current != null && depth < 8) {
            if (depth > 0) message.append(" <- ");
            message.append(current.getClass().getName());
            String detail = current.getMessage();
            if (detail != null && !detail.trim().isEmpty()) {
                message.append(": ").append(detail.trim());
            }
            Throwable next = current.getCause();
            if (next == current) break;
            current = next;
            depth++;
        }
        return message.toString();
    }

    @SuppressWarnings("unchecked")
    private void beginCategory(IRecipeCategory category) throws IOException {
        currentCategory = category;
        String uid = safeCategoryUid(category);
        currentDirectory = context.uniqueCategoryDirectory(uid);
        try {
            currentTitle = Naming.plainText(category.getTitle());
            if (currentTitle == null || currentTitle.trim().isEmpty()) {
                context.failure("category title " + uid +
                        " was null/blank after formatting-code removal; using category id");
                currentTitle = uid;
            }
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            context.failure("category title " + uid + ": " + throwable + "; using category id");
            currentTitle = uid;
        }
        try {
            currentRecipes = new ArrayList<IRecipeWrapper>(recipeRegistry.getRecipeWrappers(category));
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            if (context.request.qualitySample != null) {
                throw new IOException("Quality sample could not enumerate recipes for " + uid, throwable);
            }
            context.failure("category recipes " + uid + ": " + throwable);
            currentRecipes = Collections.emptyList();
        }
        if (context.request.qualitySample != null) {
            List<String> sourceRecipeIds = null;
            if (context.request.qualitySample.requiresRecipeIds(uid)) {
                sourceRecipeIds = new ArrayList<String>(currentRecipes.size());
                for (int sourceIndex = 0; sourceIndex < currentRecipes.size(); sourceIndex++) {
                    try {
                        ResourceLocation sourceRecipeId = registryName(currentRecipes.get(sourceIndex));
                        sourceRecipeIds.add(sourceRecipeId == null ? null : sourceRecipeId.toString());
                    } catch (Throwable throwable) {
                        FatalErrors.rethrowIfFatal(throwable);
                        throw new IOException("Quality sample could not read registry name for " + uid +
                                " HEI source recipe #" + sourceIndex, throwable);
                    }
                }
            }
            sampledSourceIndexes = context.request.qualitySample.resolveSourceIndexes(
                    uid, currentRecipes.size(), sourceRecipeIds);
            sampledSourceCursor = 0;
        }
        recipeCursor = 0;
        currentExportedCount = 0;
        Path recipesFile = context.root.resolve(currentDirectory).resolve("recipes.json");
        recipesWriter = ExportContext.jsonWriter(recipesFile);
        recipesWriter.beginArray();

        ExportContext.CategoryMeta meta = new ExportContext.CategoryMeta(
                uid, currentTitle, currentDirectory, 0);
        currentCategoryMeta = meta;
        try {
            meta.icon = renderCategoryIcon(category);
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            context.failure("category icon " + uid + ": " + throwable);
        }

        currentCatalystCount = 0;
        try {
            Collection<Object> catalysts = recipeRegistry.getRecipeCatalysts(category);
            List<ItemCatalog.ResolvedIngredient<?>> resolvedCatalysts =
                    new ArrayList<ItemCatalog.ResolvedIngredient<?>>(catalysts.size());
            for (Object catalyst : catalysts) {
                if (catalyst == null) {
                    continue;
                }
                try {
                    resolvedCatalysts.add(catalog.resolveUnknown(catalyst));
                } catch (Throwable throwable) {
                    FatalErrors.rethrowIfFatal(throwable);
                    context.failure("category catalyst identity " + uid + ": " + throwable);
                }
            }
            CanonicalKeyOrdering.sortAndValidate(resolvedCatalysts);

            Set<String> alternatives = new LinkedHashSet<String>();
            for (ItemCatalog.ResolvedIngredient<?> catalyst : resolvedCatalysts) {
                try {
                    String key = catalog.ensureResolved(catalyst);
                    if (alternatives.add(key)) {
                        meta.catalysts.add(key);
                    }
                } catch (IOException e) {
                    throw e;
                } catch (Throwable throwable) {
                    FatalErrors.rethrowIfFatal(throwable);
                    context.failure("category catalyst emission " + uid + " " +
                            catalyst.key() + ": " + throwable);
                }
            }
            currentCatalystCount = alternatives.size();
        } catch (IOException e) {
            throw e;
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            context.failure("category catalysts " + uid + ": " + throwable);
        }
        registeredCategory = context.addCategory(meta);
        JeiExportMod.LOGGER.info("[jeiexport] Category {}/{}: {} ({}) recipes={}, catalysts={}",
                categoryCursor, categories.size(), currentTitle, uid, currentRecipes.size(),
                currentCatalystCount);
    }

    private boolean currentCategoryComplete() {
        return context.request.qualitySample == null
                ? recipeCursor >= currentRecipes.size()
                : sampledSourceCursor >= sampledSourceIndexes.size();
    }

    private void collectSemantics(IRecipeWrapper wrapper, RecipeData data, int recipeIndex) throws IOException {
        RecordingIngredients recording = new RecordingIngredients(ingredientRegistry);
        wrapper.getIngredients(recording);
        convertRecorded(recording.allInputs(), data, data.inputs, data.usedKeys, recipeIndex, "input");
        convertRecorded(recording.allOutputs(), data, data.outputs, data.outputKeys, recipeIndex, "output");
        String categoryUid = safeCurrentUid();
        coalesceFlattenedLogicalAlternatives(data.inputs, categoryUid);
        coalesceFlattenedLogicalAlternatives(data.catalysts, categoryUid);
        promoteReturnedIngredients(data);
        rebuildIndexKeys(data);
    }

    private void convertRecorded(Map<IIngredientType<?>, List<List<?>>> recorded,
                                 RecipeData data, List<SlotData> target, Set<String> indexKeys,
                                 int recipeIndex, String role) throws IOException {
        for (Map.Entry<IIngredientType<?>, List<List<?>>> typeEntry : recorded.entrySet()) {
            IIngredientType<?> type = typeEntry.getKey();
            for (List<?> alternatives : typeEntry.getValue()) {
                OreDictionarySlotIdentity.Resolution oreIdentity =
                        "input".equals(role)
                                ? OreDictionarySlotIdentity.resolve(alternatives)
                                : OreDictionarySlotIdentity.Resolution.none();
                if (oreIdentity.isAmbiguous()) {
                    JeiExportMod.LOGGER.warn(
                            "[jeiexport] Recipe {} #{} input slot shares multiple OreDictionary " +
                                    "names {}; publishing deterministic identity {}",
                            safeCurrentUid(), recipeIndex, oreIdentity.sharedNames,
                            oreIdentity.identity);
                }
                LinkedHashMap<String, IngredientPair> unique = new LinkedHashMap<String, IngredientPair>();
                LinkedHashMap<String, IngredientPair> nonConsumed =
                        new LinkedHashMap<String, IngredientPair>();
                LinkedHashMap<String, IngredientPair> retained =
                        new LinkedHashMap<String, IngredientPair>();
                LinkedHashMap<String, RetentionData> retainedDetails =
                        new LinkedHashMap<String, RetentionData>();
                for (Object ingredient : alternatives) {
                    if (ingredient == null) {
                        continue;
                    }
                    try {
                        BigDecimal amount = IngredientQuantity.amount(ingredient, context);
                        if (amount.signum() == 0) {
                            String uid = safeCurrentUid();
                            String className = type.getIngredientClass().getName();
                            ZeroQuantityPolicy.Decision decision =
                                    ZeroQuantityPolicy.classify(
                                            uid, role, className,
                                            hasMatchingPositiveFluidAlternative(ingredient, alternatives));
                            if (decision.kind == ZeroQuantityPolicy.Kind.UNSUPPORTED) {
                                throw new UnclassifiedZeroQuantityException(
                                        decision.diagnosticCode + " " +
                                        decision.explanation + "; category=" + uid +
                                        "; role=" + role + "; ingredientClass=" + className);
                            }
                            context.recordZeroQuantityDecision(decision, role, uid, recipeIndex,
                                    type.getIngredientClass());
                            if (decision.kind == ZeroQuantityPolicy.Kind.ABSENT_OUTPUT
                                    || decision.kind == ZeroQuantityPolicy.Kind.ABSENT_ALTERNATIVE) {
                                continue;
                            }
                            if (decision.kind == ZeroQuantityPolicy.Kind.INVALID_RECIPE) {
                                data.excluded = true;
                                continue;
                            }
                            String key = ensureRaw(type, ingredient);
                            IngredientPair pair = new IngredientPair(key, decision.publishedAmount);
                            if (decision.kind == ZeroQuantityPolicy.Kind.NON_CONSUMED) {
                                nonConsumed.put(pair.identity(), pair);
                                data.usedKeys.add(key);
                            } else {
                                unique.put(pair.identity(), pair);
                                indexKeys.add(key);
                            }
                            continue;
                        }
                        String key = ensureRaw(type, ingredient);
                        IngredientPair pair = new IngredientPair(key, amount);
                        RetentionData retention = "input".equals(role)
                                ? craftingRetention(ingredient, key, recipeIndex)
                                : null;
                        if (retention == null) {
                            unique.put(pair.identity(), pair);
                        } else {
                            retained.put(pair.identity(), pair);
                            retainedDetails.put(key, retention);
                        }
                        indexKeys.add(key);
                    } catch (IOException e) {
                        throw e;
                    } catch (UnclassifiedZeroQuantityException exception) {
                        throw exception;
                    } catch (Throwable throwable) {
                        FatalErrors.rethrowIfFatal(throwable);
                        String message = "recipe " + role + " ingredient " + safeCurrentUid() + " #" +
                                recipeIndex + " type " + type.getIngredientClass().getName();
                        if (context.request.qualitySample != null) {
                            throw new IOException("Quality sample " + message + " failed", throwable);
                        }
                        context.failure(message + ": " + throwable);
                    }
                }
                if (!unique.isEmpty() && !nonConsumed.isEmpty()) {
                    throw new IllegalStateException("HEI mixed consumed and non-consumed alternatives in one " +
                            role + " slot for " + safeCurrentUid() + " #" + recipeIndex);
                }
                if (!unique.isEmpty() && !retained.isEmpty()) {
                    // An alternatives slot is an OR relationship. Splitting it into a consumed
                    // slot and a retained slot would turn it into an AND, so preserve the whole
                    // mixed slot as consumed rather than publishing incorrect requirements.
                    unique.putAll(retained);
                    retained.clear();
                    retainedDetails.clear();
                }
                if (!unique.isEmpty()) {
                    SlotData slot = new SlotData();
                    slot.logicalIdentity = oreIdentity.identity;
                    slot.pairs.addAll(unique.values());
                    target.add(slot);
                }
                if (!nonConsumed.isEmpty()) {
                    SlotData slot = new SlotData();
                    slot.logicalIdentity = oreIdentity.identity;
                    slot.pairs.addAll(nonConsumed.values());
                    data.catalysts.add(slot);
                }
                if (!retained.isEmpty()) {
                    SlotData slot = new SlotData();
                    slot.logicalIdentity = oreIdentity.identity;
                    slot.pairs.addAll(retained.values());
                    data.catalysts.add(slot);
                    data.retained.putAll(retainedDetails);
                }
            }
        }
    }

    private RetentionData craftingRetention(Object ingredient, String key, int recipeIndex) {
        if (!(ingredient instanceof ItemStack)) {
            return null;
        }
        ItemStack input = (ItemStack) ingredient;
        try {
            if (input.isEmpty() || !input.getItem().hasContainerItem(input)) {
                return null;
            }
            ItemStack returned = input.getItem().getContainerItem(input);
            if (returned.isEmpty() || returned.getItem() != input.getItem()) {
                return null;
            }
            int damagePerCraft = returned.getItemDamage() - input.getItemDamage();
            if (damagePerCraft > 0 && input.isItemStackDamageable()) {
                int remainingDurability = Math.max(1, input.getMaxDamage() - input.getItemDamage());
                int uses = Math.max(1, remainingDurability / damagePerCraft);
                return RetentionData.durability(uses);
            }
            return RetentionData.reusable();
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            context.failure("recipe retained ingredient " + safeCurrentUid() + " #" +
                    recipeIndex + " " + key + ": " + throwable);
            return null;
        }
    }

    /**
     * NuclearCraft chance-fluid outputs encode the no-result branch as a zero-volume FluidStack
     * beside one or more positive alternatives. FluidStack#isFluidEqual compares fluid and NBT
     * while deliberately ignoring amount, which is the exact identity relation needed here.
     */
    static boolean hasMatchingPositiveFluidAlternative(Object ingredient, List<?> alternatives) {
        if (!(ingredient instanceof FluidStack) || alternatives == null) {
            return false;
        }
        FluidStack zero = (FluidStack) ingredient;
        for (Object candidate : alternatives) {
            if (candidate instanceof FluidStack) {
                FluidStack sibling = (FluidStack) candidate;
                if (sibling.amount > 0 && zero.isFluidEqual(sibling)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Some 1.12 HEI wrappers publish one OreDictionary choice as a flat A, B, C slot run.
     * Reconstruct one alternative slot, while preserving repeated requirements such as
     * A, B, A, B as two slots that each accept A or B.
     */
    static void coalesceFlattenedLogicalAlternatives(List<SlotData> slots, String categoryUid) {
        if (usesPositionalIngredientSlots(categoryUid)) {
            return;
        }
        for (int start = 0; start < slots.size(); ) {
            String identity = slots.get(start).logicalIdentity;
            if (identity == null) {
                start++;
                continue;
            }
            int end = start + 1;
            while (end < slots.size() && identity.equals(slots.get(end).logicalIdentity)) {
                end++;
            }
            if (end - start < 2) {
                start = end;
                continue;
            }

            List<SlotData> run = new ArrayList<SlotData>(slots.subList(start, end));
            int period = repeatedSlotPeriod(run);
            int alternativesLength = period == 0 ? run.size() : period;
            SlotData alternatives = mergeSlots(run.subList(0, alternativesLength), identity);
            int requirements = period == 0 ? 1 : run.size() / period;
            slots.subList(start, end).clear();
            for (int index = 0; index < requirements; index++) {
                slots.add(start + index, copySlot(alternatives));
            }
            start += requirements;
        }
    }

    /**
     * Avaritia's 9x9 recipe wrapper publishes each occupied grid position as an independent
     * singleton. Broad OreDictionary names such as listAllFood describe the accepted family for
     * each position; they do not turn adjacent positions into one choose-one ingredient.
     *
     * The historical category id is misspelled "Avatitia" in released 1.12 packs. Accept the
     * corrected spelling as well so the guard remains valid if a fork repairs the id.
     */
    static boolean usesPositionalIngredientSlots(String categoryUid) {
        return "Avatitia.Extreme".equalsIgnoreCase(categoryUid)
                || "Avaritia.Extreme".equalsIgnoreCase(categoryUid);
    }

    private static int repeatedSlotPeriod(List<SlotData> slots) {
        for (int period = 1; period <= slots.size() / 2; period++) {
            if (slots.size() % period != 0) {
                continue;
            }
            boolean matches = true;
            for (int index = period; index < slots.size(); index++) {
                if (!slotSignature(slots.get(index)).equals(slotSignature(slots.get(index % period)))) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return period;
            }
        }
        return 0;
    }

    private static SlotData mergeSlots(List<SlotData> slots, String identity) {
        SlotData merged = new SlotData();
        merged.logicalIdentity = identity;
        Set<String> seen = new LinkedHashSet<String>();
        for (SlotData slot : slots) {
            for (IngredientPair pair : slot.pairs) {
                if (seen.add(pair.identity())) {
                    merged.pairs.add(pair);
                }
            }
        }
        return merged;
    }

    private static SlotData copySlot(SlotData source) {
        SlotData copy = new SlotData();
        copy.logicalIdentity = source.logicalIdentity;
        copy.pairs.addAll(source.pairs);
        return copy;
    }

    private static String slotSignature(SlotData slot) {
        List<String> identities = new ArrayList<String>();
        for (IngredientPair pair : slot.pairs) {
            identities.add(pair.identity());
        }
        Collections.sort(identities);
        StringBuilder signature = new StringBuilder();
        for (String identity : identities) {
            signature.append(identity).append('\u0002');
        }
        return signature.toString();
    }

    /** Move an input returned unchanged by the recipe into a retained one-item prerequisite. */
    static void promoteReturnedIngredients(RecipeData data) {
        for (int inputIndex = data.inputs.size() - 1; inputIndex >= 0; inputIndex--) {
            SlotData input = data.inputs.get(inputIndex);
            int outputIndex = equivalentSlotIndex(data.outputs, input);
            if (outputIndex < 0) {
                continue;
            }
            data.inputs.remove(inputIndex);
            data.outputs.remove(outputIndex);
            if (equivalentSlotIndex(data.catalysts, input) < 0) {
                data.catalysts.add(copySlot(input));
            }
            for (IngredientPair pair : input.pairs) {
                data.retained.put(pair.key, RetentionData.reusable());
            }
        }
    }

    private static int equivalentSlotIndex(List<SlotData> slots, SlotData expected) {
        String signature = slotSignature(expected);
        for (int index = 0; index < slots.size(); index++) {
            if (signature.equals(slotSignature(slots.get(index)))) {
                return index;
            }
        }
        return -1;
    }

    private static void rebuildIndexKeys(RecipeData data) {
        data.usedKeys.clear();
        data.outputKeys.clear();
        addSlotKeys(data.inputs, data.usedKeys);
        addSlotKeys(data.catalysts, data.usedKeys);
        addSlotKeys(data.outputs, data.outputKeys);
    }

    private static void addSlotKeys(List<SlotData> slots, Set<String> keys) {
        for (SlotData slot : slots) {
            for (IngredientPair pair : slot.pairs) {
                keys.add(pair.key);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private <T> String ensureRaw(IIngredientType<?> type, Object ingredient) throws IOException {
        return catalog.ensure((IIngredientType<T>) type, (T) ingredient);
    }

    @SuppressWarnings("unchecked")
    private void renderRecipe(IRecipeCategory category, IRecipeWrapper wrapper, RecipeData data,
                              int sourceIndex, int exportedIndex)
            throws Exception {
        RecipeLayoutCompatibility.Prepared compatibility = RecipeLayoutCompatibility.prepare(
                category, wrapper, sourceIndex, exportedIndex);
        final IRecipeLayoutDrawable layout;
        try {
            layout = recipeRegistry.createRecipeLayoutDrawable(
                    compatibility.category(), wrapper, renderFocus);
        } catch (RuntimeException error) {
            compatibility.rethrowDriftIfPresent(error);
            throw error;
        }
        compatibility.rethrowDriftIfPresent(null);
        if (layout == null) {
            throw new IOException("HEI returned a null recipe layout");
        }
        compatibility.recordApplied(context);
        IDrawable background = category.getBackground();
        if (background == null) {
            throw new IOException("HEI category " + safeCurrentUid() +
                    " returned a null recipe background");
        }
        int backgroundWidth = background.getWidth();
        int backgroundHeight = background.getHeight();
        final RecipeLayoutPlacementPolicy.Placement placement;
        try {
            placement = RecipeLayoutPlacementPolicy.plan(
                    category.getUid(), category.getClass().getName(), wrapper.getClass().getName(),
                    backgroundWidth, backgroundHeight, scaledScreenWidth, PAD);
        } catch (IllegalStateException drift) {
            throw new RecipeLayoutCompatibility.DriftException(
                    drift.getMessage() + "; category=" + safeCurrentUid() +
                            ", categoryClass=" + category.getClass().getName() +
                            ", wrapperClass=" + wrapper.getClass().getName() +
                            ", sourceIndex=" + sourceIndex +
                            ", exportedIndex=" + exportedIndex,
                    drift);
        }
        if (placement.repositionsLayout()) {
            layout.setPosition(placement.layoutX, placement.layoutY);
        }
        int logicalWidth = backgroundWidth + PAD * 2;
        int logicalHeight = backgroundHeight + PAD * 2;
        int textureLimit = context.renderer.getMaxTextureSize();
        if (logicalWidth > textureLimit || logicalHeight > textureLimit) {
            throw new IOException("logical layout " + logicalWidth + "x" + logicalHeight +
                    " exceeds GL_MAX_TEXTURE_SIZE=" + textureLimit + " even at scale 1");
        }
        int maxScale = textureLimit / Math.max(logicalWidth, logicalHeight);
        final int scale = Math.min(context.request.recipeScale, maxScale);
        if (scale < context.request.recipeScale) {
            if (context.request.qualitySample != null) {
                throw new IOException("Quality sample recipe " + safeCurrentUid() + " #" + sourceIndex +
                        " requires scale " + context.request.recipeScale + " but GL_MAX_TEXTURE_SIZE=" +
                        textureLimit + " permits only scale " + scale);
            }
            context.failure("recipe " + safeCurrentUid() + " #" + exportedIndex + " scale reduced from " +
                    context.request.recipeScale + " to " + scale + " for GL texture limit " + textureLimit);
        }
        final int targetWidth = logicalWidth * scale;
        final int targetHeight = logicalHeight * scale;
        final IRecipeLayoutDrawable finalLayout = layout;
        final int[] correctedScissorCalls = {0};
        BufferedImage image = context.renderer.render(
                targetWidth, targetHeight, BACKGROUND_ARGB, minecraft -> {
                    GlStateManager.pushMatrix();
                    try {
                        GlStateManager.scale(scale, scale, 1.0F);
                        GlStateManager.translate(
                                placement.translateX, placement.translateY, 0.0F);
                        GlStateManager.color(1.0F, 1.0F, 1.0F, 1.0F);
                        correctedScissorCalls[0] = drawLayout(
                                finalLayout, minecraft, placement, scale, logicalHeight);
                    } finally {
                        GlStateManager.popMatrix();
                    }
                });
        if (placement.repositionsLayout()) {
            context.recordRecipeLayoutPlacementCompatibility(
                    placement.kind, category.getUid(), category.getClass().getName(),
                    wrapper.getClass().getName(), sourceIndex, exportedIndex,
                    placement.layoutX, placement.layoutY,
                    placement.translateX, placement.translateY,
                    correctedScissorCalls[0]);
        }
        String imageName = "r" + exportedIndex + ".png";
        context.submitRecipeImage(image, context.root.resolve(currentDirectory).resolve(imageName));
        data.image = imageName;
        data.width = logicalWidth;
        data.height = logicalHeight;
    }

    private static int drawLayout(IRecipeLayoutDrawable layout, Minecraft minecraft,
                                  RecipeLayoutPlacementPolicy.Placement placement,
                                  int recipeScale, int targetLogicalHeight) throws Exception {
        if (placement.kind != RecipeLayoutPlacementPolicy.Kind.
                MULTIBLOCKED_0_8_SCREEN_CENTERED_PARENT) {
            layout.drawRecipe(minecraft, -10000, -10000);
            return 0;
        }

        MultiblockedScissorBridge.beginCapture(
                recipeScale, targetLogicalHeight,
                placement.translateX, placement.translateY);
        Throwable failure = null;
        try {
            layout.drawRecipe(minecraft, -10000, -10000);
        } catch (Throwable drawFailure) {
            failure = drawFailure;
        }

        int correctedCalls = 0;
        try {
            // endCapture clears its global scope before performing validation. Keeping this call
            // outside the draw try/catch guarantees cleanup even when native widget rendering
            // fails, while preserving that original failure as the primary exception.
            correctedCalls = MultiblockedScissorBridge.endCapture();
        } catch (Throwable cleanupFailure) {
            if (failure == null) {
                failure = cleanupFailure;
            } else {
                failure.addSuppressed(cleanupFailure);
            }
        }
        if (failure != null) {
            FatalErrors.rethrowIfFatal(failure);
            if (failure instanceof Exception) {
                throw (Exception) failure;
            }
            if (failure instanceof Error) {
                throw (Error) failure;
            }
            throw new IOException("Multiblocked native layout draw failed", failure);
        }
        return correctedCalls;
    }

    private void verifyQualitySampleComplete() throws IOException {
        if (context.request.qualitySample == null) {
            return;
        }
        int targetCount = context.request.qualitySample.recipeCount();
        if (exportedTotal != targetCount) {
            throw new IOException("Quality sample exported " + exportedTotal + " of " +
                    targetCount + " selected recipes");
        }
    }

    private String safeCategoryUid(IRecipeCategory category) {
        try {
            String uid = category.getUid();
            return uid == null || uid.isEmpty() ? "unknown:" + categoryCursor : uid;
        } catch (Throwable throwable) {
            FatalErrors.rethrowIfFatal(throwable);
            String fallback = "unknown:" + categoryCursor;
            context.failure("category id at index " + categoryCursor + ": " + throwable + "; using " + fallback);
            return fallback;
        }
    }

    private String safeCurrentUid() {
        return currentCategory == null ? "unknown" : safeCategoryUid(currentCategory);
    }

    private String renderCategoryIcon(final IRecipeCategory category) throws Exception {
        final IDrawable icon = category.getIcon();
        if (icon == null) {
            return null;
        }
        final int width = Math.max(1, icon.getWidth());
        final int height = Math.max(1, icon.getHeight());
        final int scale = context.request.iconScale;
        if (width * scale > context.renderer.getMaxTextureSize() ||
                height * scale > context.renderer.getMaxTextureSize()) {
            throw new IOException("category icon " + width + "x" + height + " at scale " + scale +
                    " exceeds GL_MAX_TEXTURE_SIZE=" + context.renderer.getMaxTextureSize());
        }
        BufferedImage image = context.renderer.render(width * scale, height * scale, minecraft -> {
            GlStateManager.pushMatrix();
            try {
                GlStateManager.scale(scale, scale, 1.0F);
                GlStateManager.color(1.0F, 1.0F, 1.0F, 1.0F);
                icon.draw(minecraft, 0, 0);
            } finally {
                GlStateManager.popMatrix();
            }
        });
        String relative = currentDirectory + "/icon.png";
        context.submitImage(image, context.root.resolve(relative));
        return relative;
    }

    private static ResourceLocation registryName(IRecipeWrapper wrapper) {
        if (wrapper instanceof ICraftingRecipeWrapper) {
            return ((ICraftingRecipeWrapper) wrapper).getRegistryName();
        }
        return null;
    }

    private void writeRecipe(RecipeData data) throws IOException {
        recipesWriter.beginObject();
        if (data.id != null) {
            recipesWriter.name("id").value(data.id);
        }
        if (data.error) {
            recipesWriter.name("err").value(true);
        }
        if (data.durationTicks != null) {
            recipesWriter.name("durationTicks").value(data.durationTicks.longValue());
        }
        if (data.image != null) {
            recipesWriter.name("img").value(data.image);
            recipesWriter.name("w").value(data.width);
            recipesWriter.name("h").value(data.height);
        }
        if (data.structure != null) {
            writeStructure(data.structure);
        }
        writeSlots("in", data.inputs);
        writeSlots("out", data.outputs);
        if (!data.catalysts.isEmpty()) {
            writeSlots("cat", data.catalysts);
        }
        if (!data.retained.isEmpty()) {
            recipesWriter.name("retained").beginObject();
            for (Map.Entry<String, RetentionData> entry : data.retained.entrySet()) {
                recipesWriter.name(entry.getKey()).beginObject();
                recipesWriter.name("mode").value(entry.getValue().mode);
                if (entry.getValue().uses != null) {
                    recipesWriter.name("uses").value(entry.getValue().uses.intValue());
                }
                recipesWriter.endObject();
            }
            recipesWriter.endObject();
        }
        recipesWriter.endObject();
    }

    private void writeStructure(ModularMachineryStructure.Data structure) throws IOException {
        recipesWriter.name("structure").beginObject();
        recipesWriter.name("size").beginArray()
                .value(structure.sizeX).value(structure.sizeY).value(structure.sizeZ).endArray();
        recipesWriter.name("total").value(structure.cells.size());
        recipesWriter.name("controller").value(structure.controllerKey);
        recipesWriter.name("blocks").beginArray();
        for (Map.Entry<String, BigDecimal> entry : structure.blockCounts.entrySet()) {
            recipesWriter.beginArray().value(entry.getKey()).value(entry.getValue()).endArray();
        }
        recipesWriter.endArray();
        recipesWriter.name("cells").beginArray();
        for (ModularMachineryStructure.Cell cell : structure.cells) {
            recipesWriter.beginArray()
                    .value(cell.x).value(cell.y).value(cell.z).value(cell.key)
                    .endArray();
        }
        recipesWriter.endArray();
        recipesWriter.endObject();
    }

    private void writeSlots(String name, List<SlotData> slots) throws IOException {
        recipesWriter.name(name).beginArray();
        for (SlotData slot : slots) {
            recipesWriter.beginArray();
            for (IngredientPair pair : slot.pairs) {
                recipesWriter.beginArray().value(pair.key).value(pair.amount);
                if (slot.logicalIdentity != null) {
                    recipesWriter.value(slot.logicalIdentity);
                }
                recipesWriter.endArray();
            }
            recipesWriter.endArray();
        }
        recipesWriter.endArray();
    }

    private void closeCurrentCategory() throws IOException {
        if (recipesWriter != null) {
            recipesWriter.endArray();
            recipesWriter.close();
            recipesWriter = null;
        }
        currentCategory = null;
        currentCategoryMeta = null;
        currentRecipes = Collections.emptyList();
        currentCatalystCount = 0;
        currentExportedCount = 0;
        recipeCursor = 0;
        sampledSourceIndexes = Collections.emptyList();
        sampledSourceCursor = 0;
    }

    @Override
    public String label() {
        return "recipes: " + currentTitle + " (" + categoryCursor + "/" + categories.size() + ")";
    }

    @Override
    public int done() {
        // A sampled source index can be arbitrarily large; progress is the count of selected
        // targets consumed in this category, not the source-list cursor.
        return context.request.qualitySample == null ? recipeCursor : sampledSourceCursor;
    }

    @Override
    public int total() {
        return context.request.qualitySample == null
                ? currentRecipes.size()
                : sampledSourceIndexes.size();
    }

    @Override
    public void close() throws IOException {
        closeCurrentCategory();
    }

    static final class RecipeData {
        String id;
        String image;
        int width;
        int height;
        boolean error;
        boolean excluded;
        Long durationTicks;
        ModularMachineryStructure.Data structure;
        final List<SlotData> inputs = new ArrayList<SlotData>();
        final List<SlotData> outputs = new ArrayList<SlotData>();
        final List<SlotData> catalysts = new ArrayList<SlotData>();
        final Map<String, RetentionData> retained =
                new LinkedHashMap<String, RetentionData>();
        final Set<String> usedKeys = new LinkedHashSet<String>();
        final Set<String> outputKeys = new LinkedHashSet<String>();
    }

    static final class SlotData {
        String logicalIdentity;
        final List<IngredientPair> pairs = new ArrayList<IngredientPair>();
    }

    static final class IngredientPair {
        final String key;
        final BigDecimal amount;

        IngredientPair(String key, BigDecimal amount) {
            this.key = key;
            this.amount = amount;
        }

        String identity() {
            return key + '\u0000' + amount.toPlainString();
        }
    }

    static final class RetentionData {
        final String mode;
        final Integer uses;

        private RetentionData(String mode, Integer uses) {
            this.mode = mode;
            this.uses = uses;
        }

        static RetentionData reusable() {
            return new RetentionData("reusable", null);
        }

        static RetentionData durability(int uses) {
            return new RetentionData("durability", Integer.valueOf(Math.max(1, uses)));
        }
    }

    /** Propagates to collectSemantics so an unclassified zero marks the entire recipe erroneous. */
    private static final class UnclassifiedZeroQuantityException extends IllegalArgumentException {
        UnclassifiedZeroQuantityException(String message) {
            super(message);
        }
    }
}
