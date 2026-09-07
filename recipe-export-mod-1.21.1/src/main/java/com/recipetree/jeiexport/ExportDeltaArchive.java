package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.jetbrains.annotations.Nullable;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Builds a small, single-base update archive beside a completed full export. */
final class ExportDeltaArchive {
    static final String FORMAT = "mrt-export-delta-v1";
    static final String DOCUMENT_NAME = "delta.json";
    private static final double MAX_CHANGED_RAW_RATIO = 0.80;
    private static final int MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
    private static final int COPY_BUFFER_BYTES = 64 * 1024;
    private static final LocalDateTime ZIP_ENTRY_TIME = LocalDateTime.of(1980, 1, 1, 0, 0);
    private static final List<String> ALWAYS_INCLUDE_PATHS = List.of(
            "failures.json",
            "export-errors.json",
            "exporter-build.json");
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    record Result(
            Path path,
            String basePublicationId,
            String resultPublicationId,
            int changedFiles,
            int deletedFiles,
            int unchangedFiles,
            long changedBytes,
            long resultBytes) {
    }

    private record Fingerprint(long size, String sha256) {
    }

    private ExportDeltaArchive() {
    }

    /**
     * Creates an update ZIP when the prior snapshot is a compatible base and the changed payload
     * is meaningfully smaller than another full archive. Returns {@code null} when a full export
     * is the safer or smaller handoff.
     */
    @Nullable
    static Result create(Path baseRoot, Path resultRoot, Path destination) throws IOException {
        if (!Files.isDirectory(baseRoot) || !Files.isDirectory(resultRoot)) {
            return null;
        }
        JsonObject baseManifest = readObject(baseRoot.resolve("manifest.json"));
        JsonObject resultManifest = readObject(resultRoot.resolve("manifest.json"));
        if (!compatibleBase(baseManifest, resultManifest)) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Previous snapshot is not a compatible delta base; keeping only the full export");
            return null;
        }

        Map<String, Path> baseFiles = regularFiles(baseRoot);
        Map<String, Path> resultFiles = regularFiles(resultRoot);
        for (String required : List.of("manifest.json", "items.json", "categories.json", "index.json")) {
            if (!resultFiles.containsKey(required)) {
                throw new IOException("Completed snapshot is missing required delta file " + required);
            }
        }

        Map<String, Fingerprint> changed = new TreeMap<>();
        byte[] hashBuffer = new byte[COPY_BUFFER_BYTES];
        int unchanged = 0;
        long resultBytes = 0;
        for (Map.Entry<String, Path> entry : resultFiles.entrySet()) {
            String relativePath = entry.getKey();
            Path resultFile = entry.getValue();
            long resultSize = Files.size(resultFile);
            resultBytes += resultSize;
            Path baseFile = baseFiles.get(relativePath);
            if (baseFile != null && Files.size(baseFile) == resultSize) {
                try {
                    if (Files.isSameFile(baseFile, resultFile)) {
                        unchanged++;
                        continue;
                    }
                } catch (IOException ignored) {
                    // Fall back to content hashing when file identity is unavailable.
                }
                if (Files.mismatch(baseFile, resultFile) == -1) {
                    unchanged++;
                    continue;
                }
                changed.put(relativePath, fingerprint(resultFile, resultSize, hashBuffer));
                continue;
            }
            changed.put(relativePath, fingerprint(resultFile, resultSize, hashBuffer));
        }
        for (String reportPath : ALWAYS_INCLUDE_PATHS) {
            Path reportFile = resultFiles.get(reportPath);
            if (reportFile != null && !changed.containsKey(reportPath)) {
                changed.put(
                        reportPath,
                        fingerprint(reportFile, Files.size(reportFile), hashBuffer));
                unchanged--;
            }
        }

