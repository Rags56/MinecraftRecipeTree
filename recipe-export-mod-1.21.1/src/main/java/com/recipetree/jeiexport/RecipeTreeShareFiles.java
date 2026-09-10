package com.recipetree.jeiexport;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Optional;
import java.util.stream.Stream;

/** Shared on-disk handoff between the desktop viewer and the in-game importer. */
final class RecipeTreeShareFiles {
    static final String DIRECTORY_NAME = "recipe-tree-shares";
    static final String FILE_SUFFIX = ".mrtree.json";

    private RecipeTreeShareFiles() {
    }

    static Path directory(Path configDirectory) {
        return configDirectory.resolve(DIRECTORY_NAME);
    }

    static Optional<Path> newest(Path configDirectory) throws IOException {
        Path directory = directory(configDirectory);
        if (!Files.isDirectory(directory)) return Optional.empty();
        try (Stream<Path> entries = Files.list(directory)) {
            return entries
                    .filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().endsWith(FILE_SUFFIX))
                    .max(Comparator.comparingLong(RecipeTreeShareFiles::modifiedTime));
        }
    }

    private static long modifiedTime(Path path) {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (IOException ignored) {
            return Long.MIN_VALUE;
        }
    }
}
