package com.recipetree.jeiexport;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class ExportPacingTest {
    @Test
    void missingConfigurationUsesLegacyDefault() {
        assertEquals(2, ExportPacing.parseSpeed(null));
        assertEquals(2, ExportPacing.parseSpeed("  "));
    }

    @Test
    void mapsSpeedPresetsToBoundedRenderThreadSlices() {
        assertEquals(1, ExportPacing.parseSpeed("1"));
        assertEquals(2, ExportPacing.parseSpeed(" 2 "));
        assertEquals(3, ExportPacing.parseSpeed("3"));
        assertEquals(2, ExportPacing.sliceBudgetMillis(1));
        assertEquals(45, ExportPacing.sliceBudgetMillis(2));
        assertEquals(250, ExportPacing.sliceBudgetMillis(3));
        assertEquals(250_000_000L, ExportPacing.sliceBudgetNanos(3));
    }

    @Test
    void rejectsInvalidSpeedsInsteadOfSilentlyClamping() {
        assertThrows(IllegalArgumentException.class,
                () -> ExportPacing.parseSpeed("fast"));
        assertThrows(IllegalArgumentException.class,
                () -> ExportPacing.parseSpeed("0"));
        assertThrows(IllegalArgumentException.class,
                () -> ExportPacing.parseSpeed("4"));
    }
}
