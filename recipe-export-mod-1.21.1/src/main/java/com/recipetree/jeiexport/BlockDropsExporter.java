package com.recipetree.jeiexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.enchantment.Enchantments;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.state.properties.IntegerProperty;
import net.minecraft.world.level.block.state.properties.Property;
import net.minecraft.world.level.storage.loot.BuiltInLootTables;
import net.minecraft.world.level.storage.loot.LootParams;
import net.minecraft.world.level.storage.loot.LootTable;
import net.minecraft.world.level.storage.loot.parameters.LootContextParamSets;
import net.minecraft.world.level.storage.loot.parameters.LootContextParams;
import net.minecraft.world.phys.Vec3;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.io.Writer;
import java.nio.file.Files;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Block-drops phase: for every block with a loot table, finds the tool that harvests it
 * best (pickaxe/axe/shovel/hoe/shears/sword/hand), samples the loot table with that tool,
 * and also records the silk-touch result when it differs. Needs a singleplayer world
 * (the integrated server) since loot rolls run server-side.
 */
final class BlockDropsExporter implements ExportJob.PhaseRunner {
    /** One expensive loot-sampling unit per scheduler step prevents multi-second tick spikes. */
    private static final int BATCH = 1;
    private static final int CANDIDATE_ROLLS = 64;
    private static final int FINAL_ROLLS = 512;
    private static final int SILK_ROLLS = 128;
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    private final ExportContext ctx;
    @Nullable
    private final MinecraftServer server;
    private final ArrayDeque<BlockItem> queue = new ArrayDeque<>();
    private final int total;
    private int done;
    private final JsonObject blocks = new JsonObject();
    private boolean written;
    private boolean blockCacheAvailable = true;

    BlockDropsExporter(ExportContext ctx) {
        this.ctx = ctx;
        this.server = Minecraft.getInstance().getSingleplayerServer();
        if (server != null) {
            for (Item item : BuiltInRegistries.ITEM) {
                if (item instanceof BlockItem blockItem
                        && blockItem.getBlock().getLootTable() != BuiltInLootTables.EMPTY) {
                    queue.add(blockItem);
                }
            }
        } else {
            ExportJob.chat("Block drops can only be checked in a single-player world, so they were skipped.", ChatFormatting.YELLOW);
        }
        this.total = queue.size();
    }

    @Override
    public boolean step() {
        if (queue.isEmpty()) {
            return true;
        }
        List<BlockItem> batch = new ArrayList<>(BATCH);
        for (int i = 0; i < BATCH && !queue.isEmpty(); i++) {
            batch.add(queue.poll());
        }
        List<BlockItem> missing = new ArrayList<>(batch.size());
        for (BlockItem item : batch) {
            if (!reuseBlockDrop(item)) {
                missing.add(item);
            }
        }
        if (missing.isEmpty()) {
            done += batch.size();
            return queue.isEmpty();
        }
        try {
            server.submit(() -> {
                for (BlockItem item : missing) {
                    try {
                        sampleOne(item);
                    } catch (Throwable t) {
                        ctx.failure("blockdrops " + BuiltInRegistries.ITEM.getKey(item), t);
                    }
                }
            }).join();
        } catch (Throwable t) {
            ctx.failure("blockdrops batch", t);
        }
        done += batch.size();
        return queue.isEmpty();
    }

