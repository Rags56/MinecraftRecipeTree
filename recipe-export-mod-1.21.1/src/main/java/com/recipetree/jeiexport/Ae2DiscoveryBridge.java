package com.recipetree.jeiexport;

import net.minecraft.client.gui.screens.Screen;
import net.minecraft.resources.ResourceLocation;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

/** Optional, read-only access to the item repository already synchronized to an open AE2 terminal. */
final class Ae2DiscoveryBridge {
    private static final String STORAGE_SCREEN = "appeng.client.gui.me.common.MEStorageScreen";
    private static final String ITEM_KEY = "appeng.api.stacks.AEItemKey";

    private static Class<?> storageScreenClass;
    private static Field repoField;
    private static Method getAllEntries;
    private static Method getStoredAmount;
    private static Method getWhat;
    private static Method getId;
    private static boolean failureLogged;
    private static boolean bridgeDisabled;

    private Ae2DiscoveryBridge() {
    }

    static boolean isStorageScreen(Screen screen) {
        return screen != null && findStorageScreenClass(screen.getClass()) != null;
    }

    static List<String> storedItemIds(Screen screen) {
        if (bridgeDisabled) return List.of();
        Class<?> screenBase = screen == null ? null : findStorageScreenClass(screen.getClass());
        if (screenBase == null) return List.of();
        try {
            initialize(screenBase, screen.getClass().getClassLoader());
            Object repo = repoField.get(screen);
            Object rawEntries = getAllEntries.invoke(repo);
            if (!(rawEntries instanceof Collection<?> entries)) {
                throw new IllegalStateException("AE2 terminal repository returned a non-collection entry set");
            }
            List<String> itemIds = new ArrayList<>();
            for (Object entry : entries) {
                long stored = ((Number) getStoredAmount.invoke(entry)).longValue();
                if (stored <= 0) continue;
                Object key = getWhat.invoke(entry);
                if (key == null || !ITEM_KEY.equals(key.getClass().getName())) continue;
                Object rawId = getId.invoke(key);
                if (rawId instanceof ResourceLocation itemId) {
                    itemIds.add(itemId.toString());
                } else {
                    throw new IllegalStateException("AE2 item key returned a non-resource identifier");
                }
            }
            return itemIds;
        } catch (ReflectiveOperationException | RuntimeException error) {
            bridgeDisabled = true;
            if (!failureLogged) {
                failureLogged = true;
                JeiExportMod.LOGGER.warn(
                        "Could not read the item repository synchronized to the open AE2 terminal; "
                                + "AE discovery is disabled for this session",
                        error);
            }
            return List.of();
        }
    }

    private static Class<?> findStorageScreenClass(Class<?> type) {
        Class<?> current = type;
        while (current != null) {
            if (STORAGE_SCREEN.equals(current.getName())) return current;
            current = current.getSuperclass();
        }
        return null;
    }

    private static void initialize(Class<?> screenBase, ClassLoader loader) throws ReflectiveOperationException {
        if (storageScreenClass == screenBase && repoField != null) return;
        Field discoveredRepo = screenBase.getDeclaredField("repo");
        if (!discoveredRepo.trySetAccessible()) {
            throw new IllegalAccessException("AE2 terminal repository field is inaccessible");
        }
        Class<?> repoClass = Class.forName("appeng.client.gui.me.common.Repo", false, loader);
        Class<?> entryClass = Class.forName("appeng.menu.me.common.GridInventoryEntry", false, loader);
        Class<?> keyClass = Class.forName("appeng.api.stacks.AEKey", false, loader);
        repoField = discoveredRepo;
        getAllEntries = repoClass.getMethod("getAllEntries");
        getStoredAmount = entryClass.getMethod("getStoredAmount");
        getWhat = entryClass.getMethod("getWhat");
        getId = keyClass.getMethod("getId");
        storageScreenClass = screenBase;
    }
}
