package com.recipetree.jeiexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.SharedConstants;
import net.minecraft.resources.ResourceLocation;
import net.neoforged.fml.ModList;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.List;
import java.util.TreeMap;

/**
 * Read-only view of a compatible completed export. Records are reused only after
 * their current structural JSON matches the prior record; missing and failed
 * records therefore remain cache misses and are exported again.
 */
final class IncrementalExportCache {
    static final int CACHE_REVISION = 1;

    record CachedRecipe(
            JsonObject json,
            String imagePath,
            @Nullable String baseImageName,
            @Nullable String baseImagePath) {
        CachedRecipe(JsonObject json, String imagePath) {
            this(json, imagePath, null, null);
        }
    }

    static final class RecipeCategoryCache {
        private final Map<String, ArrayDeque<CachedRecipe>> recipesByFingerprint;
        private final List<CachedRecipe> allRecipes;

        RecipeCategoryCache(
                Map<String, ArrayDeque<CachedRecipe>> recipesByFingerprint,
                List<CachedRecipe> allRecipes) {
            this.recipesByFingerprint = recipesByFingerprint;
            this.allRecipes = allRecipes;
        }

        @Nullable
        CachedRecipe consume(JsonObject currentRecipe) {
            ArrayDeque<CachedRecipe> matches = recipesByFingerprint.get(structuralFingerprint(currentRecipe));
            return matches == null ? null : matches.pollFirst();
        }

        List<CachedRecipe> allRecipes() {
            return allRecipes;
        }
    }

    private record Category(String directory, @Nullable String icon, int count) {
    }

    private final Path root;
    private final Map<String, Category> categories;
    private final boolean priorTradeFailure;
    @Nullable
    private Map<String, JsonObject> items;
    @Nullable
    private Map<String, JsonObject> mobs;
    @Nullable
    private JsonObject blockDrops;

    private IncrementalExportCache(Path root, Map<String, Category> categories, boolean priorTradeFailure) {
        this.root = root;
        this.categories = categories;
        this.priorTradeFailure = priorTradeFailure;
    }

