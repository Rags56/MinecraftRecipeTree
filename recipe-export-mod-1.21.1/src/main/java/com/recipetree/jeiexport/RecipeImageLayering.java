package com.recipetree.jeiexport;

import com.mojang.blaze3d.platform.NativeImage;

/** Exact pixel-difference layers for JEI recipe screenshots. */
final class RecipeImageLayering {
    /** Avoid a second image request unless at least this fraction of the pixels is shared. */
    static final double MINIMUM_SHARED_PIXEL_RATIO = 0.20;
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    record Result(NativeImage overlay, int sharedPixels, int totalPixels, String contentFingerprint) {
        double sharedPixelRatio() {
            return totalPixels == 0 ? 0.0 : (double) sharedPixels / totalPixels;
        }
    }

    private RecipeImageLayering() {
    }

    private static final class PixelFingerprint {
        private long first = 0x243F6A8885A308D3L;
        private long second = 0x13198A2E03707344L;
        private long count;

        void add(int x, int y, int pixel) {
            long position = ((long) x << 32) ^ (y & 0xFFFFFFFFL);
            long token = mix64(position ^ Integer.toUnsignedLong(pixel) ^ count++ * 0x9E3779B97F4A7C15L);
            first = Long.rotateLeft(first ^ token, 27) * 0x3C79AC492BA7B653L + 0x1C69B3F74AC4AE35L;
            second = Long.rotateLeft(second + token + Long.rotateLeft(position, 19), 31)
                    * 0xD6E8FEB86659FD93L + 0xA5A3564E27F8862DL;
        }

        String finish() {
            long finalizedFirst = mix64(first ^ count);
            long finalizedSecond = mix64(second ^ Long.rotateLeft(count, 29) ^ finalizedFirst);
            char[] output = new char[32];
            writeHex(finalizedFirst, output, 0);
            writeHex(finalizedSecond, output, 16);
            return new String(output);
        }

        private static long mix64(long value) {
            value ^= value >>> 30;
            value *= 0xBF58476D1CE4E5B9L;
            value ^= value >>> 27;
            value *= 0x94D049BB133111EBL;
            return value ^ (value >>> 31);
        }

        private static void writeHex(long value, char[] output, int offset) {
            for (int index = 15; index >= 0; index--) {
                output[offset + index] = HEX[(int) (value & 0xF)];
                value >>>= 4;
            }
        }
    }

    static Result difference(NativeImage base, NativeImage complete) {
        if (base.getWidth() != complete.getWidth() || base.getHeight() != complete.getHeight()) {
            throw new IllegalArgumentException("Recipe base and complete image dimensions must match");
        }
        NativeImage overlay = new NativeImage(complete.getWidth(), complete.getHeight(), true);
        PixelFingerprint fingerprint = new PixelFingerprint();
        int shared = 0;
        for (int y = 0; y < complete.getHeight(); y++) {
            for (int x = 0; x < complete.getWidth(); x++) {
                int pixel = complete.getPixelRGBA(x, y);
                int overlayPixel;
                if (pixel == base.getPixelRGBA(x, y)) {
                    overlayPixel = 0;
                    shared++;
                } else {
                    overlayPixel = pixel;
                }
                overlay.setPixelRGBA(x, y, overlayPixel);
                if (overlayPixel != 0) {
                    fingerprint.add(x, y, overlayPixel);
                }
            }
        }
        // The raw-export validator intentionally rejects fully transparent images. Preserve one
        // identical base pixel in the overlay when the first recipe establishes a new base.
        if (shared == complete.getWidth() * complete.getHeight() && shared > 0) {
            int validationPixel = complete.getPixelRGBA(0, 0);
            overlay.setPixelRGBA(0, 0, validationPixel);
            if (validationPixel != 0) fingerprint.add(0, 0, validationPixel);
            shared--;
        }
        return new Result(
                overlay,
                shared,
                complete.getWidth() * complete.getHeight(),
                fingerprint.finish());
    }

    static NativeImage copy(NativeImage source) {
        NativeImage copy = new NativeImage(source.getWidth(), source.getHeight(), true);
        copy.copyFrom(source);
        return copy;
    }
}
