package com.recipetree.jeiexport112;

import java.lang.reflect.Field;
import java.nio.IntBuffer;
import java.util.function.Consumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.renderer.GlStateManager;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;

/** Aligns MMCE's screen-space scene viewport with its transformed JEI recipe card. */
final class ModularMachineryPreviewScope implements AutoCloseable {
    private final Object renderer;
    private final Field beforeField;
    private final Field afterField;
    private final Consumer<Object> previousBefore;
    private Consumer<Object> previousAfter;
    private final ThreadLocal<Object> translation;
    private final Object previousTranslation;
    private final IntBuffer viewport = BufferUtils.createIntBuffer(16);
    private final IntBuffer previousViewport = BufferUtils.createIntBuffer(16);
    private final IntBuffer scissor = BufferUtils.createIntBuffer(16);
    private final boolean clipped;
    private final int leftPixels;
    private final int topPixels;
    private final int displayHeight;
    private final float scale;

    @SuppressWarnings("unchecked")
    ModularMachineryPreviewScope(Object wrapper, Minecraft client,
                                  int width, int height, int left, int top, float scale)
            throws ReflectiveOperationException {
        ClassLoader loader = wrapper.getClass().getClassLoader();
        Class<?> widgetGui = Class.forName(
                "github.kasuminova.mmce.client.gui.widget.base.WidgetGui", true, loader);
        Class<?> panels = Class.forName(
                "github.kasuminova.mmce.client.preivew.PreviewPanels", true, loader);
        Class<?> controller = Class.forName(
                "github.kasuminova.mmce.client.gui.widget.base.WidgetController", true, loader);
        Class<?> renderPos = Class.forName(
                "github.kasuminova.mmce.client.gui.util.RenderPos", true, loader);
        Field machineField = wrapper.getClass().getDeclaredField("machine");
        machineField.setAccessible(true);
        Object machine = machineField.get(wrapper);
        Object gui = widgetGui.getMethod("of", GuiScreen.class,
                int.class, int.class, int.class, int.class).invoke(
                        null, client.currentScreen, width, height, 0, 0);
        // Use MMCE's own per-machine cache, including on the very first frame.
        Object panel = panels.getMethod("getPanel", machineField.getType(), widgetGui)
                .invoke(null, machine, gui);
        Object widget = panel.getClass().getMethod("getRenderer").invoke(panel);
        renderer = widget.getClass().getMethod("getWorldRenderer").invoke(widget);
        Class<?> scene = Class.forName(
                "com.cleanroommc.client.preview.renderer.scene.WorldSceneRenderer", true, loader);
        beforeField = scene.getDeclaredField("beforeRender");
        afterField = scene.getDeclaredField("afterRender");
        beforeField.setAccessible(true);
        afterField.setAccessible(true);
        previousBefore = (Consumer<Object>) beforeField.get(renderer);
        previousAfter = (Consumer<Object>) afterField.get(renderer);
        translation = (ThreadLocal<Object>) controller.getField("TRANSLATE_STATE").get(null);
        previousTranslation = translation.get();
        Object origin = renderPos.getConstructor(int.class, int.class).newInstance(0, 0);
        int guiScale = new ScaledResolution(client).getScaleFactor();
        leftPixels = left * guiScale;
        topPixels = top * guiScale;
        displayHeight = client.displayHeight;
        this.scale = scale;
        clipped = GL11.glIsEnabled(GL11.GL_SCISSOR_TEST);
        GL11.glGetInteger(GL11.GL_SCISSOR_BOX, scissor);
        GL11.glGetInteger(GL11.GL_VIEWPORT, previousViewport);
        try {
            beforeField.set(renderer, (Consumer<Object>) value -> {
                installAfterCallback();
                alignViewport();
                if (previousBefore != null) previousBefore.accept(value);
            });
            translation.set(origin);
        } catch (ReflectiveOperationException | RuntimeException error) {
            close();
            throw error;
        }
    }

