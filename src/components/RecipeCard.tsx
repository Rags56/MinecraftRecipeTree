import {useRenderedScale} from '../ui/nativeUiScale';
import React from 'react';
import {Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {recipeImagePath, useData} from '../data/DataContext';
import {
  recipeHasStructurePreview,
  recipePresentationKind,
} from '../data/recipePresentation';
import {displayIngredientName} from '../data/ingredientTags';
import {
  formatIngredientQuantityPrefix,
  shouldShowIngredientQuantity,
} from '../data/ingredientQuantities';
import {recipeDisplayTitle} from '../data/recipeTitles';
import {projecteEmcTransmutation} from '../data/projecteEmc';
import {theme} from '../theme';
import {slotSummary} from '../data/slotSummary';
import {Recipe} from '../types';
import {useUi} from '../ui/UiContext';
import {signalTarget} from '../analytics/signal';
import {contentTextScale} from '../ui/contentZoom';
import {
  materialInputSummary,
  type GraphDirection,
} from '../graph/direction';
import {ItemIcon, pixelated} from './ItemIcon';
import {itemIconSizeForContentScale} from './itemIconSizing';
import {RecipePreviewImage} from './RecipePreviewImage';
import {
  RECIPE_CARD_BORDER_WIDTH,
  RECIPE_CARD_PADDING,
  responsiveRecipePreviewSize,
  nativeRecipePreviewSize,
} from './recipePreviewSizing';
import {MultiblockPreview} from './MultiblockPreview';

export function RecipeCard({
  recipe,
  dir,
  catTitle,
  onPress,
  graphDirection = 'inputs',
  actionSubject,
  usageOutputSubject,
  availableCardWidth,
  contentZoom = 1,
  grouped = false,
  machineKey,
  machineLabel,
  actionAccessibilityLabel,
  actionHint,
}: {
  recipe: Recipe;
  dir: string;
  catTitle?: string;
  onPress?: () => void;
  graphDirection?: GraphDirection;
  /** Item name anchoring the graph request, used by the visible action hint. */
  actionSubject?: string;
  /** Primary recipe product that will replace the usage anchor as the graph root. */
  usageOutputSubject?: string;
  /** Measured width of the full-width recipe-list container in CSS/layout pixels. */
  availableCardWidth: number;
  /** User-selected recipe and item scale within recipe surfaces. */
  contentZoom?: number;
  /** Render inside a category frame that supplies the outer border and corner radius. */
  grouped?: boolean;
  /** First JEI catalyst for the recipe category, used to open the machine's own recipes. */
  machineKey?: string;
  machineLabel?: string;
  /** Override the default graph action description when the card opens another recipe surface. */
  actionAccessibilityLabel?: string;
  /** Override the visible graph action hint when the card opens another recipe surface. */
  actionHint?: string;
}) {
  const data = useData();
  const {openItem} = useUi();
  const renderedScale = useRenderedScale();
  const presentation = recipePresentationKind(recipe);
  const emcTransmutation = projecteEmcTransmutation(recipe);
  if (presentation === 'failure') {
    return (
      <View style={styles.card}>
        <Text style={styles.errText}>recipe failed to export{recipe.id ? ` (${recipe.id})` : ''}</Text>
      </View>
    );
  }
  const previewSize = Platform.OS !== 'web' ? nativeRecipePreviewSize(recipe.w ?? 160, recipe.h ?? 60, data.manifest.settings.recipeScale, availableCardWidth, contentZoom, renderedScale) : responsiveRecipePreviewSize(
    recipe.w ?? 160,
    recipe.h ?? 60,
    data.manifest.settings.recipeScale,
    availableCardWidth,
    contentZoom,
  );
  const inputs = materialInputSummary(recipe);
  const outputs = slotSummary(recipe.out);
  const displayTitle = catTitle ? recipeDisplayTitle(catTitle, recipe) : undefined;
  return (
    <TouchableOpacity
      {...(onPress ? signalTarget(`recipe.open-graph.${graphDirection}`) : {})}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={
        onPress
          ? actionAccessibilityLabel ?? (graphDirection === 'outputs'
            ? `Make ${usageOutputSubject ?? 'the primary product'} the tree root using ${actionSubject ?? 'this item'} through ${displayTitle ?? 'this recipe'}`
            : `Start an ingredient tree for ${actionSubject ?? 'this item'} with ${displayTitle ?? 'this recipe'}`)
          : undefined
      }
      activeOpacity={onPress ? 0.72 : 1}
      disabled={!onPress && !machineKey}
      onPress={onPress}
      style={[
        styles.card,
        onPress && styles.cardAction,
        grouped && styles.cardGrouped,
      ]}>
      {displayTitle ? <Text style={styles.catTitle}>{displayTitle}</Text> : null}
      {recipe.stage ? (
        <View style={styles.recipeStageBadge}>
          <Text style={styles.recipeStageBadgeText}>Requires stage · {recipe.stage}</Text>
        </View>
      ) : null}
      {!recipe.structure && presentation === 'image' && recipe.img ? (
        <RecipeImageViewport>
        <RecipePreviewImage
          uri={data.imageUrl(recipeImagePath(dir, recipe.img))!}
          backgroundUri={
            recipe.bg ? data.imageUrl(recipeImagePath(dir, recipe.bg)) : undefined
          }
          context={recipe.id ?? `${catTitle ?? dir} recipe`}
          style={[
            {width: previewSize.width, height: previewSize.height},
            styles.recipeImage,
            pixelated as object,
          ]}
          resizeMode="contain"
        />
        </RecipeImageViewport>
      ) : !recipe.structure && !emcTransmutation ? (
        <Text style={styles.previewUnavailable}>
          Structured recipe · layout preview unavailable
        </Text>
      ) : null}
      {recipe.structure ? (
        <MultiblockPreview
          structure={recipe.structure}
          availableWidth={Math.max(
            180,
            (availableCardWidth - (RECIPE_CARD_BORDER_WIDTH + RECIPE_CARD_PADDING) * 2) *
              contentZoom,
          )}
          contentScale={contentZoom}
        />
      ) : null}
      {!recipeHasStructurePreview(recipe) && (inputs.length > 0 || outputs.length > 0) && (
        <View style={styles.recipeItems}>
          {inputs.map(item => (
            <ItemChip
              key={`input-${item.key}`}
              itemKey={item.key}
              amount={item.amount}
              variableAmount={item.variableAmount}
              variants={item.variants}
              tag={item.tag}
              probability={item.probability}
              probabilityRole="consume"
              contentScale={contentZoom}
              interactive={!onPress}
            />
          ))}
          <Text style={styles.recipeArrow}>→</Text>
          {outputs.map(item => (
            <ItemChip
              key={`output-${item.key}`}
              itemKey={item.key}
              amount={item.amount}
              variableAmount={item.variableAmount}
              variants={item.variants}
              tag={item.tag}
              probability={item.probability}
              probabilityRole="produce"
              contentScale={contentZoom}
              highlight
              interactive={!onPress}
            />
          ))}
        </View>
      )}
      {recipe.id ? (
        <Text style={styles.recipeId} numberOfLines={1}>
          {recipe.id}
        </Text>
      ) : null}
      {machineKey ? (
        <View style={styles.machineRow}>
          <View style={styles.machineCopy}>
            <Text style={styles.machineLabel}>CRAFTING MACHINE</Text>
            <Text style={styles.machineName} numberOfLines={1}>
              {machineLabel ?? data.itemsByKey.get(machineKey)?.n ?? machineKey}
            </Text>
          </View>
          <TouchableOpacity
            {...signalTarget('item-detail.machine.open')}
            accessibilityRole="button"
            accessibilityLabel={`View recipe for ${machineLabel ?? data.itemsByKey.get(machineKey)?.n ?? machineKey}`}
            style={styles.machineButton}
            onPress={event => {
              event.stopPropagation();
              openItem(machineKey);
            }}>
            <Text style={styles.machineButtonText}>View machine recipe</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {onPress ? (
        <Text style={styles.cardActionHint}>
          {actionHint ?? (graphDirection === 'outputs'
            ? `Tap to make ${usageOutputSubject ?? 'the primary product'} the new root`
            : 'Tap to add recipe to the graph')}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export function RecipeImageViewport({children}: {children: React.ReactNode}) {
  return Platform.OS === 'web' ? <>{children}</> : (
    <ScrollView horizontal style={{width: '100%', flexGrow: 0}} contentContainerStyle={{alignItems: 'flex-start'}}>
      {children}
    </ScrollView>
  );
}

export function ItemChip({
  itemKey,
  amount,
  variableAmount,
  variants,
  tag,
  probability,
  probabilityRole = 'produce',
  highlight,
  interactive = true,
  onPress,
  accessibilityLabel,
  contentScale = 1,
}: {
  itemKey: string;
  amount?: number | null;
  variableAmount?: boolean;
  variants?: number;
  tag?: string;
  /** Undefined is deterministic; null is an unresolved stochastic aggregate. */
  probability?: number | null;
  /** Whether the occurrence probability describes input consumption or output production. */
  probabilityRole?: 'consume' | 'produce';
  highlight?: boolean;
  interactive?: boolean;
  /** Overrides the normal item-detail action, for contextual ingredient selection. */
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Independent item/icon scale used by recipe and ingredient surfaces. */
  contentScale?: number;
}) {
  const data = useData();
  const {openItem} = useUi();
  const item = data.itemsByKey.get(itemKey);
  const name = item?.n ?? itemKey.split('|').pop() ?? itemKey;
  const displayName = displayIngredientName(
    name,
    tag,
    data.descriptor.minecraftVersion,
  );
  const renderedScale = useRenderedScale();
  const textScale = contentTextScale(contentScale) / renderedScale;
  const content = (
    <>
      <ItemIcon
        item={item}
        itemKey={itemKey}
        size={Platform.OS === 'web' ? itemIconSizeForContentScale(contentScale) : 16 * contentScale / renderedScale}
      />
      <Text
        style={[styles.chipText, {fontSize: Math.max(9, 11 * textScale)}]}
        numberOfLines={1}>
        {amount !== undefined && shouldShowIngredientQuantity(itemKey, amount)
          ? `${formatIngredientQuantityPrefix(itemKey, amount)} `
          : ''}
        {displayName}
        {!tag && variants != null && variants > 1
          ? ` (+${variants - 1} alternatives${variableAmount ? '; quantities vary' : ''})`
          : variableAmount
            ? ' (alternative quantities vary)'
            : ''}
        {probability === null
          ? ` · stochastic ${probabilityRole} chance unknown`
          : probability === undefined
            ? ''
            : ` · ${String(Math.round(probability * 10_000) / 100)}% ${probabilityRole} chance`}
      </Text>
    </>
  );
  if (!interactive) {
    return (
      <View
        style={[
          styles.chip,
          {
            gap: Math.max(4, 5 * contentScale),
            maxWidth: 240 * contentScale,
            paddingHorizontal: Math.max(5, 6 * contentScale),
            paddingVertical: Math.max(3, 3 * contentScale),
          },
          highlight && styles.chipHighlight,
        ]}>
        {content}
      </View>
    );
  }
  return (
    <TouchableOpacity
      {...signalTarget(onPress ? 'graph.source-picker.alternative.open' : 'item-detail.item.open')}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Open ${displayName}`}
      style={[
        styles.chip,
        {
          gap: Math.max(4, 5 * contentScale),
          maxWidth: 240 * contentScale,
          paddingHorizontal: Math.max(5, 6 * contentScale),
          paddingVertical: Math.max(3, 3 * contentScale),
        },
        highlight && styles.chipHighlight,
      ]}
      onPress={event => {
        event.stopPropagation();
        if (onPress) onPress();
        else openItem(itemKey);
      }}>
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.panelAlt,
    borderColor: theme.border,
    borderWidth: RECIPE_CARD_BORDER_WIDTH,
    borderRadius: 10,
    padding: RECIPE_CARD_PADDING,
    marginBottom: 10,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  cardAction: {borderColor: theme.borderLight},
  cardGrouped: {
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    marginBottom: 0,
  },
  cardActionHint: {
    color: theme.accent,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 8,
  },
  catTitle: {color: theme.textDim, fontSize: 11, marginBottom: 6},
  recipeStageBadge: {
    alignSelf: 'flex-start',
    borderColor: theme.accent,
    borderWidth: 1,
    borderRadius: 6,
    backgroundColor: '#1c2b22',
    paddingHorizontal: 7,
    paddingVertical: 4,
    marginBottom: 7,
  },
  recipeStageBadgeText: {color: theme.accent, fontSize: 9, fontWeight: '700'},
  recipeImage: {borderRadius: 4},
  previewUnavailable: {
    color: theme.textDim,
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  recipeItems: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  recipeArrow: {color: theme.textDim, fontSize: 14},
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.panel,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 5,
    maxWidth: 240,
  },
  chipHighlight: {borderColor: theme.accent},
  chipText: {color: theme.text, fontSize: 11},
  errText: {color: theme.danger, fontSize: 12},
  recipeId: {color: theme.textDim, fontSize: 10, marginTop: 6},
  machineRow: {
    marginTop: 9,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  machineCopy: {flex: 1, minWidth: 0},
  machineLabel: {color: theme.textDim, fontSize: 8, fontWeight: '800'},
  machineName: {color: theme.text, fontSize: 10, fontWeight: '700', marginTop: 2},
  machineButton: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  machineButtonText: {color: theme.accent, fontSize: 9, fontWeight: '800'},
});