    @Nullable
    static IncrementalExportCache load(
            Path finalRoot,
            int iconScale,
            PackIdentity packIdentity,
            boolean forceRebuild) {
        if (forceRebuild) {
            JeiExportMod.LOGGER.info("[jeiexport] Incremental reuse disabled by explicit rebuild request");
            return null;
        }
        if (!Files.isDirectory(finalRoot)) {
            JeiExportMod.LOGGER.info("[jeiexport] No previous completed snapshot; performing a full export");
            return null;
        }
        try {
            JsonObject manifest = readObject(finalRoot.resolve("manifest.json"));
            String incompatibility = incompatibility(manifest, finalRoot, iconScale, packIdentity);
            if (incompatibility != null) {
                JeiExportMod.LOGGER.info(
                        "[jeiexport] Previous snapshot is not reusable ({}); performing a full export",
                        incompatibility);
                return null;
            }
            Map<String, Category> categories = readCategories(finalRoot.resolve("categories.json"));
            boolean priorTradeFailure = hasPriorTradeFailure(finalRoot.resolve("export-errors.json"));
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Incremental export enabled from compatible snapshot {} ({} recipe categories)",
                    finalRoot,
                    categories.size());
            return new IncrementalExportCache(finalRoot, categories, priorTradeFailure);
        } catch (Exception error) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Previous snapshot cache validation failed; performing a full export",
                    error);
            return null;
        }
    }

    private static String incompatibility(
            JsonObject manifest,
            Path finalRoot,
            int iconScale,
            PackIdentity packIdentity) throws IOException {
        if (manifest.has("aborted") && manifest.get("aborted").getAsBoolean()) {
            return "previous export was aborted";
        }
        if (integer(manifest, "format") != 1) {
            return "manifest format changed";
        }
        if (!Objects.equals(string(manifest, "minecraft"), SharedConstants.getCurrentVersion().getName())) {
            return "Minecraft version changed";
        }
        JsonObject pack = manifest.getAsJsonObject("pack");
        if (pack == null
                || !Objects.equals(string(pack, "name"), packIdentity.name())
                || !Objects.equals(nullableString(pack, "version"), packIdentity.version())) {
            return "modpack identity changed";
        }
        JsonObject settings = manifest.getAsJsonObject("settings");
        if (settings == null
                || integer(settings, "iconScale") != iconScale
                || integer(settings, "recipeScale") != ExportManifestContract.RECIPE_SCALE
                || integer(settings, "mobCanvas") != ExportManifestContract.MOB_CANVAS) {
            return "render settings changed";
        }
        int revision = settings.has("cacheRevision")
                ? settings.get("cacheRevision").getAsInt()
                : CACHE_REVISION;
        if (revision != CACHE_REVISION) {
            return "export cache revision changed";
        }

        JsonObject errors = readObject(finalRoot.resolve("export-errors.json"));
        JsonObject previousVersions = errors.getAsJsonObject("modVersions");
        if (previousVersions == null || !modVersions().equals(stringMap(previousVersions))) {
            return "loaded mod versions changed";
        }
        return null;
    }

    @Nullable
    JsonObject matchingItem(String key, JsonObject currentWithoutIcon) throws IOException {
        JsonObject previous = item(key);
        if (previous == null || !sameStructure(previous, currentWithoutIcon, "icon")) {
            return null;
        }
        return previous;
    }

    /** Returns an exact prior catalog record for a cached synthetic recipe ingredient. */
    @Nullable
    JsonObject item(String key) throws IOException {
        if (items == null) {
            items = readKeyedArray(root.resolve("items.json"), "items", "k");
        }
        return items.get(key);
    }

    RecipeCategoryCache recipeCategory(ResourceLocation categoryId) throws IOException {
        Category category = categories.get(categoryId.toString());
        if (category == null) {
            return new RecipeCategoryCache(new HashMap<>(), List.of());
        }
        Path recipesFile = reusableFile(category.directory() + "/recipes.json");
        JsonArray recipes;
        try (Reader reader = Files.newBufferedReader(recipesFile)) {
            JsonElement rootElement = JsonParser.parseReader(reader);
            if (rootElement.isJsonArray()) {
                recipes = rootElement.getAsJsonArray();
            } else if (rootElement.isJsonObject()
                    && rootElement.getAsJsonObject().has("recipes")) {
                recipes = rootElement.getAsJsonObject().getAsJsonArray("recipes");
            } else {
                throw new IOException("Expected a recipe array in " + recipesFile);
            }
        }
        Map<String, ArrayDeque<CachedRecipe>> byFingerprint = new HashMap<>();
        java.util.ArrayList<CachedRecipe> allRecipes = new java.util.ArrayList<>();
        for (JsonElement element : recipes) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject recipe = element.getAsJsonObject();
            if (recipe.has("err") || !recipe.has("img")) {
                continue;
            }
            String image = category.directory() + "/" + recipe.get("img").getAsString();
            if (!Files.isRegularFile(reusableFile(image))) {
                continue;
            }
            String baseImageName = recipe.has("bg") ? recipe.get("bg").getAsString() : null;
            String baseImagePath = baseImageName == null
                    ? null
                    : category.directory() + "/" + baseImageName;
            if (baseImagePath != null && !Files.isRegularFile(reusableFile(baseImagePath))) {
                continue;
            }
            CachedRecipe cachedRecipe = new CachedRecipe(
                    recipe, image, baseImageName, baseImagePath);
            byFingerprint.computeIfAbsent(structuralFingerprint(recipe), ignored -> new ArrayDeque<>())
                    .addLast(cachedRecipe);
            allRecipes.add(cachedRecipe);
        }
        return new RecipeCategoryCache(byFingerprint, List.copyOf(allRecipes));
    }

    @Nullable
    String categoryIcon(ResourceLocation categoryId) {
        Category category = categories.get(categoryId.toString());
        return category == null ? null : category.icon();
    }

    boolean canReuseTrades() {
        return !priorTradeFailure && categories.containsKey("jeiexport:trading");
    }

    int categoryCount(ResourceLocation categoryId) {
        Category category = categories.get(categoryId.toString());
        return category == null ? -1 : category.count();
    }

    @Nullable
    JsonObject mob(ResourceLocation id) throws IOException {
        if (mobs == null) {
            mobs = readKeyedArray(root.resolve("mobs.json"), "mobs", "id");
        }
        return mobs.get(id.toString());
    }

    @Nullable
    JsonObject blockDrop(String key) throws IOException {
        if (blockDrops == null) {
            blockDrops = readObject(root.resolve("blockdrops.json")).getAsJsonObject("blocks");
            if (blockDrops == null) {
                blockDrops = new JsonObject();
            }
        }
        JsonElement entry = blockDrops.get(key);
        return entry != null && entry.isJsonObject() ? entry.getAsJsonObject() : null;
    }

    Path reusableFile(String relativePath) throws IOException {
        Path candidate = root.resolve(relativePath).normalize();
        if (!candidate.startsWith(root) || candidate.equals(root)) {
            throw new IOException("Cached path escapes the prior snapshot: " + relativePath);
        }
        return candidate;
    }

    private static Map<String, Category> readCategories(Path file) throws IOException {
        JsonArray array = readObject(file).getAsJsonArray("categories");
        Map<String, Category> result = new HashMap<>();
        if (array == null) {
            return result;
        }
        for (JsonElement element : array) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject category = element.getAsJsonObject();
            if (!category.has("id") || !category.has("dir")) {
                continue;
            }
            result.put(
                    category.get("id").getAsString(),
                    new Category(
                            category.get("dir").getAsString(),
                            category.has("icon") ? category.get("icon").getAsString() : null,
                            category.has("count") ? category.get("count").getAsInt() : -1));
        }
        return result;
    }

    private static boolean hasPriorTradeFailure(Path file) throws IOException {
        JsonArray failures = readObject(file).getAsJsonArray("failures");
        if (failures == null) {
            return false;
        }
        for (JsonElement element : failures) {
            if (!element.isJsonObject()) {
                continue;
            }
            JsonObject failure = element.getAsJsonObject();
            if (failure.has("categoryId")
                    && !failure.get("categoryId").isJsonNull()
                    && "jeiexport:trading".equals(failure.get("categoryId").getAsString())) {
                return true;
            }
            if (failure.has("message")) {
                String message = failure.get("message").getAsString().toLowerCase(java.util.Locale.ROOT);
                if (message.startsWith("trade ")
                        || message.startsWith("trades ")
                        || message.startsWith("trade render ")
                        || message.startsWith("trade listing ")) {
                    return true;
                }
            }
        }
        return false;
    }

    private static Map<String, JsonObject> readKeyedArray(Path file, String arrayName, String keyName)
            throws IOException {
        JsonArray array = readObject(file).getAsJsonArray(arrayName);
        Map<String, JsonObject> result = new HashMap<>();
        if (array == null) {
            return result;
        }
        for (JsonElement element : array) {
            if (element.isJsonObject() && element.getAsJsonObject().has(keyName)) {
                JsonObject object = element.getAsJsonObject();
                result.put(object.get(keyName).getAsString(), object);
            }
        }
        return result;
    }

    private static JsonObject readObject(Path file) throws IOException {
        try (Reader reader = Files.newBufferedReader(file)) {
            JsonElement element = JsonParser.parseReader(reader);
            if (!element.isJsonObject()) {
                throw new IOException("Expected a JSON object in " + file);
            }
            return element.getAsJsonObject();
        }
    }

    static String structuralFingerprint(JsonObject recipe) {
        JsonObject normalized = recipe.deepCopy();
        normalized.remove("img");
        normalized.remove("bg");
        normalized.remove("fingerprint");
        return Naming.sha256(canonicalJson(normalized));
    }

    private static boolean sameStructure(JsonObject previous, JsonObject current, String ignoredProperty) {
        JsonObject normalizedPrevious = previous.deepCopy();
        normalizedPrevious.remove(ignoredProperty);
        JsonObject normalizedCurrent = current.deepCopy();
        normalizedCurrent.remove(ignoredProperty);
        return canonicalJson(normalizedPrevious).equals(canonicalJson(normalizedCurrent));
    }

    private static String canonicalJson(JsonElement element) {
        if (element == null || element.isJsonNull() || element.isJsonPrimitive()) {
            return String.valueOf(element);
        }
        if (element.isJsonArray()) {
            StringBuilder out = new StringBuilder("[");
            boolean first = true;
            for (JsonElement child : element.getAsJsonArray()) {
                if (!first) out.append(',');
                first = false;
                out.append(canonicalJson(child));
            }
            return out.append(']').toString();
        }
        StringBuilder out = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, JsonElement> entry : new TreeMap<>(element.getAsJsonObject().asMap()).entrySet()) {
            if (!first) out.append(',');
            first = false;
            out.append(entry.getKey()).append(':').append(canonicalJson(entry.getValue()));
        }
        return out.append('}').toString();
    }

    private static Map<String, String> modVersions() {
        Map<String, String> versions = new TreeMap<>();
        for (var mod : ModList.get().getMods()) {
            if (!JeiExportMod.MOD_ID.equals(mod.getModId())) {
                versions.put(mod.getModId(), mod.getVersion().toString());
            }
        }
        return versions;
    }

    private static Map<String, String> stringMap(JsonObject object) {
        Map<String, String> values = new TreeMap<>();
        for (Map.Entry<String, JsonElement> entry : object.entrySet()) {
            if (!JeiExportMod.MOD_ID.equals(entry.getKey())) {
                values.put(entry.getKey(), entry.getValue().getAsString());
            }
        }
        return values;
    }

    private static int integer(JsonObject object, String name) {
        return object.has(name) ? object.get(name).getAsInt() : Integer.MIN_VALUE;
    }

    @Nullable
    private static String nullableString(JsonObject object, String name) {
        return object.has(name) && !object.get(name).isJsonNull() ? object.get(name).getAsString() : null;
    }

    @Nullable
    private static String string(JsonObject object, String name) {
        return nullableString(object, name);
    }
}
