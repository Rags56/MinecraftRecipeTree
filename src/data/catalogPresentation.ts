import type {CatalogItem} from '../types';

const CUSTOM_TYPE_PREFIX = 'custom_';
const EXPORTER_HASH_SUFFIX = /_[0-9a-f]{8}$/i;
const SYNTHETIC_MULTIBLOCK_TYPE = 'genericmultiblockingredient';
const SYNTHETIC_ENDER_IO_ENERGY_TYPE =
  'crazypants.enderio.base.integration.jei.energy.energyingredient';
const MINECRAFT_FORMATTING_CODE = /\u00a7[0-9a-fk-orx]/gi;
const COVER_CARRIER_ITEM_IDS = new Set([
  'cb_microblock:microblock',
  'forgemicroblock:microblock',
  'microblockcbe:microblock',
  'thermaldynamics:cover',
]);

const CUSTOM_TYPE_LABELS: ReadonlyArray<readonly [needle: string, label: string]> = [
  ['energyingredient', 'Energy'],
  ['hybridfluid', 'Fluid'],
  ['particlestack', 'Particle'],
  ['gasstack', 'Gas'],
  ['dimensioningredient', 'Dimension'],
  ['aspectlist', 'Aspect'],
  ['meklaser', 'Laser energy'],
  ['mysticalmechanics', 'Mechanical power'],
  ['embers', 'Embers'],
  ['mana', 'Mana'],
  ['energy', 'Energy'],
];

function normalizedCustomType(type: string): string {
  return type.toLocaleLowerCase().replace(EXPORTER_HASH_SUFFIX, '');
}

export function stripMinecraftFormattingCodes(value: string): string {
  return value.replace(MINECRAFT_FORMATTING_CODE, '');
}

export interface CatalogNameNormalization {
  items: CatalogItem[];
  formattedNameCount: number;
  emptyNameFallbackCount: number;
}

/**
 * Normalize catalog labels once at ingestion so search, item lists, recipe
 * chips, graph nodes, totals, exports, and accessibility names all share the
 * same plain-text presentation.
 */
export function normalizeCatalogItemNames(
  items: readonly CatalogItem[],
): CatalogNameNormalization {
  let formattedNameCount = 0;
  let emptyNameFallbackCount = 0;
  const normalizedItems = items.map(item => {
    const strippedName = stripMinecraftFormattingCodes(item.n);
    if (strippedName === item.n) return item;
    formattedNameCount += 1;
    if (strippedName.trim().length === 0) {
      emptyNameFallbackCount += 1;
      return {...item, n: item.id};
    }
    return {...item, n: strippedName};
  });
  return {
    items: normalizedItems,
    formattedNameCount,
    emptyNameFallbackCount,
  };
}

/**
 * Synthetic JEI render models are useful inside recipe presentations but are not
 * independently obtainable inventory entries, so they do not belong in the item browser.
 */
export function isItemCatalogEligible(item: CatalogItem): boolean {
  const normalizedType = normalizedCustomType(item.t ?? '');
  const normalizedMod = item.m.toLocaleLowerCase();
  const normalizedId = item.id.toLocaleLowerCase();
  const isAppliedEnergisticsFacade =
    (normalizedMod === 'appliedenergistics2' ||
      normalizedMod === 'ae2' ||
      normalizedId.startsWith('appliedenergistics2:') ||
      normalizedId.startsWith('ae2:')) &&
    (normalizedId.endsWith(':facade') || normalizedId.includes(':facade_'));
  const isCoverCarrier = COVER_CARRIER_ITEM_IDS.has(normalizedId);
  const isSyntheticEnderIoEnergy =
    item.m === 'enderio' &&
    item.id === 'enderio:energy' &&
    normalizedType.includes(SYNTHETIC_ENDER_IO_ENERGY_TYPE);
  return (
    !normalizedType.includes(SYNTHETIC_MULTIBLOCK_TYPE) &&
    !isSyntheticEnderIoEnergy &&
    !isAppliedEnergisticsFacade &&
    !isCoverCarrier
  );
}

/**
 * Keep high-volume supporting ingredient types out of the default item grid.
 * They remain catalog-eligible so search, recipes, and direct item links can
 * still surface them normally.
 */
export function isItemCatalogBrowseVisible(item: CatalogItem): boolean {
  const typeLabel = catalogTypePresentation(item.t)?.label;
  const normalizedId = item.id.toLocaleLowerCase();
  const itemPath = normalizedId.slice(normalizedId.indexOf(':') + 1);
  const isEnchantedBook =
    itemPath === 'enchanted_book' ||
    itemPath.startsWith('enchanted_book:') ||
    itemPath.startsWith('enchanted_book[');

  return (
    typeLabel !== 'Fluid' &&
    typeLabel !== 'Enchantment' &&
    typeLabel !== 'Aspect' &&
    !isEnchantedBook
  );
}

export interface CatalogTypePresentation {
  label: string;
  recognized: boolean;
}

/** Converts exporter implementation types into short, user-facing ingredient categories. */
export function catalogTypePresentation(type?: string): CatalogTypePresentation | null {
  if (!type) return null;
  if (type === 'fluid') return {label: 'Fluid', recognized: true};
  if (type === 'enchant') return {label: 'Enchantment', recognized: true};

  const normalized = normalizedCustomType(type);
  if (normalized.startsWith(CUSTOM_TYPE_PREFIX)) {
    for (const [needle, label] of CUSTOM_TYPE_LABELS) {
      if (normalized.includes(needle)) return {label, recognized: true};
    }
    return {label: 'Custom ingredient', recognized: false};
  }

  return {label: type.replaceAll('_', ' '), recognized: false};
}
