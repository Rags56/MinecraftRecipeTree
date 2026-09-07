package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.NativeImage;
import mezz.jei.api.gui.IRecipeLayoutDrawable;
import mezz.jei.api.gui.drawable.IDrawable;
import mezz.jei.api.gui.ingredient.IRecipeSlotView;
import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.neoforge.NeoForgeTypes;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.recipe.IFocusGroup;
import mezz.jei.api.recipe.IRecipeManager;
import mezz.jei.api.recipe.category.IRecipeCategory;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.client.renderer.Rect2i;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.Writer;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Recipe phase: for every visible JEI category, renders every recipe layout into a PNG
 * (background panel + the exact same drawing JEI does in its GUI) and writes a
 * recipes.json per category with inputs/outputs/catalysts as catalog keys.
 */
final class RecipeExporter implements ExportJob.PhaseRunner {
    private static final int PAD = 4;
    private static final int LARGE_VARIANT_SET = 512;
    private static final int MAX_TEXTURE = 2048;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    /** JEI gui panel color, so recipes look like they do in-game instead of floating on transparency. */
    private static final int BACKGROUND_ARGB = 0xFFC6C6C6;

    private final ExportContext ctx;
    private final IRecipeManager recipeManager;
    private final IFocusGroup emptyFocus;
    private final ItemCatalog catalog;
    private final List<IRecipeCategory<?>> categories;

    private int catIndex = -1;
    /** Index of the current category in the shared categories.json (set by registerCategory). */
    private int registeredCatIndex = -1;
    private List<?> recipes = List.of();
    private int recipeIndex;
    private String catDir = "";
    private String catTitle = "";
    @Nullable
    private JsonArray recipesJson;
    @Nullable
    private JsonObject categoryJson;
    @Nullable
    private IncrementalExportCache.RecipeCategoryCache previousRecipes;
    private int exportedTotal;
    private final Map<LayoutKey, BaseLayer> baseLayers = new HashMap<>();
    private final Set<String> reservedBaseNames = new LinkedHashSet<>();
    private final Set<String> copiedBaseNames = new LinkedHashSet<>();
    private final Set<String> reservedRecipeImageNames = new LinkedHashSet<>();
    private final Set<String> copiedRecipeImageNames = new LinkedHashSet<>();
    private final Map<OverlayKey, String> identicalRecipeOverlays = new HashMap<>();
    private int nextBaseIndex;
    private int nextRecipeImageIndex;
    private long layeredRecipePixels;
    private long sharedRecipePixels;
    private int deduplicatedRecipeImages;
    private final Set<Class<?>> warnedHelperAmountTypes = new LinkedHashSet<>();
    private final Set<Class<?>> warnedUnknownAmountTypes = new LinkedHashSet<>();
    private final Set<Class<?>> warnedCategoricalAmountTypes = new LinkedHashSet<>();
    private final Set<ResourceLocation> warnedLargeVariantCategories = new LinkedHashSet<>();
    private final Set<ResourceLocation> warnedRegistryNameCategories = new LinkedHashSet<>();
    private final Map<Class<?>, Optional<Method>> helperAmountMethods = new HashMap<>();

    private record LayoutKey(int width, int height, int scale) {
    }

    private record OverlayKey(LayoutKey layout, String contentFingerprint) {
    }

    private record RetentionData(String mode, Integer uses) {
        private static RetentionData reusable() {
            return new RetentionData("reusable", null);
        }

        private static RetentionData durability(int uses) {
            return new RetentionData("durability", Math.max(1, uses));
        }
    }

    private static final class BaseLayer implements AutoCloseable {
        private final NativeImage image;
        private final String name;

        private BaseLayer(NativeImage image, String name) {
            this.image = image;
            this.name = name;
        }

        @Override
        public void close() {
            image.close();
        }
    }

    RecipeExporter(ExportContext ctx, IJeiRuntime runtime) throws IOException {
        this.ctx = ctx;
        this.recipeManager = runtime.getRecipeManager();
        this.emptyFocus = runtime.getJeiHelpers().getFocusFactory().getEmptyFocusGroup();
        this.catalog = ctx.catalog(runtime.getIngredientManager());
        boolean includeMeta = Boolean.getBoolean("jeiexport.includeMetaCategories");
        this.categories = recipeManager.createRecipeCategoryLookup().get()
                .filter(category -> includeMeta || !isMetaCategory(category.getRecipeType().getUid()))
                .toList();
    }