    @SuppressWarnings("unchecked")
    private void installAfterCallback() {
        try {
            // The wrapper may initialize its widget controller after this scope is entered,
            // replacing the native after-render callback on the first frame.
            previousAfter = (Consumer<Object>) afterField.get(renderer);
            final Consumer<Object> delegate = previousAfter;
            afterField.set(renderer, (Consumer<Object>) value -> {
                try {
                    if (delegate != null) delegate.accept(value);
                } finally {
                    restoreScissor();
                }
            });
        } catch (IllegalAccessException error) {
            throw new IllegalStateException("Could not scope MMCE scene clipping", error);
        }
    }

    private void alignViewport() {
        viewport.clear();
        GL11.glGetInteger(GL11.GL_VIEWPORT, viewport);
        int[] corrected = mapViewport(viewport.get(0), viewport.get(1),
                viewport.get(2), viewport.get(3), leftPixels, topPixels, scale, displayHeight);
        GlStateManager.viewport(corrected[0], corrected[1], corrected[2], corrected[3]);
        int x = corrected[0];
        int y = corrected[1];
        int right = x + corrected[2];
        int top = y + corrected[3];
        if (clipped) {
            x = Math.max(x, scissor.get(0));
            y = Math.max(y, scissor.get(1));
            right = Math.min(right, scissor.get(0) + scissor.get(2));
            top = Math.min(top, scissor.get(1) + scissor.get(3));
        }
        GL11.glEnable(GL11.GL_SCISSOR_TEST);
        GL11.glScissor(x, y, Math.max(0, right - x), Math.max(0, top - y));
        clearPreviewDepth();
    }

    private static void clearPreviewDepth() {
        // MMCE setupCamera clears its untransformed viewport before beforeRender runs.
        // Clear again at the mapped scissor so the recipe background cannot occlude the
        // relocated 3D scene. Preserve color and depth outside this visible preview.
        boolean depthWritable = GL11.glGetBoolean(GL11.GL_DEPTH_WRITEMASK);
        double clearDepth = GL11.glGetDouble(GL11.GL_DEPTH_CLEAR_VALUE);
        try {
            GlStateManager.depthMask(true);
            GL11.glClearDepth(1D);
            GL11.glClear(GL11.GL_DEPTH_BUFFER_BIT);
        } finally {
            GL11.glClearDepth(clearDepth);
            GlStateManager.depthMask(depthWritable);
        }
    }

    static int[] mapViewport(int x, int y, int width, int height,
                             int left, int top, float scale, int displayHeight) {
        int localTop = displayHeight - y - height;
        int mappedLeft = left + Math.round(x * scale);
        int mappedTop = top + Math.round(localTop * scale);
        int mappedRight = left + Math.round((x + width) * scale);
        int mappedBottom = top + Math.round((localTop + height) * scale);
        return new int[]{mappedLeft, displayHeight - mappedBottom,
                Math.max(1, mappedRight - mappedLeft), Math.max(1, mappedBottom - mappedTop)};
    }

    private void restoreScissor() {
        GL11.glScissor(scissor.get(0), scissor.get(1), scissor.get(2), scissor.get(3));
        if (clipped) GL11.glEnable(GL11.GL_SCISSOR_TEST);
        else GL11.glDisable(GL11.GL_SCISSOR_TEST);
    }

    @Override
    public void close() {
        try {
            beforeField.set(renderer, previousBefore);
            afterField.set(renderer, previousAfter);
        } catch (IllegalAccessException error) {
            JeiExportMod.LOGGER.error("[jeiexport] Could not restore MMCE preview callbacks", error);
        } finally {
            translation.set(previousTranslation);
            restoreScissor();
            GlStateManager.viewport(previousViewport.get(0), previousViewport.get(1),
                    previousViewport.get(2), previousViewport.get(3));
        }
    }
}
