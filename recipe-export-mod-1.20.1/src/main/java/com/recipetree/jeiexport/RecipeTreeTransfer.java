package com.recipetree.jeiexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Bounded, explicit portable-tree import. */
final class RecipeTreeTransfer {
    static final long MAX_TREE_BYTES = 1024L * 1024L;
    static final int MAX_LISTED_FILES = 128;

    static JsonObject validate(String json) throws IOException {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > MAX_TREE_BYTES)
            throw new IOException("Recipe tree exceeds the 1 MiB limit");
        try {
            JsonObject root = com.google.gson.JsonParser.parseString(json).getAsJsonObject();
            validateSelections(root.getAsJsonArray("selections"), true);
            if (root.has("reusableInputs")) validateSelections(root.getAsJsonArray("reusableInputs"), false);
            if (root.has("roots")) {
                JsonArray roots = root.getAsJsonArray("roots");
                if (roots.size() > 16) throw new IOException("Too many starting outputs");
                for (JsonElement child : roots) validateSelections(child.getAsJsonObject().getAsJsonArray("selections"), true);
            }
            return root;
        } catch (RuntimeException error) {
            throw new IOException("Invalid recipe-tree JSON", error);
        }
    }

    private static void validateSelections(JsonArray selections, boolean requireSource) throws IOException {
        if (selections == null || selections.size() > 2048) throw new IOException("Invalid selection count");
        Set<List<Integer>> seen = new HashSet<>();
        for (JsonElement element : selections) {
            JsonObject selection = element.getAsJsonObject();
            JsonArray path = selection.getAsJsonArray("path");
            if (path == null || path.size() > 12) throw new IOException("Invalid selection depth");
            List<Integer> normalizedPath = new ArrayList<>();
            for (JsonElement index : path) {
                if (!index.isJsonPrimitive() || !index.getAsJsonPrimitive().isNumber())
                    throw new IOException("Selection path must contain numeric integers");
                int value;
                try { value = index.getAsBigDecimal().intValueExact(); }
                catch (ArithmeticException error) { throw new IOException("Selection path must contain integers", error); }
                if (value < 0 || value >= 32) throw new IOException("Invalid selection child index");
                normalizedPath.add(value);
            }
            if (!seen.add(normalizedPath)) throw new IOException("Duplicate selection path");
            if (!selection.has("itemKey")) throw new IOException("Missing ingredient identity");
            if (requireSource && !selection.has("source")) throw new IOException("Missing selection source");
        }
    }

    static List<Path> listShareFiles(Path directory) throws IOException {
        if (!Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) return Collections.emptyList();
        if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Recipe tree share location is not a directory: " + directory);
        }
        List<Path> files = new ArrayList<Path>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(directory, "*.mrtree.json")) {
            for (Path file : stream) {
                if (Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) files.add(file);
            }
        }
        Collections.sort(files, new Comparator<Path>() {
            @Override
            public int compare(Path left, Path right) {
                try {
                    return Files.getLastModifiedTime(right, LinkOption.NOFOLLOW_LINKS)
                            .compareTo(Files.getLastModifiedTime(left, LinkOption.NOFOLLOW_LINKS));
                } catch (IOException error) {
                    JeiExportMod.LOGGER.warn(
                            "[jeiexport] Could not compare recipe-tree share timestamps for {} "
                                    + "and {}; keeping their filename order",
                            left, right, error);
                    return left.getFileName().toString().compareToIgnoreCase(
                            right.getFileName().toString());
                }
            }
        });
        if (files.size() > MAX_LISTED_FILES) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Recipe-tree share folder contains {} files; showing only the "
                            + "newest {}",
                    files.size(), MAX_LISTED_FILES);
            return new ArrayList<Path>(files.subList(0, MAX_LISTED_FILES));
        }
        return files;
    }

    static String readBoundedUtf8(Path file) throws IOException {
        BasicFileAttributes attributes = Files.readAttributes(
                file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        if (!attributes.isRegularFile()) {
            throw new IOException("Recipe tree must be a regular, non-symbolic-link file: " + file);
        }
        if (attributes.size() > MAX_TREE_BYTES) {
            throw new IOException("Recipe tree exceeds the " + MAX_TREE_BYTES + "-byte limit");
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream((int) attributes.size());
        byte[] buffer = new byte[8192];
        long total = 0L;
        try (InputStream input = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > MAX_TREE_BYTES) {
                    throw new IOException("Recipe tree grew beyond the " + MAX_TREE_BYTES
                            + "-byte limit while being read");
                }
                bytes.write(buffer, 0, read);
            }
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException invalid) {
            throw new IOException("Recipe tree is not valid UTF-8", invalid);
        }
    }

}
