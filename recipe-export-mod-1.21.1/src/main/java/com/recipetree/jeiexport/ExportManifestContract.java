package com.recipetree.jeiexport;

import com.google.gson.stream.JsonWriter;

import java.io.IOException;

/**
 * Publication-critical settings and telemetry shared by every 1.21.1 export entry point.
 * Keeping these values in one contract prevents command and automatic exports from silently
 * producing snapshots that require different viewer quality profiles.
 */
final class ExportManifestContract {
    static final int DEFAULT_ICON_SCALE = 4;
    static final int RECIPE_SCALE = 2;
    static final int MOB_CANVAS = 256;

    private ExportManifestContract() {
    }

    static void writeDiagnostics(JsonWriter writer, int failureEvents) throws IOException {
        if (failureEvents < 0) {
            throw new IllegalArgumentException("failureEvents must be non-negative");
        }
        writer.name("diagnostics").beginObject()
                .name("failureEvents").value(failureEvents)
                .name("failureEventsOmitted").value(0)
                .endObject();
    }
}
