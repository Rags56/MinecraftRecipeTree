package com.recipetree.jeiexport;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class RecipeTreeTransferTest {
    @TempDir Path directory;
    private static String selection(String path) {
        return "{\"path\":" + path + ",\"itemKey\":\"item|minecraft:stone\",\"source\":{\"kind\":\"recipe\"}}";
    }
    @Test void acceptsPrimaryTreeAndReusableTerminal() throws Exception {
        String json = "{\"selections\":[" + selection("[]") + "],\"reusableInputs\":[{\"path\":[0],\"itemKey\":\"item|minecraft:stone\"}]}";
        assertEquals(1, RecipeTreeTransfer.validate(json).getAsJsonArray("reusableInputs").size());
    }
    @Test void rejectsFractionalNegativeDeepAndDuplicatePaths() {
        for (String path : new String[]{"[0.5]", "[\"0\"]", "[true]", "[-1]", "[32]", "[0,0,0,0,0,0,0,0,0,0,0,0,0]"}) {
            assertThrows(IOException.class, () -> RecipeTreeTransfer.validate("{\"selections\":[" + selection(path) + "]}"));
        }
        assertThrows(IOException.class, () -> RecipeTreeTransfer.validate("{\"selections\":[" + selection("[]") + "," + selection("[]") + "]}"));
    }
    @Test void detectsEquivalentNumericDuplicatePaths() {
        assertThrows(IOException.class, () -> RecipeTreeTransfer.validate("{\"selections\":[" + selection("[0]") + "," + selection("[0.0]") + "]}"));
    }
    @Test void rejectsMalformedAndOversizedDocuments() {
        for (String json : new String[]{"[]", "{", "{}", "x".repeat((int) RecipeTreeTransfer.MAX_TREE_BYTES + 1)}) {
            assertThrows(IOException.class, () -> RecipeTreeTransfer.validate(json));
        }
    }
    @Test void onlyReadsExplicitRegularUtf8FilesWithinLimit() throws Exception {
        Path valid = Files.writeString(directory.resolve("valid.mrtree.json"), "{\"selections\":[]}");
        assertEquals("{\"selections\":[]}", RecipeTreeTransfer.readBoundedUtf8(valid));
        Path link = Files.createSymbolicLink(directory.resolve("link.mrtree.json"), valid);
        assertThrows(IOException.class, () -> RecipeTreeTransfer.readBoundedUtf8(link));
        Path bad = Files.write(directory.resolve("bad.mrtree.json"), new byte[]{(byte) 0xc3, 0x28});
        assertThrows(IOException.class, () -> RecipeTreeTransfer.readBoundedUtf8(bad));
        Path huge = Files.writeString(directory.resolve("huge.mrtree.json"), "x".repeat((int) RecipeTreeTransfer.MAX_TREE_BYTES + 1));
        assertThrows(IOException.class, () -> RecipeTreeTransfer.readBoundedUtf8(huge));
        assertFalse(RecipeTreeTransfer.listShareFiles(directory).contains(link));
    }
}
