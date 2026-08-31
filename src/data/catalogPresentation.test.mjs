import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogTypePresentation,
  isItemCatalogBrowseVisible,
  isItemCatalogEligible,
  normalizeCatalogItemNames,
  stripMinecraftFormattingCodes,
} from './catalogPresentation.ts';

const item = (overrides = {}) => ({
  k: 'item|minecraft:stone',
  id: 'minecraft:stone',
  n: 'Stone',
  m: 'minecraft',
  ...overrides,
});

test('excludes synthetic Immersive Technology multiblock render models from the item browser', () => {
  assert.equal(
    isItemCatalogEligible(item({
      t: 'custom_mctmods.immersivetechnology.common.util.compat.jei.genericmultiblockingredient_e2d9e4dd',
    })),
    false,
  );
  assert.equal(
    isItemCatalogEligible(item({
      k: 'item|immersivetech:metal_multiblock:3',
      id: 'immersivetech:metal_multiblock',
      n: 'Steam Turbine',
      m: 'immersivetech',
    })),
    true,
  );
});

test('excludes Ender IO JEI energy while retaining other energy resources', () => {
  assert.equal(
    isItemCatalogEligible(item({
      k: 'custom_crazypants.enderio.base.integration.jei.energy.energyingredient_4926a629|enderio:energy',
      id: 'enderio:energy',
      n: '0 µI',
      m: 'enderio',
      t: 'custom_crazypants.enderio.base.integration.jei.energy.energyingredient_4926a629',
    })),
    false,
  );
  assert.equal(
    isItemCatalogEligible(item({
      k: 'custom_requious.compat.jei.ingredient.energy_21ab14a6|energy',
      id: 'requious:energy',
      n: 'Energy',
      m: 'requious',
      t: 'custom_requious.compat.jei.ingredient.energy_21ab14a6',
    })),
    true,
  );
});

test('excludes AE facades globally while retaining real covered cables', () => {
  assert.equal(
    isItemCatalogEligible(item({
      k: 'item|appliedenergistics2:facade:{item:"minecraft:stone",damage:0}',
      id: 'appliedenergistics2:facade',
      n: 'Cable Facade - Stone',
      m: 'appliedenergistics2',
    })),
    false,
  );
  assert.equal(
    isItemCatalogEligible(item({
      k: 'item|ae2:facade',
      id: 'ae2:facade',
      n: 'Cable Facade',
      m: 'ae2',
    })),
    false,
  );
  assert.equal(
    isItemCatalogEligible(item({
      k: 'item|appliedenergistics2:part:20',
      id: 'appliedenergistics2:part',
      n: 'ME Covered Cable - White',
      m: 'appliedenergistics2',
    })),
    true,
  );
});

test('excludes cover carriers across supported generations', () => {
  for (const [id, mod] of [
    ['ForgeMicroblock:microblock', 'ForgeMicroblock'],
    ['microblockcbe:microblock', 'microblockcbe'],
    ['cb_microblock:microblock', 'cb_microblock'],
    ['ThermalDynamics:cover', 'ThermalDynamics'],
  ]) {
    assert.equal(
      isItemCatalogEligible(item({
        k: `item|${id}|{mat:"minecraft:stone"}`,
        id,
        n: 'Stone Cover',
        m: mod,
      })),
      false,
    );
  }

  for (const [id, name, mod] of [
    ['microblockcbe:saw_diamond', 'Diamond Saw', 'microblockcbe'],
    ['ForgeMicroblock:stoneRod', 'Stone Rod', 'ForgeMicroblock'],
    ['thermaldynamics:duct_0', 'Cryo-Stabilized Fluxduct', 'thermaldynamics'],
    ['gregtech:gt.metaitem.01', 'Fluid Filter Cover', 'gregtech'],
  ]) {
    assert.equal(
      isItemCatalogEligible(item({k: `item|${id}`, id, n: name, m: mod})),
      true,
    );
  }
});

