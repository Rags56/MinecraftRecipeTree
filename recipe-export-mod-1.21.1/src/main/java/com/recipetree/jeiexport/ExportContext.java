package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.stream.JsonWriter;
import com.mojang.blaze3d.platform.NativeImage;
import mezz.jei.api.runtime.IIngredientManager;
import net.minecraft.SharedConstants;
import net.minecraft.Util;
import net.neoforged.fml.ModList;
import org.jetbrains.annotations.Nullable;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Shared state for one export run: output paths, the offscreen renderer, async
 * image writing, the ingredient catalog and the item->recipe index.
 */
final class ExportContext {
    static final int MAX_PENDING_IMAGE_WRITES = 32;
    final Path root;
    final Path finalRoot;
    final int iconScale;
    final PackIdentity packIdentity;
    @Nullable
    final IncrementalExportCache previous;
    final int recipeScale = ExportManifestContract.RECIPE_SCALE;
    final int mobCanvas = ExportManifestContract.MOB_CANVAS;

    final OffscreenRenderer renderer = new OffscreenRenderer();
    final AtomicInteger pendingWrites = new AtomicInteger();
    private final Semaphore imageWritePermits = new Semaphore(MAX_PENDING_IMAGE_WRITES);
    final List<String> failures = Collections.synchronizedList(new ArrayList<>());
    final List<ExportFailure> failureDetails = Collections.synchronizedList(new ArrayList<>());
    /** All relative paths handed out so far, to keep file/dir names collision-free. */
    final Set<String> usedPaths = new HashSet<>();

    /** key -> recipes that produce / use it. Filled by recipe-ish phases, written as index.json. */
    final Map<String, IndexEntry> recipeIndex = new TreeMap<>();

    /** All exported categories (JEI ones + synthetic ones like trading), written as categories.json. */
    private final JsonArray categoriesJson = new JsonArray();
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    int recipeCount;
    int categoryCount;
    int mobCount;
    int blockDropsCount;
    int reusedItems;
    int reusedCategoryIcons;
    int reusedRecipes;
    int reusedMobs;
    int reusedBlockDrops;
    int reusedTrades;
    int deduplicatedRecipeImages;
    @Nullable
    ExportDeltaArchive.Result deltaArchive;

    @Nullable
    private ItemCatalog catalog;

    static final class IndexEntry {
        final List<int[]> produced = new ArrayList<>();
        final List<int[]> used = new ArrayList<>();
    }

    ExportContext(Path finalRoot, int iconScale, PackIdentity packIdentity) throws IOException {
        this(finalRoot, iconScale, packIdentity, false);
    }

    ExportContext(Path finalRoot, int iconScale, PackIdentity packIdentity, boolean forceRebuild) throws IOException {
        this.finalRoot = finalRoot.toAbsolutePath().normalize();
        Path parent = this.finalRoot.getParent();
        if (parent == null) {
            throw new IOException("Export output must have a parent directory: " + this.finalRoot);
        }
        this.root = parent.resolve("." + this.finalRoot.getFileName()
                + ".staging-" + UUID.randomUUID()).normalize();
        this.iconScale = iconScale;
        this.packIdentity = packIdentity;
        this.previous = IncrementalExportCache.load(
                this.finalRoot, iconScale, packIdentity, forceRebuild);
        if (!root.getParent().equals(parent)) {
            throw new IOException("Staging output escaped the export directory: " + root);
        }
        Files.createDirectories(root);
        JeiExportMod.LOGGER.info("[jeiexport] Writing transactional snapshot to {}", root);
    }

