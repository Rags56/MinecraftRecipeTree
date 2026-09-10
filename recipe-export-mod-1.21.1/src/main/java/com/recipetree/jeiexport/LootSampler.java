package com.recipetree.jeiexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.level.storage.loot.LootParams;
import net.minecraft.world.level.storage.loot.LootTable;
import net.minecraft.world.level.storage.loot.parameters.LootContextParamSets;
import net.minecraft.world.level.storage.loot.parameters.LootContextParams;
import org.jetbrains.annotations.Nullable;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Estimates drops by rolling loot tables many times. Loot conditions/functions can touch
 * world state, so all sampling runs on the server thread (callers use server.submit).
 */
final class LootSampler {
    private static final Method DROP_CUSTOM_DEATH_LOOT = customDeathLootMethod();

    private LootSampler() {
    }

    private static Method customDeathLootMethod() {
        try {
            Method method = LivingEntity.class.getDeclaredMethod(
                    "dropCustomDeathLoot", ServerLevel.class, DamageSource.class, boolean.class);
            method.setAccessible(true);
            return method;
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private static void dropCustomDeathLoot(
            LivingEntity living, ServerLevel level, DamageSource source, boolean killedByPlayer) {
        try {
            DROP_CUSTOM_DEATH_LOOT.invoke(living, level, source, killedByPlayer);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException("Cannot invoke LivingEntity.dropCustomDeathLoot", e);
        } catch (InvocationTargetException e) {
            Throwable cause = e.getCause();
            if (cause instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            if (cause instanceof Error error) {
                throw error;
            }
            throw new IllegalStateException("LivingEntity.dropCustomDeathLoot failed", cause);
        }
    }

    static final class Agg {
        int rollsDropped;
        long total;
        int min = Integer.MAX_VALUE;
        int max;
    }

    /** Rolls the supplier `rolls` times and aggregates stack totals per item. Server thread only. */
    static Map<String, Agg> aggregate(int rolls, Supplier<List<ItemStack>> roll) {
        Map<String, Agg> agg = new HashMap<>();
        Map<String, Integer> perRoll = new HashMap<>();
        for (int i = 0; i < rolls; i++) {
            perRoll.clear();
            for (ItemStack stack : roll.get()) {
                if (stack.isEmpty()) {
                    continue;
                }
                ResourceLocation id = BuiltInRegistries.ITEM.getKey(stack.getItem());
                if (id == null) {
                    continue;
                }
                perRoll.merge("item|" + id, stack.getCount(), Integer::sum);
            }
            for (Map.Entry<String, Integer> e : perRoll.entrySet()) {
                Agg a = agg.computeIfAbsent(e.getKey(), k -> new Agg());
                a.rollsDropped++;
                a.total += e.getValue();
                a.min = Math.min(a.min, e.getValue());
                a.max = Math.max(a.max, e.getValue());
            }
        }
        return agg;
    }

    /**
     * chance = fraction of kills/breaks that drop it; min/max = stack totals when it drops;
     * avg = average per kill/break overall.
     */
    static JsonArray toJson(Map<String, Agg> agg, int rolls) {
        JsonArray arr = new JsonArray();
        agg.entrySet().stream()
                .sorted((a, b) -> Long.compare(b.getValue().total, a.getValue().total))
                .forEach(e -> {
                    Agg a = e.getValue();
                    JsonObject o = new JsonObject();
                    o.addProperty("k", e.getKey());
                    o.addProperty("c", Math.round(a.rollsDropped * 1000.0 / rolls) / 1000.0);
                    o.addProperty("min", a.min);
                    o.addProperty("max", a.max);
                    o.addProperty("avg", Math.round(a.total * 100.0 / rolls) / 100.0);
                    arr.add(o);
                });
        return arr;
    }

    /**
     * What an entity drops when killed by a player (no looting). Returns null when the
     * type isn't living or has no loot table. Blocks until the server thread runs it.
     */
    @Nullable
    static JsonArray sampleEntityDrops(MinecraftServer server, EntityType<?> type, int rolls) {
        return server.submit(() -> {
            ServerLevel level = server.overworld();
            Entity created = type.create(level);
            if (!(created instanceof LivingEntity living)) {
                if (created != null) {
                    created.discard();
                }
                return (JsonArray) null;
            }
            try {
                LootTable table = resolveLootTable(
                        living.getLootTable(),
                        server.reloadableRegistries()::getLootTable);
                if (table == null) {
                    return null;
                }
                ServerPlayer player = server.getPlayerList().getPlayers().isEmpty()
                        ? null
                        : server.getPlayerList().getPlayers().get(0);
                DamageSource source = player != null
                        ? level.damageSources().playerAttack(player)
                        : level.damageSources().generic();
                LootParams.Builder builder = new LootParams.Builder(level)
                        .withParameter(LootContextParams.THIS_ENTITY, living)
                        .withParameter(LootContextParams.ORIGIN, living.position())
                        .withParameter(LootContextParams.DAMAGE_SOURCE, source);
                if (player != null) {
                    builder.withParameter(LootContextParams.ATTACKING_ENTITY, player)
                            .withParameter(LootContextParams.DIRECT_ATTACKING_ENTITY, player)
                            .withParameter(LootContextParams.LAST_DAMAGE_PLAYER, player)
                            .withLuck(player.getLuck());
                }
                LootParams params = builder.create(LootContextParamSets.ENTITY);
                JsonArray json = toJson(aggregate(rolls, () -> table.getRandomItems(params)), rolls);
                return json.isEmpty() ? null : json;
            } finally {
                living.discard();
            }
        }).join();
    }

    @Nullable
    static LootTable resolveLootTable(
            @Nullable net.minecraft.resources.ResourceKey<LootTable> lootTableId,
            Function<net.minecraft.resources.ResourceKey<LootTable>, LootTable> resolver) {
        if (lootTableId == null) {
            return null;
        }
        LootTable table = resolver.apply(lootTableId);
        return table == LootTable.EMPTY ? null : table;
    }

    /**
     * Data packs can declare an intentionally empty table as an ordinary JSON object with no
     * pools. Minecraft creates a distinct LootTable instance for it, so identity comparison with
     * LootTable.EMPTY alone does not recognize the no-drop declaration.
     */
    static boolean isStructurallyEmpty(LootTable table) {
        return table == LootTable.EMPTY || hasNoPools(table.pools);
    }

    static boolean hasNoPools(List<?> pools) {
        return pools.isEmpty();
    }

    /**
     * Samples items emitted by LivingEntity#dropCustomDeathLoot, which is separate
     * from the registered loot table and is used by vanilla bosses and some mods.
     * Spawned item entities are captured above the build limit and immediately removed.
     */
    @Nullable
    static JsonArray sampleCustomDeathDrops(MinecraftServer server, EntityType<?> type, int rolls) {
        return server.submit(() -> {
            ServerLevel level = server.overworld();
            ServerPlayer player = server.getPlayerList().getPlayers().isEmpty()
                    ? null
                    : server.getPlayerList().getPlayers().get(0);
            DamageSource source = player != null
                    ? level.damageSources().playerAttack(player)
                    : level.damageSources().generic();
            double probeY = level.getMaxBuildHeight() + 1024.0;
            AABB captureBox = new AABB(-4, probeY - 4, -4, 4, probeY + 4, 4);

            Map<String, Agg> aggregate = aggregate(rolls, () -> {
                Entity created = type.create(level);
                if (!(created instanceof LivingEntity living)) {
                    if (created != null) created.discard();
                    return List.of();
                }
                living.setPos(0, probeY, 0);
                try {
                    dropCustomDeathLoot(living, level, source, player != null);
                    return level.getEntitiesOfClass(ItemEntity.class, captureBox)
                            .stream()
                            .map(item -> item.getItem().copy())
                            .toList();
                } finally {
                    level.getEntitiesOfClass(ItemEntity.class, captureBox).forEach(Entity::discard);
                    living.discard();
                }
            });
            JsonArray json = toJson(aggregate, rolls);
            return json.isEmpty() ? null : json;
        }).join();
    }
}
