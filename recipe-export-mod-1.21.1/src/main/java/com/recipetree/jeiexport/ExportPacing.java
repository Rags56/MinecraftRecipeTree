package com.recipetree.jeiexport;

import java.util.concurrent.TimeUnit;

/**
 * Defines the three user-facing export speed presets used by {@link ExportJob}.
 *
 * <p>The exporter cannot move JEI layout rendering off the render thread, so this
 * preset controls how long each cooperative render-thread slice may run. Turbo
 * remains bounded so Minecraft can redraw the progress overlay between slices.</p>
 */
final class ExportPacing {
    static final String SPEED_PROPERTY = "jeiexport.speed";
    static final int SLOW = 1;
    static final int LEGACY = 2;
    static final int TURBO = 3;
    static final int DEFAULT_SPEED = LEGACY;

    private static final int SLOW_SLICE_MS = 2;
    private static final int LEGACY_SLICE_MS = 45;
    private static final int TURBO_SLICE_MS = 250;

    private ExportPacing() {
    }

    static int parseSpeed(String configured) {
        if (configured == null || configured.isBlank()) {
            return DEFAULT_SPEED;
        }
        final int value;
        try {
            value = Integer.parseInt(configured.trim());
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(
                    SPEED_PROPERTY + " must be an integer between " + SLOW + " and " + TURBO,
                    error);
        }
        requireValidSpeed(value);
        return value;
    }

    static void requireValidSpeed(int value) {
        if (value < SLOW || value > TURBO) {
            throw new IllegalArgumentException(
                    SPEED_PROPERTY + " must be between " + SLOW + " and " + TURBO
                            + " (received " + value + ")");
        }
    }

    static int sliceBudgetMillis(int speed) {
        requireValidSpeed(speed);
        return switch (speed) {
            case SLOW -> SLOW_SLICE_MS;
            case LEGACY -> LEGACY_SLICE_MS;
            case TURBO -> TURBO_SLICE_MS;
            default -> throw new IllegalStateException("Validated export speed was not mapped: " + speed);
        };
    }

    static long sliceBudgetNanos(int speed) {
        return TimeUnit.MILLISECONDS.toNanos(sliceBudgetMillis(speed));
    }

    static String label(int speed) {
        requireValidSpeed(speed);
        return switch (speed) {
            case SLOW -> "smooth";
            case LEGACY -> "normal";
            case TURBO -> "fast";
            default -> throw new IllegalStateException("Validated export speed was not labeled: " + speed);
        };
    }
}