        List<String> deleted = baseFiles.keySet().stream()
                .filter(path -> !resultFiles.containsKey(path))
                .sorted()
                .toList();
        long changedBytes = changed.values().stream().mapToLong(Fingerprint::size).sum();
        if (resultBytes <= 0
                || changedBytes > Math.floor(resultBytes * MAX_CHANGED_RAW_RATIO)) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Delta would contain {} of {} bytes ({}%); keeping only the full export",
                    changedBytes,
                    resultBytes,
                    Math.round(changedBytes * 100.0 / Math.max(1, resultBytes)));
            return null;
        }

        String basePublicationId = fingerprint(
                baseRoot.resolve("manifest.json"),
                Files.size(baseRoot.resolve("manifest.json")),
                hashBuffer).sha256();
        Fingerprint changedManifest = changed.get("manifest.json");
        String resultPublicationId = changedManifest == null
                ? fingerprint(
                        resultRoot.resolve("manifest.json"),
                        Files.size(resultRoot.resolve("manifest.json")),
                        hashBuffer).sha256()
                : changedManifest.sha256();
        if (basePublicationId.equals(resultPublicationId)) {
            return null;
        }

        JsonObject document = deltaDocument(
                baseManifest,
                resultManifest,
                basePublicationId,
                resultPublicationId,
                changed,
                deleted,
                unchanged,
                changedBytes,
                resultBytes,
                resultFiles.size());
        byte[] documentBytes = GSON.toJson(document).getBytes(StandardCharsets.UTF_8);
        if (documentBytes.length > MAX_DOCUMENT_BYTES) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Delta inventory needs {} bytes; keeping only the full export",
                    documentBytes.length);
            return null;
        }
        Path parent = destination.toAbsolutePath().normalize().getParent();
        if (parent == null) {
            throw new IOException("Delta archive must have a parent directory: " + destination);
        }
        Files.createDirectories(parent);
        Files.deleteIfExists(destination);
        boolean completed = false;
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(destination))) {
            writeBytes(zip, DOCUMENT_NAME, documentBytes);
            byte[] buffer = new byte[COPY_BUFFER_BYTES];
            for (Map.Entry<String, Fingerprint> entry : changed.entrySet()) {
                String relativePath = entry.getKey();
                writeFile(zip, relativePath, resultFiles.get(relativePath), buffer);
            }
            completed = true;
        } finally {
            if (!completed) Files.deleteIfExists(destination);
        }
        return new Result(
                destination,
                basePublicationId,
                resultPublicationId,
                changed.size(),
                deleted.size(),
                unchanged,
                changedBytes,
                resultBytes);
    }

    private static JsonObject deltaDocument(
            JsonObject baseManifest,
            JsonObject resultManifest,
            String basePublicationId,
            String resultPublicationId,
            Map<String, Fingerprint> changed,
            List<String> deleted,
            int unchanged,
            long changedBytes,
            long resultBytes,
            int resultFiles) {
        JsonObject document = new JsonObject();
        document.addProperty("format", FORMAT);
        document.addProperty("createdAt", Instant.now().toString());
        document.addProperty("basePublicationId", basePublicationId);
        document.addProperty("resultPublicationId", resultPublicationId);
        document.addProperty("minecraft", string(resultManifest, "minecraft"));
        JsonObject pack = new JsonObject();
        JsonObject basePack = baseManifest.getAsJsonObject("pack");
        JsonObject resultPack = resultManifest.getAsJsonObject("pack");
        pack.addProperty("name", string(resultPack, "name"));
        addNullable(pack, "baseVersion", nullableString(basePack, "version"));
        addNullable(pack, "resultVersion", nullableString(resultPack, "version"));
        document.add("pack", pack);

        JsonArray files = new JsonArray();
        for (Map.Entry<String, Fingerprint> entry : changed.entrySet()) {
            JsonObject file = new JsonObject();
            file.addProperty("path", entry.getKey());
            file.addProperty("size", entry.getValue().size());
            file.addProperty("sha256", entry.getValue().sha256());
            files.add(file);
        }
        document.add("files", files);
        JsonArray deletedPaths = new JsonArray();
        deleted.forEach(deletedPaths::add);
        document.add("deletedPaths", deletedPaths);

        JsonObject counts = new JsonObject();
        counts.addProperty("changedFiles", changed.size());
        counts.addProperty("deletedFiles", deleted.size());
        counts.addProperty("unchangedFiles", unchanged);
        counts.addProperty("resultFiles", resultFiles);
        counts.addProperty("changedBytes", changedBytes);
        counts.addProperty("resultBytes", resultBytes);
        document.add("counts", counts);
        return document;
    }

    private static boolean compatibleBase(JsonObject base, JsonObject result) {
        if (integer(base, "format") != 1
                || integer(result, "format") != 1
                || booleanValue(base, "aborted")
                || booleanValue(result, "aborted")
                || !string(base, "minecraft").equals(string(result, "minecraft"))) {
            return false;
        }
        JsonObject basePack = base.getAsJsonObject("pack");
        JsonObject resultPack = result.getAsJsonObject("pack");
        if (basePack == null
                || resultPack == null
                || !string(basePack, "name").equals(string(resultPack, "name"))) {
            return false;
        }
        JsonObject baseSettings = base.getAsJsonObject("settings");
        JsonObject resultSettings = result.getAsJsonObject("settings");
        if (baseSettings == null || resultSettings == null) {
            return false;
        }
        return integer(baseSettings, "iconScale") == integer(resultSettings, "iconScale")
                && integer(baseSettings, "recipeScale") == integer(resultSettings, "recipeScale")
                && integer(baseSettings, "mobCanvas") == integer(resultSettings, "mobCanvas");
    }

    private static Map<String, Path> regularFiles(Path root) throws IOException {
        Map<String, Path> files = new LinkedHashMap<>();
        try (var paths = Files.walk(root)) {
            for (Path path : paths.filter(path -> Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS))
                    .sorted(Comparator.comparing(value -> root.relativize(value).toString()))
                    .toList()) {
                String relative = root.relativize(path).toString().replace(path.getFileSystem().getSeparator(), "/");
                files.put(relative, path);
            }
        }
        return files;
    }

    private static Fingerprint fingerprint(Path path, long size, byte[] buffer) throws IOException {
        MessageDigest digest = sha256();
        try (InputStream input = new BufferedInputStream(Files.newInputStream(path))) {
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        return new Fingerprint(size, HexFormat.of().formatHex(digest.digest()));
    }

    private static void writeBytes(ZipOutputStream zip, String name, byte[] bytes)
            throws IOException {
        zip.setLevel(Deflater.BEST_SPEED);
        ZipEntry entry = new ZipEntry(name);
        entry.setTimeLocal(ZIP_ENTRY_TIME);
        zip.putNextEntry(entry);
        zip.write(bytes);
        zip.closeEntry();
    }

    private static void writeFile(ZipOutputStream zip, String name, Path path, byte[] buffer)
            throws IOException {
        zip.setLevel(isPrecompressed(name) ? Deflater.NO_COMPRESSION : Deflater.BEST_SPEED);
        ZipEntry entry = new ZipEntry(name);
        entry.setTimeLocal(ZIP_ENTRY_TIME);
        zip.putNextEntry(entry);
        try (InputStream input = new BufferedInputStream(Files.newInputStream(path))) {
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) zip.write(buffer, 0, read);
            }
        }
        zip.closeEntry();
    }

    private static boolean isPrecompressed(String path) {
        String lower = path.toLowerCase(java.util.Locale.ROOT);
        return lower.endsWith(".png")
                || lower.endsWith(".jpg")
                || lower.endsWith(".jpeg")
                || lower.endsWith(".webp")
                || lower.endsWith(".gif")
                || lower.endsWith(".zip");
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

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static void addNullable(JsonObject object, String name, @Nullable String value) {
        if (value == null) object.add(name, com.google.gson.JsonNull.INSTANCE);
        else object.addProperty(name, value);
    }

    private static int integer(JsonObject object, String name) {
        return object.has(name) ? object.get(name).getAsInt() : Integer.MIN_VALUE;
    }

    private static boolean booleanValue(JsonObject object, String name) {
        return object.has(name) && object.get(name).getAsBoolean();
    }

    @Nullable
    private static String nullableString(JsonObject object, String name) {
        return object.has(name) && !object.get(name).isJsonNull() ? object.get(name).getAsString() : null;
    }

    private static String string(JsonObject object, String name) {
        String value = nullableString(object, name);
        return value == null ? "" : value;
    }
}
