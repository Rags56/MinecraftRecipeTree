package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.blaze3d.platform.NativeImage;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.npc.Villager;
import net.minecraft.world.entity.npc.VillagerProfession;
import net.minecraft.world.entity.npc.VillagerTrades;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.trading.MerchantOffer;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.Writer;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Synthetic "Villager Trading" category: JEI has no trades, so we sample every
 * profession's trade listings (and the wandering trader) on the server thread,
 * dedupe randomized offers, and render each one as a small trade card.
 * Needs a singleplayer world like the drop sampling.
 */
final class TradeExporter implements ExportJob.PhaseRunner {
    /** Random listings (enchanted books, dyed armor...) get sampled this often per listing. */
    private static final int SAMPLES_PER_LISTING = 6;
    private static final int RECIPE_H = 38;
    private static final int SCALE = 2;
    private static final int TEXT_COLOR = 0xFF3F3F3F;
    private static final int ARROW_COLOR = 0xFF5A5A5A;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private record Unit(String label, String idPrefix, VillagerTrades.ItemListing[] listings) {
    }

    private final ExportContext ctx;
    private final ItemCatalog catalog;
    @Nullable
    private final MinecraftServer server;
    private final ArrayDeque<Unit> queue = new ArrayDeque<>();
    private final int total;
    private int done;
    private final String dirName;
    private final JsonArray recipesJson = new JsonArray();
    private final JsonObject categoryJson = new JsonObject();
    private final int catIndex;
    private final Set<String> seenOffers = new HashSet<>();
    private final Set<Class<?>> skippedTreasureMapListings = new HashSet<>();
    private final Set<Class<?>> failedListingTypes = new HashSet<>();
    private boolean written;

    TradeExporter(ExportContext ctx, IJeiRuntime runtime) throws IOException {
        this.ctx = ctx;
        this.catalog = ctx.catalog(runtime.getIngredientManager());
        this.server = Minecraft.getInstance().getSingleplayerServer();
        this.dirName = "recipes/" + Naming.uniqueRecipeDir(ctx,
                ResourceLocation.fromNamespaceAndPath(JeiExportMod.MOD_ID, "trading"));
        categoryJson.addProperty("id", "jeiexport:trading");
        categoryJson.addProperty("title", "Villager Trading");
        categoryJson.addProperty("dir", dirName);
        categoryJson.add("catalysts", new JsonArray());
        this.catIndex = ctx.registerCategory(categoryJson);

        if (server == null) {
            ExportJob.chat("Villager trades can only be checked in a single-player world, so they were skipped.",
                    ChatFormatting.YELLOW);
        } else {
            for (var professionEntry : VillagerTrades.TRADES.entrySet()) {
                VillagerProfession profession = professionEntry.getKey();
                ResourceLocation profId = BuiltInRegistries.VILLAGER_PROFESSION.getKey(profession);
                String path = profId != null ? profId.getPath() : profession.name();
                String name = professionName(profId, path);
                for (var levelEntry : professionEntry.getValue().int2ObjectEntrySet()) {
                    int level = levelEntry.getIntKey();
                    queue.add(new Unit(name + " · " + levelLabel(level), path + "/" + level,
                            levelEntry.getValue()));
                }
            }
            for (var levelEntry : VillagerTrades.WANDERING_TRADER_TRADES.int2ObjectEntrySet()) {
                queue.add(new Unit("Wandering Trader", "wandering_trader/" + levelEntry.getIntKey(),
                        levelEntry.getValue()));
            }
        }
        if (reusePreviousTrades()) {
            queue.clear();
        }
        this.total = queue.size();
    }

    private boolean reusePreviousTrades() throws IOException {
        if (ctx.previous == null || !ctx.previous.canReuseTrades()) {
            return false;
        }
        ResourceLocation categoryId = ResourceLocation.fromNamespaceAndPath(JeiExportMod.MOD_ID, "trading");
        IncrementalExportCache.RecipeCategoryCache previousCategory = ctx.previous.recipeCategory(categoryId);
        List<IncrementalExportCache.CachedRecipe> cachedRecipes = previousCategory.allRecipes();
        if (ctx.previous.categoryCount(categoryId) != cachedRecipes.size()) {
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Prior trade category is incomplete; resampling all trades");
            return false;
        }

        for (String key : cachedIngredientKeys(cachedRecipes)) {
            if (!catalog.restorePrevious(key)) {
                JeiExportMod.LOGGER.info(
                        "[jeiexport] Prior trade ingredient {} could not be restored; resampling all trades",
                        key);
                return false;
            }
        }

        List<String> linkedImages = new ArrayList<>();
        for (int index = 0; index < cachedRecipes.size(); index++) {
            IncrementalExportCache.CachedRecipe cached = cachedRecipes.get(index);
            String imageName = "r" + index + ".png";
            String destination = dirName + "/" + imageName;
            if (!ctx.reusePreviousFile(cached.imagePath(), destination)) {
                for (String linkedImage : linkedImages) {
                    Files.deleteIfExists(ctx.root.resolve(linkedImage));
                }
                while (!recipesJson.isEmpty()) {
                    recipesJson.remove(recipesJson.size() - 1);
                }
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Prior trade image reuse was incomplete; resampling all trades");
                return false;
            }
            linkedImages.add(destination);
            JsonObject recipe = cached.json().deepCopy();
            recipe.addProperty("img", imageName);
            recipesJson.add(recipe);
            indexCachedRecipe(recipe, index);
        }
        ctx.reusedTrades += cachedRecipes.size();
        JeiExportMod.LOGGER.info(
                "[jeiexport] Reused {} complete trade records; skipped randomized trade sampling",
                cachedRecipes.size());
        return true;
    }

