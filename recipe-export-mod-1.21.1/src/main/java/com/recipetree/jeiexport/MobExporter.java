package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.Lighting;
import com.mojang.blaze3d.platform.NativeImage;
import com.mojang.blaze3d.systems.RenderSystem;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.entity.EntityRenderDispatcher;
import net.minecraft.client.renderer.entity.NoopRenderer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import org.jetbrains.annotations.Nullable;
import org.joml.Matrix4f;
import org.joml.Quaternionf;

import java.io.IOException;
import java.io.Writer;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Mob phase: instantiates every living entity type (from every mod) in the client level and
 * renders visible mobs with the real entity renderer into a fixed-size transparent canvas,
 * scaled to fit its bounding box — same technique as the inventory player preview. Internal
 * helper entities explicitly registered with Minecraft's NoopRenderer are not mob catalog rows.
 */
final class MobExporter implements ExportJob.PhaseRunner {
    private static final float YAW_DEGREES = 35f;
    private static final float PITCH_DEGREES = 10f;
    /** Animation sprite sheet: FRAMES square frames side by side, played at FPS. */
    private static final int FRAMES = 16;
    private static final int FPS = 10;
    /** Ticks of game time advanced between frames (20tps / 10fps). */
    private static final int TICKS_PER_FRAME = 2;
    /** Increment when cached mob artwork must be rendered again. */
    private static final int RENDER_REVISION = 2;
    private static final int DROP_ROLLS = 600;
    /** Custom hooks are typically deterministic; enough rolls to catch uncommon modded rewards. */
    private static final int CUSTOM_DROP_ROLLS = 64;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private final ExportContext ctx;
    private final Iterator<EntityType<?>> iterator;
    private final int total;
    private final JsonArray mobsJson = new JsonArray();
    private int done;
    private boolean written;
    private boolean mobCacheAvailable = true;

    MobExporter(ExportContext ctx) {
        this.ctx = ctx;
        List<EntityType<?>> types = new ArrayList<>(BuiltInRegistries.ENTITY_TYPE.stream().toList());
        this.iterator = types.iterator();
        this.total = types.size();
    }

    @Override
    public boolean step() {
        if (!iterator.hasNext()) {
            return true;
        }
        EntityType<?> type = iterator.next();
        done++;
        ResourceLocation id = BuiltInRegistries.ENTITY_TYPE.getKey(type);
        if (id == null) {
            ctx.failure("mob registry entry has no resource id: " + type);
            return !iterator.hasNext();
        }
        if (reuseMob(id)) {
            return !iterator.hasNext();
        }
        Entity entity = null;
        try {
            entity = type.create(Minecraft.getInstance().level);
            if (entity instanceof LivingEntity living) {
                if (exportMob(type, id, living)) {
                    ctx.mobCount++;
                }
            }
        } catch (Throwable t) {
            ctx.failure("mob " + id, t);
        } finally {
            if (entity != null) {
                try {
                    entity.discard();
                } catch (Throwable t) {
                    ctx.failure("mob cleanup " + id, t);
                }
            }
        }
        return !iterator.hasNext();
    }

