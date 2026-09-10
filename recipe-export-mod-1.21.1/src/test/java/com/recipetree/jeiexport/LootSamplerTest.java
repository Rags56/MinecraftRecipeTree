package com.recipetree.jeiexport;

import net.minecraft.world.level.storage.loot.LootTable;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class LootSamplerTest {
    @Test
    void skipsModdedEntitiesWithNoLootTableIdWithoutCallingTheResolver() {
        AtomicBoolean resolverCalled = new AtomicBoolean(false);

        LootTable result = LootSampler.resolveLootTable(null, ignored -> {
            resolverCalled.set(true);
            return LootTable.EMPTY;
        });

        assertNull(result);
        assertFalse(resolverCalled.get());
    }

    @Test
    void recognizesThePoolStructureOfDeclaredEmptyLootTables() {
        assertTrue(LootSampler.hasNoPools(List.of()));
        assertFalse(LootSampler.hasNoPools(List.of(new Object())));
    }
}