    static Set<String> cachedIngredientKeys(
            List<IncrementalExportCache.CachedRecipe> cachedRecipes) {
        Set<String> keys = new HashSet<>();
        for (IncrementalExportCache.CachedRecipe cached : cachedRecipes) {
            collectCachedSlotKeys(cached.json().getAsJsonArray("in"), keys);
            collectCachedSlotKeys(cached.json().getAsJsonArray("out"), keys);
        }
        return keys;
    }

    private static void collectCachedSlotKeys(@Nullable JsonArray slots, Set<String> keys) {
        if (slots == null) {
            return;
        }
        for (var slotElement : slots) {
            if (!slotElement.isJsonArray()) {
                continue;
            }
            for (var pairElement : slotElement.getAsJsonArray()) {
                if (pairElement.isJsonArray()
                        && !pairElement.getAsJsonArray().isEmpty()
                        && pairElement.getAsJsonArray().get(0).isJsonPrimitive()) {
                    keys.add(pairElement.getAsJsonArray().get(0).getAsString());
                }
            }
        }
    }

    private void indexCachedRecipe(JsonObject recipe, int index) {
        indexCachedSlots(recipe.getAsJsonArray("in"), false, index);
        indexCachedSlots(recipe.getAsJsonArray("out"), true, index);
    }

    private void indexCachedSlots(@Nullable JsonArray slots, boolean output, int index) {
        if (slots == null) {
            return;
        }
        Set<String> keys = new HashSet<>();
        for (var slotElement : slots) {
            if (!slotElement.isJsonArray()) {
                continue;
            }
            for (var pairElement : slotElement.getAsJsonArray()) {
                if (pairElement.isJsonArray() && !pairElement.getAsJsonArray().isEmpty()) {
                    keys.add(pairElement.getAsJsonArray().get(0).getAsString());
                }
            }
        }
        for (String key : keys) {
            ctx.indexRecipe(key, output, catIndex, index);
        }
    }

    private static String professionName(@Nullable ResourceLocation profId, String path) {
        if (profId != null) {
            String key = "entity." + profId.getNamespace() + ".villager." + profId.getPath();
            String translated = Component.translatable(key).getString();
            if (!translated.equals(key)) {
                return translated;
            }
        }
        String pretty = path.replace('_', ' ');
        return pretty.isEmpty() ? "Villager" : Character.toUpperCase(pretty.charAt(0)) + pretty.substring(1);
    }

    private static String levelLabel(int level) {
        String key = "merchant.level." + level;
        String translated = Component.translatable(key).getString();
        return translated.equals(key) ? "lvl " + level : translated;
    }

    @Override
    public boolean step() {
        Unit unit = queue.poll();
        if (unit == null) {
            return true;
        }
        done++;
        List<MerchantOffer> offers = List.of();
        try {
            offers = server.submit(() -> sampleUnit(unit)).join();
        } catch (Throwable t) {
            ctx.failure("trades " + unit.idPrefix(), t);
        }
        for (MerchantOffer offer : offers) {
            try {
                exportOffer(unit, offer);
            } catch (Throwable t) {
                ctx.failure("trade render " + unit.idPrefix(), t);
            }
        }
        return queue.isEmpty();
    }

    /** Runs on the server thread. */
    private List<MerchantOffer> sampleUnit(Unit unit) {
        ServerLevel level = server.overworld();
        Villager villager = EntityType.VILLAGER.create(level);
        List<MerchantOffer> out = new ArrayList<>();
        if (villager == null) {
            return out;
        }
        try {
            for (VillagerTrades.ItemListing listing : unit.listings()) {
                // Treasure-map listings scan 100 chunks for structures — minutes on a flat test world.
                if (listing.getClass().getSimpleName().contains("TreasureMap")) {
                    if (skippedTreasureMapListings.add(listing.getClass())) {
                        JeiExportMod.LOGGER.warn(
                                "[jeiexport] Skipping trade listing type {} because it performs an unbounded structure search",
                                listing.getClass().getName());
                    }
                    continue;
                }
                for (int i = 0; i < SAMPLES_PER_LISTING; i++) {
                    MerchantOffer offer;
                    try {
                        offer = listing.getOffer(villager, level.getRandom());
                    } catch (Throwable t) {
                        if (failedListingTypes.add(listing.getClass())) {
                            ctx.failure("trade listing " + listing.getClass().getName()
                                    + " for " + unit.idPrefix() + ": " + t);
                        }
                        break;
                    }
                    if (offer == null) {
                        continue;
                    }
                    String sig = unit.idPrefix() + "|" + stackSig(offer.getBaseCostA())
                            + "|" + stackSig(offer.getCostB()) + "|" + stackSig(offer.getResult());
                    if (seenOffers.add(sig)) {
                        out.add(offer);
                    }
                }
            }
        } finally {
            villager.discard();
        }
        return out;
    }

