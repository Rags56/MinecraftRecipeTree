package com.recipetree.jeiexport;

import com.mojang.blaze3d.platform.InputConstants;
import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.client.event.ScreenEvent;
import net.minecraftforge.client.event.ClientPlayerNetworkEvent;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

public final class RecipeTreeClient {
    private static final int INVENTORY_DISCOVERY_INTERVAL = 20;
    private static final int MAX_AE_DISCOVERY_PASSES = 3;
    private static final KeyMapping OPEN_PLANNER = new KeyMapping(
            "key.jeiexport.open_recipe_tree",
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_G,
            "key.categories.jeiexport");
    private static int inventoryDiscoveryCooldown;
    private static Screen aeDiscoveryScreen;
    private static int aeDiscoveryDelay;
    private static int aeDiscoveryPasses;
    private static RecipeTreeScreen lastViewedTree;
    private static String worldScope;

    private RecipeTreeClient() {
    }

    public static void registerKeys(RegisterKeyMappingsEvent event) {
        event.register(OPEN_PLANNER);
    }

    @SubscribeEvent
    public static void onClientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.player == null) return;
        String nextScope = minecraft.getSingleplayerServer() != null
                ? "save:" + minecraft.getSingleplayerServer().getWorldPath(
                        net.minecraft.world.level.storage.LevelResource.ROOT).toAbsolutePath().normalize()
                : minecraft.getCurrentServer() != null ? "server:" + minecraft.getCurrentServer().ip : null;
        if (!java.util.Objects.equals(worldScope, nextScope)) {
            worldScope = nextScope;
            lastViewedTree = null;
            RecipeTreeProgress.get().setActiveWorld(nextScope);
        }
        trackDiscoveredItems(minecraft);

        while (OPEN_PLANNER.consumeClick()) {
            if (isTyping(minecraft.screen)) continue;
            if (minecraft.screen == null && reopenLastViewedTree(minecraft)) return;
            openForCurrentItem(minecraft);
        }
    }

    static void rememberTree(RecipeTreeScreen tree) {
        lastViewedTree = tree;
    }

    private static boolean reopenLastViewedTree(Minecraft minecraft) {
        if (lastViewedTree == null) {
            IJeiRuntime runtime = JeiExportPlugin.runtime();
            if (runtime == null) return false;
            lastViewedTree = RecipeTreeScreen.restoreLastViewed(runtime);
        }
        if (lastViewedTree == null) return false;
        minecraft.setScreen(lastViewedTree);
        return true;
    }

    @SubscribeEvent
    public static void onPlayerLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        // Recipe layouts belong to the current viewer runtime. Recreate the persisted tree after
        // the next world finishes loading instead of carrying cached layouts between worlds.
        lastViewedTree = null;
        worldScope = null;
        RecipeTreeProgress.get().setActiveWorld(null);
    }

    private static void trackDiscoveredItems(Minecraft minecraft) {
        if (inventoryDiscoveryCooldown-- <= 0) {
            inventoryDiscoveryCooldown = INVENTORY_DISCOVERY_INTERVAL;
            List<ItemStack> heldItems = new ArrayList<>();
            for (int slot = 0; slot < minecraft.player.getInventory().getContainerSize(); slot++) {
                ItemStack stack = minecraft.player.getInventory().getItem(slot);
                if (!stack.isEmpty()) heldItems.add(stack);
            }
            ItemStack carried = minecraft.player.containerMenu.getCarried();
            if (!carried.isEmpty()) heldItems.add(carried);
            RecipeTreeProgress.get().discoverItems(heldItems);
        }

        Screen currentScreen = minecraft.screen;
        if (currentScreen != aeDiscoveryScreen) {
            aeDiscoveryScreen = Ae2DiscoveryBridge.isStorageScreen(currentScreen) ? currentScreen : null;
            aeDiscoveryDelay = 0;
            aeDiscoveryPasses = 0;
        }
        if (aeDiscoveryScreen == null || aeDiscoveryPasses >= MAX_AE_DISCOVERY_PASSES) return;
        if (aeDiscoveryDelay-- > 0) return;

        discoverAeItems(aeDiscoveryScreen);
        aeDiscoveryPasses++;
        aeDiscoveryDelay = aeDiscoveryPasses == 1 ? 40 : 80;
    }

    private static void discoverAeItems(Screen screen) {
        List<String> aeItemIds = Ae2DiscoveryBridge.storedItemIds(screen);
        int discovered = RecipeTreeProgress.get().discoverItemKeys(aeItemIds);
        if (discovered > 0) {
            JeiExportMod.LOGGER.info(
                    "Discovered {} item type(s) from the synchronized AE2 terminal repository",
                    discovered);
        }
    }

    @SubscribeEvent
    public static void onScreenKeyPressed(ScreenEvent.KeyPressed.Pre event) {
        if (isPlannerScreen(event.getScreen()) && !isTyping(event.getScreen())
                && Minecraft.getInstance().options.keyInventory.matches(event.getKeyCode(), event.getScanCode())) {
            var minecraft = Minecraft.getInstance();
            if (minecraft.player != null) {
                event.setCanceled(true);
                if (minecraft.gameMode != null && minecraft.gameMode.isServerControlledInventory()) {
                    minecraft.player.sendOpenInventory();
                } else {
                    minecraft.getTutorial().onOpenInventory();
                    minecraft.setScreen(new net.minecraft.client.gui.screens.inventory.InventoryScreen(minecraft.player));
                }
            }
            return;
        }
        if (!OPEN_PLANNER.matches(event.getKeyCode(), event.getScanCode())) return;
        if (isTyping(event.getScreen())) return;

        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.player == null) return;

        IJeiRuntime runtime = JeiExportPlugin.runtime();
        boolean inventoryScreen = event.getScreen() instanceof AbstractContainerScreen<?>;
        boolean hoveredJeiRecipeIngredient = runtime != null
                && runtime.getRecipesGui().getIngredientUnderMouse(VanillaTypes.ITEM_STACK)
                .filter(stack -> !stack.isEmpty())
                .isPresent();
        if (!inventoryScreen && !hoveredJeiRecipeIngredient) return;

        event.setCanceled(true);
        if (Ae2DiscoveryBridge.isStorageScreen(event.getScreen())) {
            // Preserve the authorized terminal snapshot before replacing it with the planner screen.
            discoverAeItems(event.getScreen());
        }
        while (OPEN_PLANNER.consumeClick()) {
            // Drain the mapping so the end-of-tick handler does not reopen the planner.
        }
        openForCurrentItem(minecraft);
    }

    private static boolean isPlannerScreen(Screen screen) {
        return screen instanceof RecipeTreeScreen
                || screen.getClass().getName().startsWith(RecipeTreeScreen.class.getName() + "$");
    }

    static boolean openFromBook() {
        return reopenLastViewedTree(Minecraft.getInstance());
    }

    private static boolean isTyping(Screen screen) {
        return screen != null
                && screen.getFocused() instanceof EditBox editBox
                && editBox.isFocused();
    }

    private static void openForCurrentItem(Minecraft minecraft) {
        IJeiRuntime runtime = JeiExportPlugin.runtime();
        if (runtime == null) {
            minecraft.player.displayClientMessage(
                    Component.literal("Recipe Tree is waiting for JEI to finish loading."), true);
            return;
        }

        Optional<ItemStack> target = Optional.ofNullable(
                        runtime.getIngredientListOverlay().getIngredientUnderMouse(VanillaTypes.ITEM_STACK))
                .filter(stack -> !stack.isEmpty());
        if (target.isEmpty()) {
            target = runtime.getRecipesGui().getIngredientUnderMouse(VanillaTypes.ITEM_STACK)
                    .filter(stack -> !stack.isEmpty());
        }
        if (target.isEmpty() && minecraft.screen instanceof AbstractContainerScreen<?> containerScreen) {
            Slot hoveredSlot = containerScreen.hoveredSlot;
            if (hoveredSlot != null && hoveredSlot.hasItem()) {
                target = Optional.of(hoveredSlot.getItem()).filter(stack -> !stack.isEmpty());
            }
        }
        if (target.isEmpty()) {
            target = Optional.of(minecraft.player.getMainHandItem()).filter(stack -> !stack.isEmpty());
        }
        if (target.isEmpty()) {
            target = Optional.of(minecraft.player.getOffhandItem()).filter(stack -> !stack.isEmpty());
        }

        if (target.isEmpty()) {
            minecraft.player.displayClientMessage(
                    Component.literal("Hover a JEI or inventory item, or hold an item, then press G."), true);
            return;
        }
        ItemStack openedItem = target.get().copyWithCount(1);
        if (lastViewedTree == null) {
            lastViewedTree = RecipeTreeScreen.restoreLastViewed(runtime);
        }
        if (lastViewedTree != null) {
            minecraft.setScreen(lastViewedTree.screenForOpenedItem(openedItem));
            return;
        }
        RecipeTreeScreen tree = new RecipeTreeScreen(openedItem, runtime);
        minecraft.setScreen(tree.initialInputRecipeScreen());
    }
}
