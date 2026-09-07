package com.recipetree.jeiexport;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.StringTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraftforge.common.ForgeConfigSpec;
import net.minecraftforge.event.entity.player.PlayerEvent;
import net.minecraftforge.event.entity.player.PlayerInteractEvent;
import net.minecraftforge.event.level.LevelEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

/** Vanilla written book: no registry item or server-side installation requirement. */
final class RecipeTreeBook {
    private static final String MARKER = "jeiexportRecipeTreeBook";
    private static final String DATA_ID = "jeiexport_book_grant";
    static final ForgeConfigSpec CONFIG_SPEC;
    private static final ForgeConfigSpec.BooleanValue SPAWN_BOOK;
    static {
        var builder = new ForgeConfigSpec.Builder();
        SPAWN_BOOK = builder.comment("Give the first player a Recipe Tree guide in newly created singleplayer worlds.")
                .define("recipe_tree.spawnBookInNewWorlds", true);
        CONFIG_SPEC = builder.build();
    }

    @SubscribeEvent
    public static void onCreateSpawn(LevelEvent.CreateSpawnPosition event) {
        if (event.getLevel() instanceof ServerLevel level) arm(level);
    }

    @SubscribeEvent
    public static void onLoad(LevelEvent.Load event) {
        if (event.getLevel() instanceof ServerLevel level && level.isDebug() && level.getGameTime() == 0) arm(level);
    }

    private static boolean localOverworld(ServerLevel level) {
        return level.dimension() == Level.OVERWORLD && !level.getServer().isDedicatedServer();
    }

    private static GrantData data(ServerLevel level) {
        return level.getDataStorage().computeIfAbsent(GrantData::load, GrantData::new, DATA_ID);
    }

    private static void arm(ServerLevel level) {
        if (!localOverworld(level) || !SPAWN_BOOK.get()) return;
        GrantData data = data(level);
        if (!data.granted) { data.pending = true; data.setDirty(); }
    }

    @SubscribeEvent
    public static void onLogin(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity().level() instanceof ServerLevel level)
                || !localOverworld(level) || !SPAWN_BOOK.get()) return;
        GrantData data = data(level);
        if (!data.pending || data.granted) return;
        var inventory = event.getEntity().getInventory();
        boolean alreadyPresent = inventory.items.stream().anyMatch(RecipeTreeBook::isBook);
        if (!alreadyPresent && !inventory.add(createBook())) {
            JeiExportMod.LOGGER.warn("Recipe Tree guide could not fit in the new-world inventory; grant remains pending");
            return;
        }
        data.pending = false;
        data.granted = true;
        data.setDirty();
        event.getEntity().containerMenu.broadcastChanges();
        JeiExportMod.LOGGER.info("Granted the one-time Recipe Tree guide in the new world");
    }

    @SubscribeEvent
    public static void onUse(PlayerInteractEvent.RightClickItem event) {
        if (event.getLevel().isClientSide() && isBook(event.getItemStack()) && RecipeTreeClient.openFromBook()) {
            event.setCancellationResult(InteractionResult.SUCCESS);
            event.setCanceled(true);
        }
    }

    static boolean isBook(ItemStack stack) {
        return stack.is(Items.WRITTEN_BOOK) && stack.hasTag() && stack.getTag().getBoolean(MARKER);
    }

    static ItemStack createBook() {
        ItemStack book = new ItemStack(Items.WRITTEN_BOOK);
        CompoundTag tag = book.getOrCreateTag();
        tag.putBoolean(MARKER, true);
        tag.putString("title", "Recipe Tree Book");
        tag.putString("author", "Filostorm");
        tag.putBoolean("resolved", true);
        ListTag pages = new ListTag();
        pages.add(StringTag.valueOf(Component.Serializer.toJson(Component.literal(
                "Recipe Tree\n\nRight-click to reopen this world's latest tree.\n\nHover an item in JEI or your inventory and press G to start a tree."))));
        pages.add(StringTag.valueOf(Component.Serializer.toJson(Component.literal(
                "Planner controls\n\nDrag: pan\nWheel: zoom or change amount/alternative\nR: reusable input\n\nImport / Export: history, snapshots, JSON files and pack exports."))));
        tag.put("pages", pages);
        return book;
    }

    static final class GrantData extends SavedData {
        private boolean pending;
        private boolean granted;
        static GrantData load(CompoundTag tag) {
            GrantData data = new GrantData();
            data.pending = tag.getBoolean("pending");
            data.granted = tag.getBoolean("granted");
            return data;
        }
        @Override public CompoundTag save(CompoundTag tag) {
            tag.putBoolean("pending", pending);
            tag.putBoolean("granted", granted);
            return tag;
        }
    }
}
