package com.recipetree.jeiexport;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RecipeTreeShareFilesTest {
    @TempDir
    Path temporaryDirectory;

    @Test
    void findsNewestPortableTreeAndIgnoresOtherFiles() throws Exception {
        Path shares = RecipeTreeShareFiles.directory(temporaryDirectory);
        Files.createDirectories(shares);
        Path older = Files.writeString(shares.resolve("older.mrtree.json"), "{}");
        Path newer = Files.writeString(shares.resolve("newer.mrtree.json"), "{}");
        Files.writeString(shares.resolve("notes.txt"), "ignore");
        Files.setLastModifiedTime(older, FileTime.fromMillis(1_000));
        Files.setLastModifiedTime(newer, FileTime.fromMillis(2_000));

        assertEquals(newer, RecipeTreeShareFiles.newest(temporaryDirectory).orElseThrow());
    }

    @Test
    void returnsEmptyWhenTheHandoffFolderDoesNotExist() throws Exception {
        assertTrue(RecipeTreeShareFiles.newest(temporaryDirectory).isEmpty());
    }
}
