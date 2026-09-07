package com.recipetree.jeiexport;

import com.mojang.blaze3d.platform.NativeImage;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

final class RecipeImageLayeringTest {
    @Test
    void differencePreservesChangedPixelsAndClearsSharedPixels() {
        try (NativeImage base = new NativeImage(2, 1, true);
             NativeImage complete = new NativeImage(2, 1, true)) {
            base.setPixelRGBA(0, 0, 0xFF112233);
            base.setPixelRGBA(1, 0, 0xFF445566);
            complete.setPixelRGBA(0, 0, 0xFF112233);
            complete.setPixelRGBA(1, 0, 0xFF778899);

            try (NativeImage overlay = RecipeImageLayering.difference(base, complete).overlay()) {
                assertEquals(0, overlay.getPixelRGBA(0, 0));
                assertEquals(complete.getPixelRGBA(1, 0), overlay.getPixelRGBA(1, 0));
            }
        }
    }

    @Test
    void identicalImagesRetainOneVisibleValidationPixel() {
        try (NativeImage base = new NativeImage(1, 1, true);
             NativeImage complete = new NativeImage(1, 1, true)) {
            base.setPixelRGBA(0, 0, 0xFF112233);
            complete.copyFrom(base);

            try (NativeImage overlay = RecipeImageLayering.difference(base, complete).overlay()) {
                assertEquals(complete.getPixelRGBA(0, 0), overlay.getPixelRGBA(0, 0));
            }
        }
    }

    @Test
    void fingerprintsIdentifyOnlyPixelIdenticalOverlays() {
        try (NativeImage base = new NativeImage(2, 1, true);
             NativeImage first = new NativeImage(2, 1, true);
             NativeImage second = new NativeImage(2, 1, true);
             NativeImage changed = new NativeImage(2, 1, true);
             NativeImage repositioned = new NativeImage(2, 1, true)) {
            base.setPixelRGBA(0, 0, 0xFF112233);
            base.setPixelRGBA(1, 0, 0xFF445566);
            first.copyFrom(base);
            second.copyFrom(base);
            changed.copyFrom(base);
            repositioned.copyFrom(base);
            first.setPixelRGBA(1, 0, 0xFF778899);
            second.setPixelRGBA(1, 0, 0xFF778899);
            changed.setPixelRGBA(1, 0, 0xFF778898);
            repositioned.setPixelRGBA(0, 0, 0xFF778899);

            var firstResult = RecipeImageLayering.difference(base, first);
            var secondResult = RecipeImageLayering.difference(base, second);
            var changedResult = RecipeImageLayering.difference(base, changed);
            var repositionedResult = RecipeImageLayering.difference(base, repositioned);
            try (NativeImage firstOverlay = firstResult.overlay();
                 NativeImage secondOverlay = secondResult.overlay();
                 NativeImage changedOverlay = changedResult.overlay();
                 NativeImage repositionedOverlay = repositionedResult.overlay()) {
                assertEquals(firstResult.contentFingerprint(), secondResult.contentFingerprint());
                assertNotEquals(firstResult.contentFingerprint(), changedResult.contentFingerprint());
                assertNotEquals(firstResult.contentFingerprint(), repositionedResult.contentFingerprint());
            }
        }
    }
}
