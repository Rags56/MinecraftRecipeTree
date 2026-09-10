package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.stream.JsonWriter;
import com.mojang.blaze3d.platform.NativeImage;
import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRenderer;
import mezz.jei.api.ingredients.IIngredientType;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.ingredients.subtypes.UidContext;
import mezz.jei.api.neoforge.NeoForgeTypes;
import mezz.jei.api.runtime.IIngredientManager;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.fluids.FluidStack;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;

/**
 * The ingredient catalog: every unique ingredient (items, fluids, and any custom JEI
 * ingredient type like Mekanism gases) gets one entry in items.json plus a rendered icon.
 * Both the items phase and the recipe phase feed it, so every key referenced by a recipe
 * is guaranteed to exist in the catalog.
 */
final class ItemCatalog {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private final ExportContext ctx;
    final IIngredientManager manager;
    private final JsonWriter writer;
    private final Set<String> known = new HashSet<>();
    private final Set<ResourceLocation> warnedFallbackItemIds = new HashSet<>();
    private int count;

    ItemCatalog(ExportContext ctx, IIngredientManager manager) throws IOException {
        this.ctx = ctx;
        this.manager = manager;
        this.writer = new JsonWriter(Files.newBufferedWriter(ctx.root.resolve("items.json")));
        writer.beginObject();
        writer.name("items");
        writer.beginArray();
    }

    int count() {
        return count;
    }

    /** Returns the stable key for this ingredient, writing catalog entry + icon on first sight. */
    String ensure(ITypedIngredient<?> typed) {
        if (isEmptyIngredient(typed)) {
            throw new IllegalArgumentException("Empty item/fluid placeholders are not catalog ingredients");
        }
        return ensureTyped(typed);
    }

    String ensureSynthetic(String key, String resourceId, String name, String modId, String type) {
        if (!known.add(key)) {
            return key;
        }
        try {
            writer.beginObject();
            writer.name("k").value(key);
            writer.name("id").value(resourceId);
            writer.name("n").value(name);
            writer.name("m").value(modId);
            if (type != null && !type.isBlank() && !"item".equals(type)) {
                writer.name("t").value(type);
            }
            writer.endObject();
        } catch (IOException exception) {
            throw new UncheckedIOException("Failed writing synthetic ingredient to items.json", exception);
        }
        count++;
        return key;
    }

    /**
     * Restores an ingredient referenced by a reused synthetic recipe. Synthetic trade outputs are
     * not guaranteed to occur in JEI's ordinary ingredient list, so copying the recipe alone can
     * otherwise leave its keys absent from items.json.
     */
    boolean restorePrevious(String key) throws IOException {
        if (known.contains(key)) {
            return true;
        }
        if (ctx.previous == null) {
            return false;
        }
        JsonObject previousEntry = ctx.previous.item(key);
        if (previousEntry == null) {
            return false;
        }
        if (previousEntry.has("icon")) {
            String previousIcon = previousEntry.get("icon").getAsString();
            if (!ctx.reserveAndReusePreviousFile(previousIcon, previousIcon)) {
                return false;
            }
        }
        known.add(key);
        GSON.toJson(previousEntry, writer);
        count++;
        ctx.reusedItems++;
        return true;
    }

    static boolean isEmptyIngredient(ITypedIngredient<?> typed) {
        Object ingredient = typed.getIngredient();
        return (typed.getType() == VanillaTypes.ITEM_STACK
                && ingredient instanceof ItemStack stack
                && stack.isEmpty())
                || (typed.getType() == NeoForgeTypes.FLUID_STACK
                && ingredient instanceof FluidStack fluidStack
                && fluidStack.isEmpty());
    }