    private static String stackSig(ItemStack stack) {
        if (stack.isEmpty()) {
            return "-";
        }
        return BuiltInRegistries.ITEM.getKey(stack.getItem()) + "x" + stack.getCount()
                + stack.getComponentsPatch();
    }

    /** Runs on the render thread: draws the trade card and writes the JSON entry. */
    private void exportOffer(Unit unit, MerchantOffer offer) {
        ItemStack costA = offer.getBaseCostA();
        ItemStack costB = offer.getCostB();
        ItemStack result = offer.getResult();
        Font font = Minecraft.getInstance().font;

        int arrowStart = costB.isEmpty() ? 28 : 54;
        int width = Math.max(Math.max(116, arrowStart + 46), font.width(unit.label()) + 8);
        int idx = recipesJson.size();

        NativeImage image = ctx.renderer.capture(width * SCALE, RECIPE_H * SCALE, g -> {
            g.pose().pushPose();
            try {
                g.pose().scale(SCALE, SCALE, 1f);
                g.fill(0, 0, width, RECIPE_H, 0xFFC6C6C6);
                g.drawString(font, unit.label(), 4, 4, TEXT_COLOR, false);
                int sy = 17;
                g.renderItem(costA, 4, sy);
                g.renderItemDecorations(font, costA, 4, sy);
                if (!costB.isEmpty()) {
                    g.drawString(font, "+", 24, sy + 4, TEXT_COLOR, false);
                    g.renderItem(costB, 32, sy);
                    g.renderItemDecorations(font, costB, 32, sy);
                }
                drawArrow(g, arrowStart, sy + 2);
                g.renderItem(result, width - 22, sy);
                g.renderItemDecorations(font, result, width - 22, sy);
            } finally {
                g.pose().popPose();
            }
        });
        String imageName = "r" + idx + ".png";
        ctx.saveImage(image, ctx.root.resolve(dirName).resolve(imageName));

        JsonObject rj = new JsonObject();
        rj.addProperty("id", String.format(Locale.ROOT, "trade/%s/%d", unit.idPrefix(), idx));
        rj.addProperty("img", imageName);
        rj.addProperty("w", width);
        rj.addProperty("h", RECIPE_H);
        JsonArray in = new JsonArray();
        String keyA = addSlot(in, costA);
        String keyB = addSlot(in, costB);
        JsonArray out = new JsonArray();
        String keyR = addSlot(out, result);
        rj.add("in", in);
        rj.add("out", out);
        recipesJson.add(rj);

        if (keyA != null) {
            ctx.indexRecipe(keyA, false, catIndex, idx);
        }
        if (keyB != null && !keyB.equals(keyA)) {
            ctx.indexRecipe(keyB, false, catIndex, idx);
        }
        if (keyR != null) {
            ctx.indexRecipe(keyR, true, catIndex, idx);
        }
    }

    private static void drawArrow(GuiGraphics g, int x, int y) {
        g.fill(x, y + 5, x + 14, y + 7, ARROW_COLOR);
        g.fill(x + 12, y + 3, x + 14, y + 9, ARROW_COLOR);
        g.fill(x + 14, y + 4, x + 16, y + 8, ARROW_COLOR);
        g.fill(x + 16, y + 5, x + 18, y + 7, ARROW_COLOR);
    }

    @Nullable
    private String addSlot(JsonArray slots, ItemStack stack) {
        if (stack.isEmpty()) {
            return null;
        }
        var typed = catalog.manager.createTypedIngredient(stack);
        if (typed.isEmpty()) {
            ctx.failure("trade ingredient is not registered with JEI: " + stack);
            return null;
        }
        String key = catalog.ensure(typed.get());
        JsonArray pair = new JsonArray();
        pair.add(key);
        pair.add(stack.getCount());
        JsonArray slot = new JsonArray();
        slot.add(pair);
        slots.add(slot);
        return key;
    }

    @Override
    public void close() throws IOException {
        if (written) {
            return;
        }
        categoryJson.addProperty("count", recipesJson.size());
        var file = ctx.root.resolve(dirName).resolve("recipes.json");
        Files.createDirectories(file.getParent());
        try (Writer writer = Files.newBufferedWriter(file)) {
            GSON.toJson(recipesJson, writer);
        }
        ctx.recipeCount += recipesJson.size();
        written = true;
    }

    @Override
    public String label() {
        return "trades";
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
