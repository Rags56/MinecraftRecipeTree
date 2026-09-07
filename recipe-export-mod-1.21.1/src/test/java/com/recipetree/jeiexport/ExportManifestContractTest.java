package com.recipetree.jeiexport;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.stream.JsonWriter;
import org.junit.jupiter.api.Test;

import java.io.StringWriter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class ExportManifestContractTest {
    @Test
    void defaultsMatchTheGenericJeiPublicationProfile() {
        assertEquals(4, ExportManifestContract.DEFAULT_ICON_SCALE);
        assertEquals(2, ExportManifestContract.RECIPE_SCALE);
        assertEquals(256, ExportManifestContract.MOB_CANVAS);
        assertEquals(1, IncrementalExportCache.CACHE_REVISION);
    }

    @Test
    void diagnosticsSerializeTheExactUnboundedFailureAccountingContract() throws Exception {
        StringWriter output = new StringWriter();
        try (JsonWriter writer = new JsonWriter(output)) {
            writer.beginObject();
            ExportManifestContract.writeDiagnostics(writer, 7);
            writer.endObject();
        }

        JsonObject root = JsonParser.parseString(output.toString()).getAsJsonObject();
        assertEquals(1, root.size());
        JsonObject diagnostics = root.getAsJsonObject("diagnostics");
        assertEquals(2, diagnostics.size());
        assertEquals(7, diagnostics.get("failureEvents").getAsInt());
        assertEquals(0, diagnostics.get("failureEventsOmitted").getAsInt());
    }

    @Test
    void diagnosticsRejectAnImpossibleNegativeFailureCount() {
        assertThrows(IllegalArgumentException.class, () -> {
            try (JsonWriter writer = new JsonWriter(new StringWriter())) {
                writer.beginObject();
                ExportManifestContract.writeDiagnostics(writer, -1);
            }
        });
    }
}