    private boolean reuseBlockDrop(BlockItem item) {
        if (ctx.previous == null || !blockCacheAvailable) {
            return false;
        }
        ResourceLocation id = BuiltInRegistries.ITEM.getKey(item);
        if (id == null) {
            return false;
        }
        String key = "item|" + id;
        try {
            JsonObject previousDrop = ctx.previous.blockDrop(key);
            if (previousDrop == null) {
                return false;
            }
            blocks.add(key, previousDrop.deepCopy());
            ctx.blockDropsCount++;
            ctx.reusedBlockDrops++;
            return true;
        } catch (IOException cacheFailure) {
            blockCacheAvailable = false;
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Block-drop cache lookup failed; sampling remaining blocks again",
                    cacheFailure);
            return false;
        }
    }

    /** Runs on the server thread. */
    private void sampleOne(BlockItem item) {
        ServerLevel level = server.overworld();
        Block block = item.getBlock();
        BlockState state = block.defaultBlockState();
        // Crops etc.: sample the fully-grown state, that's what players harvest.
        for (Property<?> property : state.getProperties()) {
            if (property instanceof IntegerProperty ip && "age".equals(ip.getName())) {
                state = state.setValue(ip, Collections.max(ip.getPossibleValues()));
            }
        }
        LootTable table = server.reloadableRegistries().getLootTable(block.getLootTable());
        if (LootSampler.isStructurallyEmpty(table)) {
            return;
        }
        Vec3 origin = Vec3.atCenterOf(level.getSharedSpawnPos());
        BlockState finalState = state;

        // Loot tables don't encode the "requires correct tool" survival rule, so filter
        // candidates by it; only swap tools when one is clearly (>5%) better, otherwise
        // sampling noise picks arbitrary winners among equivalent tools.
        boolean requiresTool = finalState.requiresCorrectToolForDrops();
        ItemStack bestTool = ItemStack.EMPTY;
        double bestScore = -1;
        for (ItemStack tool : candidateTools()) {
            if (requiresTool && !tool.isCorrectToolForDrops(finalState)) {
                continue;
            }
            Map<String, LootSampler.Agg> agg = LootSampler.aggregate(CANDIDATE_ROLLS,
                    () -> table.getRandomItems(blockParams(level, finalState, origin, tool)));
            double score = agg.values().stream().mapToLong(a -> a.total).sum();
            if (score > bestScore * 1.05 + 0.0001) {
                bestScore = score;
                bestTool = tool;
            }
        }
        if (bestScore < 0) {
            // Needs a tool none of our candidates qualify as (modded tiers); sample with a pickaxe.
            ctx.warning("blockdrops " + BuiltInRegistries.ITEM.getKey(item)
                    + ": no standard candidate tool satisfies requiresCorrectToolForDrops; "
                    + "probing with a netherite pickaxe");
            bestTool = new ItemStack(Items.NETHERITE_PICKAXE);
        }

        ItemStack chosenTool = bestTool;
        Map<String, LootSampler.Agg> finalAgg = LootSampler.aggregate(FINAL_ROLLS,
                () -> table.getRandomItems(blockParams(level, finalState, origin, chosenTool)));

        ItemStack silkTool = new ItemStack(Items.NETHERITE_PICKAXE);
        silkTool.enchant(
                level.registryAccess().lookupOrThrow(Registries.ENCHANTMENT)
                        .getOrThrow(Enchantments.SILK_TOUCH),
                1);
        Map<String, LootSampler.Agg> silkAgg = LootSampler.aggregate(SILK_ROLLS,
                () -> table.getRandomItems(blockParams(level, finalState, origin, silkTool)));

        JsonObject entry = new JsonObject();
        ResourceLocation toolId =
                chosenTool.isEmpty() ? null : BuiltInRegistries.ITEM.getKey(chosenTool.getItem());
        entry.addProperty("tool", toolId == null ? "hand" : toolId.toString());
        entry.add("drops", LootSampler.toJson(finalAgg, FINAL_ROLLS));
        if (!silkAgg.keySet().equals(finalAgg.keySet())) {
            entry.add("silk", LootSampler.toJson(silkAgg, SILK_ROLLS));
        }
        if (entry.getAsJsonArray("drops").isEmpty() && !entry.has("silk")) {
            return;
        }
        blocks.add("item|" + BuiltInRegistries.ITEM.getKey(item), entry);
        ctx.blockDropsCount++;
    }

    private static List<ItemStack> candidateTools() {
        return List.of(
                ItemStack.EMPTY,
                new ItemStack(Items.NETHERITE_PICKAXE),
                new ItemStack(Items.NETHERITE_AXE),
                new ItemStack(Items.NETHERITE_SHOVEL),
                new ItemStack(Items.NETHERITE_HOE),
                new ItemStack(Items.SHEARS),
                new ItemStack(Items.NETHERITE_SWORD));
    }

    private static LootParams blockParams(ServerLevel level, BlockState state, Vec3 origin, ItemStack tool) {
        return new LootParams.Builder(level)
                .withParameter(LootContextParams.BLOCK_STATE, state)
                .withParameter(LootContextParams.ORIGIN, origin)
                .withParameter(LootContextParams.TOOL, tool)
                .create(LootContextParamSets.BLOCK);
    }

    @Override
    public void close() throws IOException {
        if (written) {
            return;
        }
        JsonObject root = new JsonObject();
        root.add("blocks", blocks);
        try (Writer writer = Files.newBufferedWriter(ctx.root.resolve("blockdrops.json"))) {
            GSON.toJson(root, writer);
        }
        written = true;
    }

    @Override
    public String label() {
        return "block drops";
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