test('hides fluids, enchanted books, and aspects only from default catalog browsing', () => {
  for (const hiddenItem of [
    item({
      k: 'fluid|minecraft:water',
      id: 'minecraft:water',
      n: 'Water',
      t: 'fluid',
    }),
    item({
      k: 'custom_example.hybridfluid_12345678|steam',
      id: 'example:steam',
      n: 'Steam',
      t: 'custom_example.hybridfluid_12345678',
    }),
    item({
      k: 'enchant|minecraft:protection:1',
      id: 'minecraft:protection',
      n: 'Protection I',
      t: 'enchant',
    }),
    item({
      k: 'item|minecraft:enchanted_book:[enchantment.minecraft.protection.lvl1]',
      id: 'minecraft:enchanted_book:[enchantment.minecraft.protection.lvl1]',
      n: 'Enchanted Book',
    }),
    item({
      k: 'custom_thaumcraft.api.aspects.aspectlist_0409b2e6|aer',
      id: 'thaumcraft:aer',
      n: 'Aer',
      t: 'custom_thaumcraft.api.aspects.aspectlist_0409b2e6',
    }),
  ]) {
    assert.equal(isItemCatalogEligible(hiddenItem), true);
    assert.equal(isItemCatalogBrowseVisible(hiddenItem), false);
  }

  assert.equal(isItemCatalogBrowseVisible(item()), true);
  assert.equal(
    isItemCatalogBrowseVisible(item({
      k: 'custom_mekanism.api.gas.gasstack_3b5b153e|oxygen',
      id: 'mekanism:oxygen',
      n: 'Oxygen',
      t: 'custom_mekanism.api.gas.gasstack_3b5b153e',
    })),
    true,
  );
});

test('uses concise labels for Multiblock Madness custom ingredient types', () => {
  assert.deepEqual(
    catalogTypePresentation('custom_thaumcraft.api.aspects.aspectlist_0409b2e6'),
    {label: 'Aspect', recognized: true},
  );
  assert.deepEqual(
    catalogTypePresentation('custom_mekanism.api.gas.gasstack_3b5b153e'),
    {label: 'Gas', recognized: true},
  );
  assert.deepEqual(
    catalogTypePresentation(
      'custom_hellfirepvp.modularmachinery.common.integration.ingredient.hybridfluid_2ad9a7d4',
    ),
    {label: 'Fluid', recognized: true},
  );
  assert.deepEqual(
    catalogTypePresentation('custom_lach_01298.qmd.particle.particlestack_81a31f1d'),
    {label: 'Particle', recognized: true},
  );
});

test('keeps unknown exporter types readable and marks them for diagnostics', () => {
  assert.deepEqual(
    catalogTypePresentation('custom_example.internal.ingredient_1234abcd'),
    {label: 'Custom ingredient', recognized: false},
  );
  assert.deepEqual(
    catalogTypePresentation('future_resource'),
    {label: 'future resource', recognized: false},
  );
});

test('removes legacy and hexadecimal Minecraft formatting codes from item names', () => {
  assert.equal(
    stripMinecraftFormattingCodes('§3Galactic §lStandard §rCurrency'),
    'Galactic Standard Currency',
  );
  assert.equal(
    stripMinecraftFormattingCodes('§x§f§f§0§0§a§aDimensional Alloy'),
    'Dimensional Alloy',
  );
});

test('normalizes catalog names once and reports a visible registry-id fallback', () => {
  const result = normalizeCatalogItemNames([
    item({n: 'Stone'}),
    item({k: 'item|test:colored', id: 'test:colored', n: '§9Stage 4 Alloy'}),
    item({k: 'item|test:empty', id: 'test:empty', n: '§l§r'}),
  ]);

  assert.deepEqual(
    result.items.map(entry => entry.n),
    ['Stone', 'Stage 4 Alloy', 'test:empty'],
  );
  assert.equal(result.formattedNameCount, 2);
  assert.equal(result.emptyNameFallbackCount, 1);
});
