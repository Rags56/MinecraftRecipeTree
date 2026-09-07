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
import net.neoforged.neoforge.common.ModConfigSpec;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.entity.player.PlayerInteractEvent;
import net.neoforged.neoforge.event.level.LevelEvent;
import net.neoforged.bus.api.SubscribeEvent;

/** Vanilla written book: no registry item or server-side installation requirement. */
final class RecipeTreeBook {
    private static final String MARKER = "jeiexportRecipeTreeBook";
    private static final String DATA_ID = "jeiexport_book_grant";
    static final ModConfigSpec CONFIG_SPEC;
    private static final ModConfigSpec.BooleanValue SPAWN_BOOK;
    static {
        var builder = new ModConfigSpec.Builder();
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
        return level.getDataStorage().computeIfAbsent(new SavedData.Factory<>(GrantData::new, (tag, registries) -> GrantData.load(tag)), DATA_ID);
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
        return stack.is(Items.WRITTEN_BOOK) && stack.getOrDefault(net.minecraft.core.component.DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.EMPTY).copyTag().getBoolean(MARKER);
    }

    static ItemStack createBook() {
        ItemStack book = new ItemStack(Items.WRITTEN_BOOK);
        CompoundTag marker = new CompoundTag();
        marker.putBoolean(MARKER, true);
        book.set(net.minecraft.core.component.DataComponents.CUSTOM_DATA, net.minecraft.world.item.component.CustomData.of(marker));
        book.set(net.minecraft.core.component.DataComponents.WRITTEN_BOOK_CONTENT,
                new net.minecraft.world.item.component.WrittenBookContent(
                        net.minecraft.server.network.Filterable.passThrough("Recipe Tree Book"), "Filostorm", 0,
                        java.util.List.of(
                                net.minecraft.server.network.Filterable.passThrough(Component.literal("Recipe Tree\n\nRight-click to reopen this world's latest tree.\n\nHover an item in JEI or your inventory and press G to start a tree.")),
                                net.minecraft.server.network.Filterable.passThrough(Component.literal("Planner controls\n\nDrag: pan\nWheel: zoom or change amount/alternative\nR: reusable input\n\nImport / Export: history, snapshots, JSON files and pack exports."))), true));
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
        @Override public CompoundTag save(CompoundTag tag, net.minecraft.core.HolderLookup.Provider registries) {
            tag.putBoolean("pending", pending);
            tag.putBoolean("granted", granted);
            return tag;
        }
    }
}