    boolean reusePreviousFile(String previousRelativePath, String newRelativePath) {
        if (previous == null) {
            return false;
        }
        final Path source;
        final Path destination;
        try {
            source = previous.reusableFile(previousRelativePath);
            destination = stagingFile(newRelativePath);
            if (!Files.isRegularFile(source)) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Incremental cache record references missing file {}; regenerating it",
                        source);
                return false;
            }
            Files.createDirectories(destination.getParent());
            try {
                Files.createLink(destination, source);
            } catch (UnsupportedOperationException | IOException linkFailure) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Hard-link reuse failed for {}; copying the validated prior file instead",
                        previousRelativePath,
                        linkFailure);
                Files.copy(source, destination, StandardCopyOption.COPY_ATTRIBUTES);
            }
            return true;
        } catch (IOException reuseFailure) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Could not reuse cached file {}; regenerating it",
                    previousRelativePath,
                    reuseFailure);
            return false;
        }
    }

    boolean reserveAndReusePreviousFile(String previousRelativePath, String newRelativePath) {
        if (!usedPaths.add(newRelativePath)) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Cached path {} collides with another export path; regenerating with a unique name",
                    newRelativePath);
            return false;
        }
        if (reusePreviousFile(previousRelativePath, newRelativePath)) {
            return true;
        }
        usedPaths.remove(newRelativePath);
        return false;
    }

    private Path stagingFile(String relativePath) throws IOException {
        Path destination = root.resolve(relativePath).normalize();
        if (!destination.startsWith(root) || destination.equals(root)) {
            throw new IOException("Incremental destination escapes staging snapshot: " + relativePath);
        }
        return destination;
    }

    int reusedTotal() {
        return reusedItems + reusedCategoryIcons + reusedRecipes + reusedMobs + reusedBlockDrops + reusedTrades;
    }

    String incrementalStatus() {
        return previous == null
                ? "starting fresh"
                : String.format(java.util.Locale.ROOT, "%,d already saved", reusedTotal());
    }

    ItemCatalog catalog(IIngredientManager manager) throws IOException {
        if (catalog == null) {
            catalog = new ItemCatalog(this, manager);
        }
        return catalog;
    }

    /** Queue a PNG write on the IO pool; the image is closed after writing. */
    void saveImage(NativeImage image, Path file) {
        try {
            imageWritePermits.acquire();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            image.close();
            failure("write scheduling " + root.relativize(file)
                    + ": interrupted while applying image-write backpressure");
            return;
        }
        pendingWrites.incrementAndGet();
        try {
            Util.ioPool().execute(() -> {
                try {
                    Files.createDirectories(file.getParent());
                    image.writeToFile(file);
                    try {
                        PngIntegrity.verify(file);
                    } catch (IOException nativeWriteFailure) {
                        JeiExportMod.LOGGER.warn(
                                "[jeiexport] Native PNG verification failed for {}; retrying with Java ImageIO",
                                root.relativize(file), nativeWriteFailure);
                        writePngWithImageIo(image, file);
                        PngIntegrity.verify(file);
                    }
                } catch (Throwable t) {
                    failure("write " + root.relativize(file), t);
                } finally {
                    image.close();
                    pendingWrites.decrementAndGet();
                    imageWritePermits.release();
                }
            });
        } catch (RuntimeException e) {
            image.close();
            pendingWrites.decrementAndGet();
            imageWritePermits.release();
            failure("write scheduling " + root.relativize(file), e);
        }
    }

    private static void writePngWithImageIo(NativeImage image, Path file) throws IOException {
        int width = image.getWidth();
        int height = image.getHeight();
        BufferedImage buffered = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        int[] row = new int[width];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int abgr = image.getPixelRGBA(x, y);
                row[x] = (abgr & 0xFF000000)
                        | ((abgr & 0x000000FF) << 16)
                        | (abgr & 0x0000FF00)
                        | ((abgr & 0x00FF0000) >>> 16);
            }
            buffered.setRGB(0, y, width, 1, row, 0, width);
        }
        if (!ImageIO.write(buffered, "PNG", file.toFile())) {
            throw new IOException("No Java ImageIO PNG writer is available");
        }
    }

    void failure(String message) {
        failures.add(message);
        failureDetails.add(ExportFailure.generic(message));
        JeiExportMod.LOGGER.warn("[jeiexport] {}", message);
    }

    /**
     * Records an expected compatibility fallback without marking the completed snapshot as failed.
     * These warnings remain visible in the game log, while failures.json and export-errors.json stay
     * reserved for defects that require a rerun or exporter/mod fix.
     */
    void warning(String message) {
        JeiExportMod.LOGGER.warn("[jeiexport] {}", message);
    }

    void failure(String message, Throwable error) {
        ExportFailure failure = ExportFailure.generic(message, error);
        failures.add(failure.message);
        failureDetails.add(failure);
        JeiExportMod.LOGGER.warn("[jeiexport] {}", failure.message, error);
    }

    void recipeFailure(
            net.minecraft.resources.ResourceLocation categoryId,
            @Nullable net.minecraft.resources.ResourceLocation recipeId,
            int recipeIndex,
            @Nullable Class<?> recipeClass,
            String message,
            @Nullable Throwable error) {
        ExportFailure failure = ExportFailure.recipe(
                categoryId, recipeId, recipeIndex, recipeClass, message, error);
        failures.add(failure.message);
        failureDetails.add(failure);
        if (error == null) {
            JeiExportMod.LOGGER.warn("[jeiexport] {}", failure.message);
        } else {
            JeiExportMod.LOGGER.warn("[jeiexport] {}", failure.message, error);
        }
    }

    /** Reserve a unique sanitized relative file path like "icons/item/minecraft/stone.png". */
    String uniquePath(String dir, String baseName, String extension) {
        String base = dir + "/" + Naming.sanitize(baseName);
        String candidate = base + extension;
        int n = 2;
        while (!usedPaths.add(candidate)) {
            candidate = base + "_" + n++ + extension;
        }
        return candidate;
    }

    /** Appends a category entry and returns its index (used in index.json refs). */
    int registerCategory(JsonObject category) {
        categoriesJson.add(category);
        categoryCount = categoriesJson.size();
        return categoriesJson.size() - 1;
    }

    void indexRecipe(String key, boolean isOutput, int categoryIndex, int recipeIndexInCategory) {
        IndexEntry entry = recipeIndex.computeIfAbsent(key, k -> new IndexEntry());
        (isOutput ? entry.produced : entry.used).add(new int[]{categoryIndex, recipeIndexInCategory});
    }

    boolean hasProducedRecipe(String key) {
        IndexEntry entry = recipeIndex.get(key);
        return entry != null && !entry.produced.isEmpty();
    }

    int catalogCount() {
        return catalog == null ? 0 : catalog.count();
    }

    /** Closes writers and writes index.json, failures.json and manifest.json. */
    void finishAndClose(boolean aborted, long durationMs) throws IOException {
        int itemCount = catalogCount();
        if (catalog != null) {
            catalog.close();
            catalog = null;
        }
        renderer.close();

        if (categoriesJson.size() > 0) {
            JsonObject categoriesRoot = new JsonObject();
            categoriesRoot.add("categories", categoriesJson);
            try (var writer = Files.newBufferedWriter(root.resolve("categories.json"))) {
                GSON.toJson(categoriesRoot, writer);
            }
        }

        if (!recipeIndex.isEmpty()) {
            try (JsonWriter w = new JsonWriter(Files.newBufferedWriter(root.resolve("index.json")))) {
                w.beginObject();
                for (Map.Entry<String, IndexEntry> e : recipeIndex.entrySet()) {
                    w.name(e.getKey());
                    w.beginObject();
                    writeRefs(w, "p", e.getValue().produced);
                    writeRefs(w, "u", e.getValue().used);
                    w.endObject();
                }
                w.endObject();
            }
        }

        List<String> failuresCopy;
        synchronized (failures) {
            failuresCopy = new ArrayList<>(failures);
        }
        try (JsonWriter w = new JsonWriter(Files.newBufferedWriter(root.resolve("failures.json")))) {
            w.beginArray();
            for (String f : failuresCopy) {
                w.value(f);
            }
            w.endArray();
        }

        List<ExportFailure> failureDetailsCopy;
        synchronized (failureDetails) {
            failureDetailsCopy = new ArrayList<>(failureDetails);
        }
        JsonObject exportErrors = new JsonObject();
        exportErrors.addProperty("format", "mrt-export-errors-v1");
        JsonObject errorPack = new JsonObject();
        errorPack.addProperty("name", packIdentity.name());
        if (packIdentity.version() != null) errorPack.addProperty("version", packIdentity.version());
        exportErrors.add("pack", errorPack);
        exportErrors.addProperty("minecraft", SharedConstants.getCurrentVersion().getName());
        JsonObject errorExporter = new JsonObject();
        errorExporter.addProperty("id", JeiExportMod.MOD_ID);
        errorExporter.addProperty("version", exporterVersion());
        exportErrors.add("exporter", errorExporter);
        JsonObject errorModVersions = new JsonObject();
        for (var mod : ModList.get().getMods().stream()
                .sorted(Comparator.comparing(info -> info.getModId()))
                .toList()) {
            errorModVersions.addProperty(mod.getModId(), mod.getVersion().toString());
        }
        exportErrors.add("modVersions", errorModVersions);
        exportErrors.add("failures", new GsonBuilder()
                .disableHtmlEscaping()
                .serializeNulls()
                .create()
                .toJsonTree(failureDetailsCopy));
        try (var writer = Files.newBufferedWriter(root.resolve("export-errors.json"))) {
            GSON.toJson(exportErrors, writer);
        }

        try (JsonWriter w = new JsonWriter(Files.newBufferedWriter(root.resolve("manifest.json")))) {
            w.setIndent("  ");
            w.beginObject();
            w.name("format").value(1);
            w.name("generatedAt").value(Instant.now().toString());
            w.name("durationMs").value(durationMs);
            w.name("aborted").value(aborted);
            w.name("pack").beginObject()
                    .name("name").value(packIdentity.name());
            if (packIdentity.version() != null) {
                w.name("version").value(packIdentity.version());
            }
            w.name("identitySource").value(packIdentity.identitySource())
                    .endObject();
            w.name("minecraft").value(SharedConstants.getCurrentVersion().getName());
            w.name("exporter").beginObject()
                    .name("id").value(JeiExportMod.MOD_ID)
                    .name("version").value(exporterVersion())
                    .endObject();
            w.name("settings").beginObject()
                    .name("iconScale").value(iconScale)
                    .name("recipeScale").value(recipeScale)
                    .name("mobCanvas").value(mobCanvas)
                    .name("cacheRevision").value(IncrementalExportCache.CACHE_REVISION)
                    .endObject();
            w.name("incremental").beginObject()
                    .name("cacheUsed").value(previous != null)
                    .name("itemsReused").value(reusedItems)
                    .name("categoryIconsReused").value(reusedCategoryIcons)
                    .name("recipesReused").value(reusedRecipes)
                    .name("mobsReused").value(reusedMobs)
                    .name("blockDropsReused").value(reusedBlockDrops)
                    .name("tradesReused").value(reusedTrades)
                    .endObject();
            w.name("optimizations").beginObject()
                    .name("deduplicatedRecipeImages").value(deduplicatedRecipeImages)
                    .name("deltaFormat").value(ExportDeltaArchive.FORMAT)
                    .endObject();
            w.name("counts").beginObject()
                    .name("items").value(itemCount)
                    .name("recipes").value(recipeCount)
                    .name("categories").value(categoryCount)
                    .name("mobs").value(mobCount)
                    .name("blockDrops").value(blockDropsCount)
                    .name("failures").value(failuresCopy.size())
                    .endObject();
            ExportManifestContract.writeDiagnostics(w, failuresCopy.size());
            w.name("mods").beginObject();
            for (var mod : ModList.get().getMods().stream()
                    .sorted(Comparator.comparing(info -> info.getModId()))
                    .toList()) {
                w.name(mod.getModId()).value(mod.getDisplayName());
            }
            w.endObject();
            w.endObject();
        }
    }

    private static String exporterVersion() {
        return ModList.get().getModContainerById(JeiExportMod.MOD_ID)
                .map(container -> container.getModInfo().getVersion().toString())
                .orElse("unknown");
    }

    /**
     * Replaces the completed snapshot without exposing a half-written directory.
     * Both moves stay on the same filesystem; a prior snapshot is restored if the
     * staging promotion fails.
     */
    void publishCompletedSnapshot() throws IOException {
        if (pendingWrites.get() != 0) {
            throw new IOException("Cannot publish with " + pendingWrites.get() + " pending image writes");
        }
        Path parent = finalRoot.getParent();
        Path backup = parent.resolve("." + finalRoot.getFileName()
                + ".previous-" + UUID.randomUUID()).normalize();
        Path deltaPath = parent.resolve(finalRoot.getFileName() + "-update.zip").normalize();
        Path stagedDeltaPath = parent.resolve("." + finalRoot.getFileName()
                + "-update.staging-" + UUID.randomUUID() + ".zip").normalize();
        ExportDeltaArchive.Result preparedDelta = null;
        if (Files.isDirectory(finalRoot)) {
            try {
                preparedDelta = ExportDeltaArchive.create(finalRoot, root, stagedDeltaPath);
            } catch (Exception deltaFailure) {
                deleteIfExistsQuietly(stagedDeltaPath, "discard incomplete update ZIP");
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Full export is complete, but its smaller update ZIP could not be prepared",
                        deltaFailure);
            }
        }
        boolean previousMoved = false;
        try {
            if (Files.exists(finalRoot)) {
                moveWithLoggedAtomicFallback(finalRoot, backup, "preserve previous completed snapshot");
                previousMoved = true;
            }
            moveWithLoggedAtomicFallback(root, finalRoot, "publish completed snapshot");
        } catch (IOException promotionFailure) {
            if (previousMoved && Files.exists(backup) && !Files.exists(finalRoot)) {
                try {
                    moveWithLoggedAtomicFallback(backup, finalRoot, "restore previous completed snapshot");
                } catch (IOException restoreFailure) {
                    promotionFailure.addSuppressed(restoreFailure);
                    JeiExportMod.LOGGER.error(
                            "[jeiexport] Snapshot promotion and previous-snapshot restoration both failed; "
                                    + "the preserved snapshot remains at {}",
                            backup, restoreFailure);
                }
            }
            deleteIfExistsQuietly(stagedDeltaPath, "discard update ZIP after snapshot promotion failure");
            throw promotionFailure;
        }
        if (previousMoved) {
            try {
                deleteTree(backup);
            } catch (IOException cleanupFailure) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Published the new snapshot but could not remove previous snapshot backup {}",
                        backup, cleanupFailure);
            }
        }
        if (preparedDelta != null) {
            try {
                replaceWithLoggedAtomicFallback(
                        stagedDeltaPath,
                        deltaPath,
                        "publish delta archive");
                deltaArchive = new ExportDeltaArchive.Result(
                        deltaPath,
                        preparedDelta.basePublicationId(),
                        preparedDelta.resultPublicationId(),
                        preparedDelta.changedFiles(),
                        preparedDelta.deletedFiles(),
                        preparedDelta.unchangedFiles(),
                        preparedDelta.changedBytes(),
                        preparedDelta.resultBytes());
                JeiExportMod.LOGGER.info(
                        "[jeiexport] Published update ZIP {} ({} changed, {} deleted, {} unchanged files)",
                        deltaPath,
                        preparedDelta.changedFiles(),
                        preparedDelta.deletedFiles(),
                        preparedDelta.unchangedFiles());
            } catch (IOException deltaPublishFailure) {
                deleteIfExistsQuietly(stagedDeltaPath, "discard unpublished update ZIP");
                deleteIfExistsQuietly(deltaPath, "remove stale update ZIP");
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Full export was published, but its update ZIP could not be published",
                        deltaPublishFailure);
            }
        } else {
            deleteIfExistsQuietly(stagedDeltaPath, "discard unused update ZIP");
            deleteIfExistsQuietly(deltaPath, "remove stale update ZIP");
        }
        JeiExportMod.LOGGER.info("[jeiexport] Published completed snapshot to {}", finalRoot);
    }

    private static void moveWithLoggedAtomicFallback(Path source, Path destination, String operation)
            throws IOException {
        try {
            Files.move(source, destination, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException unsupported) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Atomic move unavailable while {}; using a same-filesystem non-atomic move: {}",
                    operation, unsupported.toString());
            Files.move(source, destination);
        }
    }

    private static void replaceWithLoggedAtomicFallback(Path source, Path destination, String operation)
            throws IOException {
        try {
            Files.move(
                    source,
                    destination,
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException unsupported) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Atomic move unavailable while {}; replacing with a same-filesystem move: {}",
                    operation,
                    unsupported.toString());
            Files.move(source, destination, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private static void deleteIfExistsQuietly(Path path, String operation) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException cleanupFailure) {
            JeiExportMod.LOGGER.warn("[jeiexport] Could not {} {}", operation, path, cleanupFailure);
        }
    }

    private static void deleteTree(Path path) throws IOException {
        if (!Files.exists(path)) {
            return;
        }
        try (var paths = Files.walk(path)) {
            for (Path entry : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.delete(entry);
            }
        }
    }

    private static void writeRefs(JsonWriter w, String name, List<int[]> refs) throws IOException {
        w.name(name);
        w.beginArray();
        for (int[] ref : refs) {
            w.beginArray();
            w.value(ref[0]);
            w.value(ref[1]);
            w.endArray();
        }
        w.endArray();
    }
}