    /**
     * JEI meta-categories that list tag contents / info pages rather than actual recipes
     * ("Item Tags", "Block Tags", ...). Skipped by default; re-enable with
     * -Djeiexport.includeMetaCategories=true.
     */
    static boolean isMetaCategory(ResourceLocation uid) {
        return uid.getPath().startsWith("tag_recipes")
                || ("jei".equals(uid.getNamespace()) && "information".equals(uid.getPath()));
    }

    @Override
    public boolean step() throws IOException {
        if (recipeIndex >= recipes.size()) {
            if (recipesJson != null) {
                flushCategory();
            }
            catIndex++;
            if (catIndex >= categories.size()) {
                return true;
            }
            beginCategory(categories.get(catIndex));
            return false;
        }
        exportOne(categories.get(catIndex), recipes.get(recipeIndex), recipeIndex);
        recipeIndex++;
        return false;
    }

    private void beginCategory(IRecipeCategory<?> category) {
        ResourceLocation uid = category.getRecipeType().getUid();
        catDir = "recipes/" + Naming.uniqueRecipeDir(ctx, uid);
        try {
            catTitle = category.getTitle().getString();
        } catch (Throwable t) {
            ctx.failure("category title " + uid + " failed; using category id", t);
            catTitle = uid.toString();
        }
        try {
            this.recipes = recipeManager.createRecipeLookup(category.getRecipeType()).get().toList();
        } catch (Throwable t) {
            ctx.failure("category recipes " + uid, t);
            this.recipes = List.of();
        }
        this.recipeIndex = 0;
        this.recipesJson = new JsonArray();
        closeBaseLayers();
        this.reservedBaseNames.clear();
        this.copiedBaseNames.clear();
        this.reservedRecipeImageNames.clear();
        this.copiedRecipeImageNames.clear();
        this.identicalRecipeOverlays.clear();
        this.nextBaseIndex = 0;
        this.nextRecipeImageIndex = 0;
        this.layeredRecipePixels = 0;
        this.sharedRecipePixels = 0;
        this.deduplicatedRecipeImages = 0;
        this.previousRecipes = null;
        if (ctx.previous != null) {
            try {
                this.previousRecipes = ctx.previous.recipeCategory(uid);
                for (IncrementalExportCache.CachedRecipe cached : this.previousRecipes.allRecipes()) {
                    if (cached.baseImageName() != null) {
                        this.reservedBaseNames.add(cached.baseImageName());
                    }
                    this.reservedRecipeImageNames.add(fileName(cached.imagePath()));
                }
            } catch (IOException cacheFailure) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Recipe cache lookup failed for category {}; rendering the category again",
                        uid,
                        cacheFailure);
            }
        }

        JsonObject cj = new JsonObject();
        cj.addProperty("id", uid.toString());
        cj.addProperty("title", catTitle);
        cj.addProperty("dir", catDir);
        cj.addProperty("count", recipes.size());
        try {
            String iconRel = renderCategoryIcon(category);
            if (iconRel != null) {
                cj.addProperty("icon", iconRel);
            }
        } catch (Throwable t) {
            ctx.failure("category icon " + uid, t);
        }
        JsonArray catalysts = new JsonArray();
        try {
            List<ITypedIngredient<?>> allCatalysts =
                    recipeManager.createRecipeCatalystLookup(category.getRecipeType()).get().toList();
            if (allCatalysts.size() > LARGE_VARIANT_SET) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Category {} declares {} catalysts; exporting all of them",
                        uid, allCatalysts.size());
            }
            Set<String> catalystKeys = new LinkedHashSet<>();
            for (ITypedIngredient<?> typed : allCatalysts) {
                if (ItemCatalog.isEmptyIngredient(typed)) {
                    continue;
                }
                catalystKeys.add(catalog.ensure(typed));
            }
            catalystKeys.forEach(catalysts::add);
        } catch (Throwable t) {
            ctx.failure("category catalysts " + uid, t);
        }
        cj.add("catalysts", catalysts);
        categoryJson = cj;
        registeredCatIndex = ctx.registerCategory(cj);
    }

    private void exportOne(IRecipeCategory<?> category, Object recipe, int idx) {
        int exportedIndex = recipesJson.size();
        JsonObject rj = new JsonObject();
        Set<String> inputKeys = new LinkedHashSet<>();
        Set<String> outputKeys = new LinkedHashSet<>();
        ResourceLocation categoryUid = category.getRecipeType().getUid();
        ResourceLocation recipeId = registryName(category, recipe);
        Class<?> recipeClass = recipe == null ? null : recipe.getClass();
        try {
            Optional<IRecipeLayoutDrawable<?>> drawableOpt = createDrawable(category, recipe);
            if (drawableOpt.isEmpty()) {
                ctx.warning(String.format(
                        Locale.ROOT,
                        "recipe %s #%d (%s): JEI returned no layout drawable; omitting the "
                                + "non-renderable placeholder",
                        catDir,
                        idx,
                        recipeClass == null ? "unknown recipe class" : recipeClass.getName()));
                return;
            }
            IRecipeLayoutDrawable<?> drawable = drawableOpt.get();
            drawable.setPosition(PAD, PAD);
            Rect2i rect = drawable.getRect();
            int w = rect.getWidth() + PAD * 2;
            int h = rect.getHeight() + PAD * 2;
            int scale = Math.max(1, Math.min(ctx.recipeScale, MAX_TEXTURE / Math.max(1, Math.max(w, h))));

            if (recipeId != null) {
                rj.addProperty("id", recipeId.toString());
            }
            var durationTicks = RecipeDuration.ticks(recipe);
            if (durationTicks.isPresent()) {
                rj.addProperty("durationTicks", durationTicks.getAsLong());
            }
            rj.addProperty("w", w);
            rj.addProperty("h", h);

            JsonArray in = new JsonArray();
            JsonArray out = new JsonArray();
            JsonArray cata = new JsonArray();
            JsonObject retained = new JsonObject();
            for (IRecipeSlotView slot : drawable.getRecipeSlotsView().getSlotViews()) {
                List<ITypedIngredient<?>> ingredients = slot.getAllIngredients().toList();
                if (ingredients.isEmpty()) {
                    continue;
                }
                if (ingredients.size() > LARGE_VARIANT_SET
                        && warnedLargeVariantCategories.add(categoryUid)) {
                    JeiExportMod.LOGGER.warn(
                            "[jeiexport] Category {} has a slot with {} alternatives; exporting the full JEI set",
                            categoryUid, ingredients.size());
                }
                JsonArray slotArr = new JsonArray();
                JsonArray retainedSlotArr = new JsonArray();
                Map<String, RetentionData> retainedSlotDetails = new HashMap<>();
                Set<String> seenPairs = new LinkedHashSet<>();
                for (ITypedIngredient<?> typed : ingredients) {
                    if (ItemCatalog.isEmptyIngredient(typed)) {
                        continue;
                    }
                    String key = catalog.ensure(typed);
                    long amount = amountOf(typed);
                    if (!seenPairs.add(key + "\u0000" + amount)) {
                        continue;
                    }
                    JsonArray pair = new JsonArray();
                    pair.add(key);
                    pair.add(amount);
                    RetentionData retention = slot.getRole() == mezz.jei.api.recipe.RecipeIngredientRole.INPUT
                            ? craftingRetention(typed)
                            : null;
                    if (retention == null) {
                        slotArr.add(pair);
                    } else {
                        retainedSlotArr.add(pair);
                        retainedSlotDetails.put(key, retention);
                    }
                    switch (slot.getRole()) {
                        case INPUT -> inputKeys.add(key);
                        case OUTPUT -> outputKeys.add(key);
                        // Catalysts are not consumed, but they are still a valid
                        // "used by" relationship in the item usage browser.
                        case CATALYST -> inputKeys.add(key);
                        default -> {
                        }
                    }
                }
                if (slotArr.isEmpty() && retainedSlotArr.isEmpty()) {
                    continue;
                }
                if (!slotArr.isEmpty() && !retainedSlotArr.isEmpty()) {
                    // Alternatives are OR members. Publishing separate consumed and retained
                    // slots would turn that into an AND requirement, so mixed slots stay consumed.
                    retainedSlotArr.forEach(slotArr::add);
                    retainedSlotArr = new JsonArray();
                    retainedSlotDetails.clear();
                }
                switch (slot.getRole()) {
                    case INPUT -> {
                        if (retainedSlotArr.isEmpty()) {
                            in.add(slotArr);
                        } else {
                            cata.add(retainedSlotArr);
                            retainedSlotDetails.forEach((key, detail) -> {
                                JsonObject value = new JsonObject();
                                value.addProperty("mode", detail.mode());
                                if (detail.uses() != null) {
                                    value.addProperty("uses", detail.uses());
                                }
                                retained.add(key, value);
                            });
                        }
                    }
                    case OUTPUT -> out.add(slotArr);
                    case CATALYST -> cata.add(slotArr);
                    default -> {
                    }
                }
            }
            rj.add("in", in);
            rj.add("out", out);
            if (!cata.isEmpty()) {
                rj.add("cat", cata);
            }
            if (retained.size() > 0) {
                rj.add("retained", retained);
            }

            String imageName = reuseRecipeImage(rj);
            if (imageName == null) {
                imageName = nextRecipeImageName();
                String imageRelativePath = catDir + "/" + imageName;
                NativeImage completeImage = ctx.renderer.capture(w * scale, h * scale, g -> {
                    g.pose().pushPose();
                    try {
                        g.pose().scale(scale, scale, 1f);
                        g.fill(0, 0, w, h, BACKGROUND_ARGB);
                        drawable.drawRecipe(g, -100, -100);
                    } finally {
                        g.pose().popPose();
                    }
                });
                NativeImage imageToSave = completeImage;
                if (recipes.size() > 1) {
                    RecipeImageLayering.Result layered = layerRecipeImage(completeImage, w, h, scale);
                    if (layered.sharedPixelRatio() >= RecipeImageLayering.MINIMUM_SHARED_PIXEL_RATIO) {
                        BaseLayer base = baseLayers.get(new LayoutKey(w, h, scale));
                        rj.addProperty("bg", base.name);
                        completeImage.close();
                        layeredRecipePixels += layered.totalPixels();
                        sharedRecipePixels += layered.sharedPixels();
                        OverlayKey overlayKey = new OverlayKey(
                                new LayoutKey(w, h, scale),
                                layered.contentFingerprint());
                        String identicalImageName = identicalRecipeOverlays.get(overlayKey);
                        if (identicalImageName != null) {
                            layered.overlay().close();
                            imageName = identicalImageName;
                            imageToSave = null;
                            deduplicatedRecipeImages++;
                            ctx.deduplicatedRecipeImages++;
                        } else {
                            identicalRecipeOverlays.put(overlayKey, imageName);
                            imageToSave = layered.overlay();
                        }
                    } else {
                        layered.overlay().close();
                    }
                }
                if (imageToSave != null) {
                    ctx.saveImage(imageToSave, ctx.root.resolve(imageRelativePath));
                }
            }
            rj.addProperty("img", imageName);
        } catch (Throwable t) {
            ctx.recipeFailure(
                    categoryUid,
                    recipeId,
                    idx,
                    recipeClass,
                    String.format(Locale.ROOT, "recipe %s #%d failed", catDir, idx),
                    t);
            rj = new JsonObject();
            rj.addProperty("err", true);
            inputKeys.clear();
            outputKeys.clear();
        }
        recipesJson.add(rj);
        for (String key : inputKeys) {
            ctx.indexRecipe(key, false, registeredCatIndex, exportedIndex);
        }
        for (String key : outputKeys) {
            ctx.indexRecipe(key, true, registeredCatIndex, exportedIndex);
        }
        exportedTotal++;
    }

    @Nullable
    private static RetentionData craftingRetention(ITypedIngredient<?> ingredient) {
        if (ingredient.getType() != VanillaTypes.ITEM_STACK ||
                !(ingredient.getIngredient() instanceof ItemStack input) ||
                input.isEmpty() || !input.hasCraftingRemainingItem()) {
            return null;
        }
        ItemStack returned = input.getCraftingRemainingItem();
        if (returned.isEmpty() || !returned.is(input.getItem())) {
            return null;
        }
        int damagePerCraft = returned.getDamageValue() - input.getDamageValue();
        if (damagePerCraft > 0 && input.isDamageableItem()) {
            int remainingDurability = Math.max(1, input.getMaxDamage() - input.getDamageValue());
            return RetentionData.durability(remainingDurability / damagePerCraft);
        }
        return RetentionData.reusable();
    }

    @Nullable
    private String reuseRecipeImage(JsonObject currentRecipe) {
        if (previousRecipes == null) {
            return null;
        }
        IncrementalExportCache.CachedRecipe cached = previousRecipes.consume(currentRecipe);
        if (cached == null) {
            return null;
        }
        if (cached.baseImagePath() != null && cached.baseImageName() != null) {
            String newBasePath = catDir + "/" + cached.baseImageName();
            if (copiedBaseNames.add(cached.baseImageName())
                    && !ctx.reusePreviousFile(cached.baseImagePath(), newBasePath)) {
                copiedBaseNames.remove(cached.baseImageName());
                return null;
            }
            currentRecipe.addProperty("bg", cached.baseImageName());
        }
        String imageName = fileName(cached.imagePath());
        String imageRelativePath = catDir + "/" + imageName;
        if (copiedRecipeImageNames.add(imageName)
                && !ctx.reusePreviousFile(cached.imagePath(), imageRelativePath)) {
            copiedRecipeImageNames.remove(imageName);
            return null;
        }
        ctx.reusedRecipes++;
        return imageName;
    }

    private String nextRecipeImageName() {
        String candidate;
        do {
            candidate = "r" + nextRecipeImageIndex++ + ".png";
        } while (reservedRecipeImageNames.contains(candidate));
        return candidate;
    }

    private static String fileName(String relativePath) {
        int slash = relativePath.lastIndexOf('/');
        return slash < 0 ? relativePath : relativePath.substring(slash + 1);
    }

    private RecipeImageLayering.Result layerRecipeImage(
            NativeImage completeImage,
            int logicalWidth,
            int logicalHeight,
            int scale) {
        LayoutKey key = new LayoutKey(logicalWidth, logicalHeight, scale);
        BaseLayer base = baseLayers.get(key);
        if (base == null) {
            String name = nextBaseName();
            base = new BaseLayer(RecipeImageLayering.copy(completeImage), name);
            baseLayers.put(key, base);
            reservedBaseNames.add(name);
            ctx.saveImage(
                    RecipeImageLayering.copy(base.image),
                    ctx.root.resolve(catDir).resolve(name));
        }
        return RecipeImageLayering.difference(base.image, completeImage);
    }

    private String nextBaseName() {
        String candidate;
        do {
            candidate = "bg" + nextBaseIndex++ + ".png";
        } while (reservedBaseNames.contains(candidate));
        return candidate;
    }

    @Nullable
    private String renderCategoryIcon(IRecipeCategory<?> category) {
        ResourceLocation categoryId = category.getRecipeType().getUid();
        if (ctx.previous != null) {
            String previousIcon = ctx.previous.categoryIcon(categoryId);
            String newIcon = catDir + "/icon.png";
            if (previousIcon != null && ctx.reusePreviousFile(previousIcon, newIcon)) {
                ctx.reusedCategoryIcons++;
                return newIcon;
            }
        }
        IDrawable icon = category.getIcon();
        if (icon == null) {
            return null;
        }
        int w = Math.max(1, icon.getWidth());
        int h = Math.max(1, icon.getHeight());
        int scale = 4;
        NativeImage image = ctx.renderer.capture(w * scale, h * scale, g -> {
            g.pose().pushPose();
            try {
                g.pose().scale(scale, scale, 1f);
                icon.draw(g);
            } finally {
                g.pose().popPose();
            }
        });
        String rel = catDir + "/icon.png";
        ctx.saveImage(image, ctx.root.resolve(rel));
        return rel;
    }

    private void flushCategory() throws IOException {
        if (categoryJson != null) {
            categoryJson.addProperty("count", recipesJson.size());
        }
        Path file = ctx.root.resolve(catDir).resolve("recipes.json");
        Files.createDirectories(file.getParent());
        try (Writer writer = Files.newBufferedWriter(file)) {
            GSON.toJson(recipesJson, writer);
        }
        ctx.recipeCount += recipesJson.size();
        if (layeredRecipePixels > 0) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Shared recipe screens for {} removed {} of {} repeated pixels ({}%)",
                    catTitle,
                    sharedRecipePixels,
                    layeredRecipePixels,
                    Math.round(sharedRecipePixels * 100.0 / layeredRecipePixels));
        }
        if (deduplicatedRecipeImages > 0) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Reused {} identical recipe overlays for {}",
                    deduplicatedRecipeImages,
                    catTitle);
        }
        closeBaseLayers();
        recipesJson = null;
        categoryJson = null;
    }

    private void closeBaseLayers() {
        for (BaseLayer base : baseLayers.values()) {
            base.close();
        }
        baseLayers.clear();
    }

    /** Flush partial output if the export gets cancelled mid-category. */
    @Override
    public void close() throws IOException {
        if (recipesJson != null) {
            flushCategory();
        } else {
            closeBaseLayers();
        }
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private Optional<IRecipeLayoutDrawable<?>> createDrawable(IRecipeCategory<?> category, Object recipe) {
        return (Optional) recipeManager.createRecipeLayoutDrawable((IRecipeCategory) category, recipe, emptyFocus);
    }

    @Nullable
    @SuppressWarnings({"unchecked", "rawtypes"})
    private ResourceLocation registryName(IRecipeCategory category, Object recipe) {
        try {
            return category.getRegistryName(recipe);
        } catch (Throwable t) {
            ResourceLocation uid = category.getRecipeType().getUid();
            if (warnedRegistryNameCategories.add(uid)) {
                ctx.failure("recipe registry id " + uid
                        + " failed; recipe ids for this category may be omitted", t);
            }
            return null;
        }
    }

    private <V> long amountOf(ITypedIngredient<V> typed) {
        V ingredient = typed.getIngredient();
        IIngredientHelper<V> helper = catalog.manager.getIngredientHelper(typed.getType());
        Optional<Method> helperAmountMethod = helperAmountMethods.computeIfAbsent(
                helper.getClass(), RecipeExporter::findHelperAmountMethod);
        if (helperAmountMethod.isPresent()) {
            try {
                Object value = helperAmountMethod.get().invoke(helper, ingredient);
                if (value instanceof Number number && number.longValue() > 0) {
                    return number.longValue();
                }
            } catch (ReflectiveOperationException | RuntimeException t) {
                Throwable cause = t instanceof InvocationTargetException invocation
                        ? invocation.getCause() : t;
                if (warnedHelperAmountTypes.add(ingredient.getClass())) {
                    JeiExportMod.LOGGER.warn(
                            "[jeiexport] JEI amount lookup failed for {}; trying ingredient accessors",
                            ingredient.getClass().getName(), cause);
                }
            }
        }

        Long reflected = reflectedAmount(ingredient);
        if (reflected != null && reflected > 0) {
            return reflected;
        }
        if (typed.getType() != VanillaTypes.ITEM_STACK && typed.getType() != NeoForgeTypes.FLUID_STACK) {
            if (warnedCategoricalAmountTypes.add(ingredient.getClass())) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Custom ingredient type {} exposes no quantity accessor; "
                                + "exporting it as a categorical unit with amount 1",
                        ingredient.getClass().getName());
            }
            return 1;
        }
        if (warnedUnknownAmountTypes.add(ingredient.getClass())) {
            ctx.failure("QUANTITY_INVALID: ingredient amount type "
                    + ingredient.getClass().getName()
                    + " has no positive JEI amount or getAmount/getCount value; "
                    + "exporting -1 as an explicit unknown quantity");
        }
        return -1;
    }

    private static Optional<Method> findHelperAmountMethod(Class<?> helperClass) {
        try {
            return Optional.of(helperClass.getMethod("getAmount", Object.class));
        } catch (NoSuchMethodException e) {
            return Optional.empty();
        }
    }

    /**
     * Optional-mod stacks (notably Mekanism ChemicalStack) expose getAmount(),
     * but JEI's generic helper can report -1. Reflection keeps the exporter
     * decoupled from optional runtime-only mod classes.
     */
    @Nullable
    private static Long reflectedAmount(Object ingredient) {
        for (String methodName : List.of("getAmount", "getCount")) {
            try {
                Method method = ingredient.getClass().getMethod(methodName);
                Object value = method.invoke(ingredient);
                if (value instanceof Number number) {
                    return number.longValue();
                }
            } catch (ReflectiveOperationException ignored) {
                // Try the next conventional accessor; final failure is logged by amountOf.
            }
        }
        return null;
    }

    @Override
    public String label() {
        String cat = catIndex >= 0 && catIndex < categories.size()
                ? catTitle + " (" + (catIndex + 1) + "/" + categories.size() + ")"
                : "categories " + categories.size();
        return "recipes: " + cat;
    }

    @Override
    public int done() {
        return recipeIndex;
    }

    @Override
    public int total() {
        return recipes.size();
    }
}