    private boolean reuseMob(ResourceLocation id) {
        if (ctx.previous == null || !mobCacheAvailable) {
            return false;
        }
        try {
            JsonObject previousMob = ctx.previous.mob(id);
            if (previousMob == null
                    || !previousMob.has("icon")
                    || !previousMob.has("renderRevision")
                    || previousMob.get("renderRevision").getAsInt() != RENDER_REVISION) {
                return false;
            }
            String icon = previousMob.get("icon").getAsString();
            if (!ctx.reserveAndReusePreviousFile(icon, icon)) {
                return false;
            }
            mobsJson.add(previousMob.deepCopy());
            ctx.mobCount++;
            ctx.reusedMobs++;
            return true;
        } catch (IOException cacheFailure) {
            mobCacheAvailable = false;
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Mob cache lookup failed; rendering remaining mobs again",
                    cacheFailure);
            return false;
        }
    }

    private boolean exportMob(EntityType<?> type, ResourceLocation id, LivingEntity entity) {
        EntityRenderDispatcher dispatcher = Minecraft.getInstance().getEntityRenderDispatcher();
        if (isNoopRendererType(dispatcher.getRenderer(entity).getClass())) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Skipping internal entity {} because it is registered with NoopRenderer",
                    id);
            return false;
        }
        int canvas = ctx.mobCanvas;
        float bbWidth = Math.max(entity.getBbWidth(), 0.05f);
        float bbHeight = Math.max(entity.getBbHeight(), 0.05f);
        // The 3/4 view widens the footprint; pad a little for limbs/heads outside the AABB.
        float effectiveW = bbWidth * 1.5f + 0.2f;
        float effectiveH = bbHeight + 0.3f;
        float scale = Math.min(canvas * 0.85f / effectiveW, canvas * 0.85f / effectiveH);
        float feetY = canvas / 2f + (bbHeight * scale) / 2f;

        // Keep every pose inside its square. Long modded tails can extend beyond the
        // entity AABB and would otherwise be written into a neighboring frame.
        NativeImage sheet = ctx.renderer.capture(canvas * FRAMES, canvas, g -> {
            try {
                for (int frame = 0; frame < FRAMES; frame++) {
                    entity.tickCount += TICKS_PER_FRAME;
                    entity.walkAnimation.update(0.6f, 1.0f);
                    RenderSystem.enableScissor(frame * canvas, 0, canvas, canvas);
                    renderEntity(g, frame * canvas + canvas / 2f, feetY, scale, entity);
                }
            } finally {
                RenderSystem.disableScissor();
            }
        });
        if (!hasVisiblePixel(sheet)) {
            sheet.close();
            ctx.warning("mob " + id + " rendered fully transparent and was omitted");
            return false;
        }
        String rel = ctx.uniquePath("mobs/" + Naming.sanitize(id.getNamespace()), id.getPath(), ".png");
        ctx.saveImage(sheet, ctx.root.resolve(rel));

        JsonObject mj = new JsonObject();
        mj.addProperty("id", id.toString());
        mj.addProperty("n", type.getDescription().getString());
        mj.addProperty("m", id.getNamespace());
        mj.addProperty("icon", rel);
        mj.addProperty("frames", FRAMES);
        mj.addProperty("fps", FPS);
        mj.addProperty("renderRevision", RENDER_REVISION);
        mj.addProperty("w", bbWidth);
        mj.addProperty("h", bbHeight);
        try {
            mj.addProperty("hp", entity.getMaxHealth());
        } catch (Throwable t) {
            ctx.failure("mob max health " + id, t);
        }
        mj.addProperty("cat", type.getCategory().getName());

        // Loot-table sampling needs the integrated server (singleplayer only).
        MinecraftServer server = Minecraft.getInstance().getSingleplayerServer();
        JsonArray drops = null;
        if (server != null) {
            try {
                drops = LootSampler.sampleEntityDrops(server, type, DROP_ROLLS);
            } catch (Throwable t) {
                ctx.failure("mob drops " + id, t);
            }
            try {
                JsonArray customDrops = LootSampler.sampleCustomDeathDrops(server, type, CUSTOM_DROP_ROLLS);
                drops = mergeMissingCustomDrops(id, drops, customDrops);
            } catch (Throwable t) {
                ctx.failure("mob custom death drops " + id, t);
            }
        }
        drops = addKnownCustomDeathDrops(id, drops);
        if (drops != null && !drops.isEmpty()) {
            mj.add("drops", drops);
        }
        mobsJson.add(mj);
        return true;
    }

    static boolean isNoopRendererType(Class<?> rendererType) {
        return NoopRenderer.class.isAssignableFrom(rendererType);
    }

    private static boolean hasVisiblePixel(NativeImage image) {
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                if ((image.getPixelRGBA(x, y) >>> 24) != 0) {
                    return true;
                }
            }
        }
        return false;
    }

    @Nullable
    private static JsonArray mergeMissingCustomDrops(
            ResourceLocation mobId, @Nullable JsonArray drops, @Nullable JsonArray customDrops) {
        if (customDrops == null || customDrops.isEmpty()) {
            return drops;
        }
        JsonArray result = drops == null ? new JsonArray() : drops;
        for (var custom : customDrops) {
            String itemKey = custom.getAsJsonObject().get("k").getAsString();
            boolean alreadyPresent = false;
            for (var existing : result) {
                if (itemKey.equals(existing.getAsJsonObject().get("k").getAsString())) {
                    alreadyPresent = true;
                    break;
                }
            }
            if (!alreadyPresent) {
                result.add(custom.deepCopy());
                JeiExportMod.LOGGER.info(
                        "[jeiexport] Captured custom death drop {} -> {}", mobId, itemKey);
            }
        }
        return result;
    }

    /**
     * Some vanilla bosses award items from death hooks rather than loot tables, so
     * sampling the registered table cannot observe them. Keep these explicit and
     * logged so the export never silently invents acquisition data.
     */
    @Nullable
    private static JsonArray addKnownCustomDeathDrops(ResourceLocation mobId, @Nullable JsonArray drops) {
        if (!"minecraft:wither".equals(mobId.toString())) {
            return drops;
        }
        JsonArray result = drops == null ? new JsonArray() : drops;
        for (var element : result) {
            if (element.isJsonObject()
                    && "item|minecraft:nether_star".equals(element.getAsJsonObject().get("k").getAsString())) {
                return result;
            }
        }
        JsonObject star = new JsonObject();
        star.addProperty("k", "item|minecraft:nether_star");
        star.addProperty("c", 1);
        star.addProperty("min", 1);
        star.addProperty("max", 1);
        star.addProperty("avg", 1);
        result.add(star);
        JeiExportMod.LOGGER.info(
                "[jeiexport] Added known custom death drop minecraft:wither -> minecraft:nether_star");
        return result;
    }

    /** Same approach as InventoryScreen.renderEntityInInventory, with fixed camera angles. */
    private static void renderEntity(GuiGraphics g, float x, float y, float scale, LivingEntity entity) {
        Quaternionf pose = new Quaternionf().rotateZ((float) Math.PI);
        Quaternionf cameraOrientation = new Quaternionf().rotateX(PITCH_DEGREES * Mth.DEG_TO_RAD);
        pose.mul(cameraOrientation);

        entity.yBodyRot = 180.0f + YAW_DEGREES;
        entity.setYRot(180.0f + YAW_DEGREES);
        entity.setXRot(0.0f);
        entity.yHeadRot = entity.getYRot();
        entity.yHeadRotO = entity.getYRot();
        entity.yBodyRotO = entity.yBodyRot;
        entity.yRotO = entity.getYRot();
        entity.xRotO = entity.getXRot();

        g.pose().pushPose();
        g.pose().translate(x, y, 50.0f);
        g.pose().mulPose(new Matrix4f().scaling(scale, scale, -scale));
        g.pose().mulPose(pose);
        Lighting.setupForEntityInInventory();
        EntityRenderDispatcher dispatcher = Minecraft.getInstance().getEntityRenderDispatcher();
        cameraOrientation.conjugate();
        try {
            dispatcher.overrideCameraOrientation(cameraOrientation);
            dispatcher.setRenderShadow(false);
            RenderSystem.runAsFancy(() ->
                    dispatcher.render(entity, 0.0, 0.0, 0.0, 0.0f, 1.0f,
                            g.pose(), g.bufferSource(), 15728880));
            g.flush();
        } finally {
            dispatcher.setRenderShadow(true);
            dispatcher.overrideCameraOrientation(
                    Minecraft.getInstance().gameRenderer.getMainCamera().rotation());
            g.pose().popPose();
            Lighting.setupFor3DItems();
        }
    }

    @Override
    public void close() throws IOException {
        if (written) {
            return;
        }
        JsonObject rootObj = new JsonObject();
        rootObj.add("mobs", mobsJson);
        try (Writer writer = Files.newBufferedWriter(ctx.root.resolve("mobs.json"))) {
            GSON.toJson(rootObj, writer);
        }
        written = true;
    }

    @Override
    public String label() {
        return "mobs";
    }

    @Override
    public int done() {
        return done;
    }

    @Override
    public int total() {
        return total;
    }
}