    private <V> String ensureTyped(ITypedIngredient<V> typed) {
        IIngredientType<V> type = typed.getType();
        V ingredient = typed.getIngredient();
        IIngredientHelper<V> helper = manager.getIngredientHelper(type);
        String prefix = IngredientKeys.typePrefix(type);

        String uid;
        try {
            uid = helper.getUniqueId(ingredient, UidContext.Ingredient);
        } catch (Throwable t) {
            uid = fallbackItemStackUid(type, ingredient, t);
        }
        if (uid == null || uid.isBlank()) {
            throw new IllegalStateException("ITEM_IDENTITY: JEI helper returned a null/blank id for "
                    + ingredient.getClass().getName());
        }
        String key = prefix + "|" + uid;
        if (!known.add(key)) {
            return key;
        }

        String name;
        try {
            name = helper.getDisplayName(ingredient);
        } catch (Throwable t) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] ingredient display name {} failed; using unique id", key, t);
            name = uid;
        }
        if (name == null || name.isBlank()) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] ingredient display name {} was null/blank; using unique id", key);
            name = uid;
        }
        ResourceLocation rl = null;
        try {
            rl = helper.getResourceLocation(ingredient);
        } catch (Throwable t) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] ingredient resource id {} failed; using unique id", key, t);
        }
        String mod;
        try {
            mod = helper.getDisplayModId(ingredient);
        } catch (Throwable t) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] ingredient mod id {} failed; deriving namespace", key, t);
            mod = rl != null ? rl.getNamespace() : "unknown";
        }
        if (mod == null || mod.isBlank()) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] ingredient mod id {} was null/blank; deriving namespace", key);
            mod = rl != null ? rl.getNamespace() : "unknown";
        }

        JsonObject entry = new JsonObject();
        entry.addProperty("k", key);
        entry.addProperty("id", rl != null ? rl.toString() : uid);
        entry.addProperty("n", name);
        entry.addProperty("m", mod);
        if (!"item".equals(prefix)) {
            entry.addProperty("t", prefix);
        }

        String icon = reuseIcon(key, entry);
        if (icon == null) {
            try {
                icon = renderIcon(type, ingredient, prefix, rl, uid, key);
            } catch (Throwable t) {
                ctx.failure("icon " + key, t);
            }
        }
        if (icon != null) {
            entry.addProperty("icon", icon);
        }

        GSON.toJson(entry, writer);
        count++;
        return key;
    }

    @Nullable
    private String reuseIcon(String key, JsonObject currentEntry) {
        if (ctx.previous == null) {
            return null;
        }
        try {
            JsonObject previousEntry = ctx.previous.matchingItem(key, currentEntry);
            if (previousEntry == null || !previousEntry.has("icon")) {
                return null;
            }
            String previousIcon = previousEntry.get("icon").getAsString();
            if (!ctx.reserveAndReusePreviousFile(previousIcon, previousIcon)) {
                return null;
            }
            ctx.reusedItems++;
            return previousIcon;
        } catch (IOException cacheFailure) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Ingredient cache lookup failed for {}; rendering it again",
                    key,
                    cacheFailure);
            return null;
        }
    }

    private <V> String fallbackItemStackUid(IIngredientType<V> type, V ingredient, Throwable helperFailure) {
        if (type != VanillaTypes.ITEM_STACK
                || !(ingredient instanceof ItemStack stack)
                || stack.isEmpty()) {
            throw new IllegalStateException("ITEM_IDENTITY: JEI helper failed to identify "
                    + ingredient.getClass().getName(), helperFailure);
        }
        ResourceLocation itemId = BuiltInRegistries.ITEM.getKey(stack.getItem());
        if (itemId == null) {
            throw new IllegalStateException(
                    "ITEM_IDENTITY: fallback could not resolve the ItemStack registry id", helperFailure);
        }
        String uid = itemId.toString();
        if (!stack.isComponentsPatchEmpty()) {
            var level = Minecraft.getInstance().level;
            if (level == null) {
                throw new IllegalStateException(
                        "ITEM_IDENTITY: fallback needs a loaded level to encode ItemStack components",
                        helperFailure);
            }
            try {
                Tag encoded = stack.copyWithCount(1).save(level.registryAccess());
                uid += "#mrt-components-" + Naming.sha256(encoded.getAsString());
            } catch (Throwable fallbackFailure) {
                fallbackFailure.addSuppressed(helperFailure);
                throw new IllegalStateException(
                        "ITEM_IDENTITY: fallback could not canonically encode ItemStack components",
                        fallbackFailure);
            }
        }
        if (warnedFallbackItemIds.add(itemId)) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] JEI helper could not identify an ItemStack for {}; using the "
                            + "registry id plus a canonical component digest",
                    itemId,
                    helperFailure);
        }
        return uid;
    }

    @Nullable
    private <V> String renderIcon(IIngredientType<V> type, V ingredient, String prefix,
                                  @Nullable ResourceLocation rl, String uid, String key) {
        IIngredientRenderer<V> renderer = manager.getIngredientRenderer(type);
        int w = Math.max(16, renderer.getWidth());
        int h = Math.max(16, renderer.getHeight());
        int scale = ctx.iconScale;

        String dir = "icons/" + prefix + "/" + (rl != null ? Naming.sanitize(rl.getNamespace()) : "unknown");
        String base = rl != null ? rl.getPath() : Naming.hash8(uid);
        if (rl == null || !uid.equals(rl.toString())) {
            // Subtyped ingredient (potion, enchanted book, NBT variants...): disambiguate.
            base = base + "__" + Naming.hash8(uid);
        }
        String rel = ctx.uniquePath(dir, base, ".png");

        NativeImage image = ctx.renderer.capture(w * scale, h * scale, g -> {
            g.pose().pushPose();
            try {
                g.pose().scale(scale, scale, 1f);
                renderer.render(g, ingredient);
            } finally {
                g.pose().popPose();
            }
        });
        ImageVisibility.Result visibility = ImageVisibility.repairHiddenRgbAlpha(image);
        if (visibility == ImageVisibility.Result.EMPTY) {
            image.close();
            ctx.warning("ingredient icon " + key
                    + ": rendered image is fully transparent; omitting the PNG and JSON icon "
                    + "reference so the viewer uses its named fallback (this is expected for "
                    + "invisible, technical, and unconfigured painted ingredients)");
            return null;
        }
        if (visibility == ImageVisibility.Result.REPAIRED_HIDDEN_RGB) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] ingredient icon {} rendered RGB with a zero alpha channel; "
                            + "recovered alpha from the native RGB coverage",
                    key);
        }
        ctx.saveImage(image, ctx.root.resolve(rel));
        return rel;
    }

    void close() throws IOException {
        writer.endArray();
        writer.endObject();
        writer.close();
    }
}
