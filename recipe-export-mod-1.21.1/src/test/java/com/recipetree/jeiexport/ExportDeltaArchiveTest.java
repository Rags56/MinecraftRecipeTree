package com.recipetree.jeiexport;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.zip.ZipFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ExportDeltaArchiveTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void writesOnlyChangedFilesAndRecordsDeletedFiles() throws Exception {
        Path base = temporaryDirectory.resolve("base");
        Path result = temporaryDirectory.resolve("result");
        Files.createDirectories(base.resolve("recipes/example"));
        Files.createDirectories(result.resolve("recipes/example"));
        writeSnapshotDocuments(base, "1.0.0", "2026-08-01T00:00:00Z");
        writeSnapshotDocuments(result, "1.0.1", "2026-08-02T00:00:00Z");
        byte[] unchanged = new byte[32 * 1024];
        Arrays.fill(unchanged, (byte) 7);
        Files.write(base.resolve("recipes/example/r0.png"), unchanged);
        Files.write(result.resolve("recipes/example/r0.png"), unchanged);
        Files.writeString(base.resolve("recipes/example/deleted.txt"), "remove me");
        Files.writeString(base.resolve("recipes/example/changed.txt"), "old");
        Files.writeString(result.resolve("recipes/example/changed.txt"), "new");
        Files.writeString(result.resolve("recipes/example/added.txt"), "added");

        Path archive = temporaryDirectory.resolve("update.zip");
        ExportDeltaArchive.Result delta = ExportDeltaArchive.create(base, result, archive);

        assertNotNull(delta);
        assertTrue(Files.isRegularFile(archive));
        assertEquals(4, delta.unchangedFiles());
        assertEquals(1, delta.deletedFiles());
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            Set<String> names = zip.stream().map(entry -> entry.getName()).collect(Collectors.toSet());
            assertTrue(names.contains("delta.json"));
            assertEquals(
                    LocalDateTime.of(1980, 1, 1, 0, 0),
                    zip.getEntry("delta.json").getTimeLocal());
            assertTrue(names.contains("manifest.json"));
            assertTrue(names.contains("recipes/example/changed.txt"));
            assertTrue(names.contains("recipes/example/added.txt"));
            assertFalse(names.contains("recipes/example/r0.png"));
            assertFalse(names.contains("recipes/example/deleted.txt"));

            JsonObject document = JsonParser.parseReader(new InputStreamReader(
                    zip.getInputStream(zip.getEntry("delta.json")),
                    StandardCharsets.UTF_8)).getAsJsonObject();
            assertEquals(ExportDeltaArchive.FORMAT, document.get("format").getAsString());
            assertEquals(delta.basePublicationId(), document.get("basePublicationId").getAsString());
            assertEquals(delta.resultPublicationId(), document.get("resultPublicationId").getAsString());
            assertEquals(
                    "recipes/example/deleted.txt",
                    document.getAsJsonArray("deletedPaths").get(0).getAsString());
            assertEquals(delta.changedFiles(), document.getAsJsonArray("files").size());
        }
    }

    @Test
    void skipsAnUnrelatedPackInsteadOfCreatingAnUnsafeDelta() throws Exception {
        Path base = temporaryDirectory.resolve("base-unrelated");
        Path result = temporaryDirectory.resolve("result-unrelated");
        Files.createDirectories(base);
        Files.createDirectories(result);
        writeSnapshotDocuments(base, "1.0.0", "2026-08-01T00:00:00Z");
        writeSnapshotDocuments(result, "1.0.1", "2026-08-02T00:00:00Z");
        String unrelated = Files.readString(result.resolve("manifest.json"))
                .replace("Delta Test Pack", "Different Pack");
        Files.writeString(result.resolve("manifest.json"), unrelated);

        assertNull(ExportDeltaArchive.create(base, result, temporaryDirectory.resolve("unsafe.zip")));
    }

    private static void writeSnapshotDocuments(Path root, String version, String generatedAt)
            throws IOException {
        Files.createDirectories(root);
        Files.writeString(root.resolve("manifest.json"), """
                {
                  "format": 1,
                  "generatedAt": "%s",
                  "durationMs": 1,
                  "aborted": false,
                  "pack": {"name": "Delta Test Pack", "version": "%s"},
                  "minecraft": "1.20.1",
                  "settings": {"iconScale": 4, "recipeScale": 2, "mobCanvas": 256},
                  "counts": {"items": 0, "recipes": 0, "categories": 0, "mobs": 0, "blockDrops": 0, "failures": 0}
                }
                """.formatted(generatedAt, version));
        Files.writeString(root.resolve("items.json"), "{\"items\":[]}");
        Files.writeString(root.resolve("categories.json"), "{\"categories\":[]}");
        Files.writeString(root.resolve("index.json"), "{}");
    }
}
