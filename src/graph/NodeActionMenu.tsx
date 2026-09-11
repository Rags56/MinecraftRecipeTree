import React, {useEffect, useState} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {signalTarget} from '../analytics/signal';
import {ItemIcon} from '../components/ItemIcon';
import {useData} from '../data/DataContext';
import type {ItemTreeNode} from './model';
import type {NodeContextMenuPlacement} from './nodeContextMenu';
import {theme} from '../theme';

/**
 * The menu a node opens on a long press or a right click. It lives here rather than inside
 * GraphScreen because the resources list opens the same menu on its rows: one menu means one set of
 * gestures, one look, and one place an action is written -- the list passes the handlers that mean
 * something against a row and leaves the canvas ones out.
 */
export function NodeActionMenu({
  node,
  interfaceZoom,
  placement,
  canSetRecipe,
  hasRememberedSource,
  amount,
  onClose,
  onSelectAlternative,
  onSetOrChangeRecipe,
  onAddUsedBy,
  onAmountChange,
  onUnsetRecipe,
  onCollapseRecipe,
  onToggleRootControls,
  rootControlsShown,
  onFocusBranch,
  isFocused,
  treatAsTool,
}: {
  node: ItemTreeNode;
  interfaceZoom: number;
  placement: NodeContextMenuPlacement;
  canSetRecipe: boolean;
  hasRememberedSource?: boolean;
  amount?: number;
  onClose: () => void;
  onSelectAlternative: (selectedKey: string) => void;
  onSetOrChangeRecipe: () => void;
  onAddUsedBy?: () => void;
  onAmountChange?: (amount: number) => void;
  /**
   * Left out where the menu is opened away from the canvas: the resources list offers the actions
   * that mean something against a row, and the graph offers everything it can do to a node.
   */
  onUnsetRecipe?: () => void;
  onCollapseRecipe?: () => void;
  /** Root only: the amount stepper and pickers attached to the node itself. */
  onToggleRootControls?: () => void;
  rootControlsShown?: boolean;
  onFocusBranch?: () => void;
  /** Focusing the node that is already focused is how the user gets the whole tree back. */
  isFocused?: boolean;
  /** Which of the two resource lists the item belongs on, in the user's own words. */
  treatAsTool?: {isTool: boolean; onPress: () => void};
}) {
  const data = useData();
  const alternatives = Array.from(
    new Map(
      (node.alternatives ?? []).map(itemKey => {
        const item = data.itemsByKey.get(itemKey);
        const identity = item
          ? `${item.t ?? 'item'}\u0000${item.id}\u0000${item.n}`
          : itemKey;
        return [identity, itemKey] as const;
      }),
    ).values(),
  );
  const itemName = data.itemsByKey.get(node.key)?.n ?? node.key;
  const hasSelectedRecipe = !!node.source || !!node.deferredRecipeExpansion;
  const isRoot = node.id === 'root';
  const stateLabel = node.deferredRecipeExpansion
    ? 'Recipe expanded elsewhere'
    : node.source
      ? 'Recipe expanded'
      : canSetRecipe
        ? 'No recipe selected'
        : 'No recipe available';
  const menuScaleStyle =
    Platform.OS === 'web' ? ({zoom: interfaceZoom} as unknown as object) : null;
  return (
    <View style={styles.nodeActionLayer} pointerEvents="box-none">
      <Pressable
        style={styles.nodeActionDismiss}
        accessibilityLabel="Close node menu"
        onPress={onClose}
      />
      <View
        pointerEvents="box-none"
        style={[
          styles.nodeActionAnchor,
          {left: placement.left, top: placement.top},
        ]}>
        <Pressable
          accessibilityRole="menu"
          accessibilityLabel={`${data.itemsByKey.get(node.key)?.n ?? node.key} node menu`}
          style={[
            styles.nodeActionCard,
            {width: placement.width, maxHeight: placement.maxHeight},
            menuScaleStyle,
          ]}
          onPointerDown={event => event.stopPropagation()}
          onTouchStart={event => event.stopPropagation()}
          onPress={event => event.stopPropagation()}>
          <View style={styles.nodeActionHeader}>
            <ItemIcon itemKey={node.key} size={32} />
            <View style={styles.nodeActionHeaderCopy}>
              <Text style={styles.nodeActionTitle} numberOfLines={1}>
                {data.itemsByKey.get(node.key)?.n ?? node.key}
              </Text>
              <Text style={styles.nodeActionHint}>
                {isRoot ? `Starting node · ${stateLabel}` : stateLabel}
              </Text>
            </View>
          </View>
          {amount !== undefined && onAmountChange && (
            <ContextAmountStepper amount={amount} onAmountChange={onAmountChange} />
          )}
          {alternatives.length > 1 && (
            <View style={styles.nodeAlternativeSection}>
              <Text style={styles.nodeActionSectionLabel}>
                {node.tag ? `#${node.tag}` : 'Ingredient alternatives'}
              </Text>
              <ScrollView style={styles.nodeAlternativeScroll}>
                {alternatives.map(itemKey => (
                  <TouchableOpacity
                    key={itemKey}
                    accessibilityRole="button"
                    accessibilityState={{selected: itemKey === node.key}}
                    style={[
                      styles.nodeAlternativeRow,
                      itemKey === node.key && styles.nodeAlternativeRowSelected,
                    ]}
                    onPress={() => onSelectAlternative(itemKey)}>
                    <ItemIcon itemKey={itemKey} size={32} />
                    <Text style={styles.nodeAlternativeName} numberOfLines={2}>
                      {data.itemsByKey.get(itemKey)?.n ?? itemKey}
                    </Text>
                    {itemKey === node.key && (
                      <Text style={styles.nodeAlternativeSelected}>✓</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          <View style={styles.nodeActionButtons}>
            {canSetRecipe && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.set-recipe')}
                accessibilityRole="button"
                style={[styles.nodeActionButton, styles.nodeActionButtonPrimary]}
                onPress={onSetOrChangeRecipe}>
                <Text style={styles.nodeActionButtonPrimaryText}>
                  {hasSelectedRecipe ? 'Change recipe' : 'Set recipe'}
                </Text>
                <Text style={styles.nodeActionButtonPrimaryHint}>
                  {hasSelectedRecipe ? 'Choose a different source' : 'Choose how to make this item'}
                </Text>
              </TouchableOpacity>
            )}
            {onAddUsedBy && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.add-used-by')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onAddUsedBy}>
                <Text style={styles.nodeActionButtonText}>Add used by</Text>
                <Text style={styles.nodeActionButtonHint}>Add a recipe that consumes the starting item</Text>
              </TouchableOpacity>
            )}
            {treatAsTool && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.treat-as-tool')}
                accessibilityRole="button"
                accessibilityLabel={
                  treatAsTool.isTool
                    ? `Treat ${itemName} as a resource`
                    : `Treat ${itemName} as a tool or catalyst`
                }
                style={styles.nodeActionButton}
                onPress={treatAsTool.onPress}>
                <Text style={styles.nodeActionButtonText}>
                  {treatAsTool.isTool ? 'Treat as resource' : 'Treat as tool/catalyst'}
                </Text>
                <Text style={styles.nodeActionButtonHint}>
                  {treatAsTool.isTool
                    ? 'Consumed by the recipe, and counted with the materials'
                    : 'Kept by the recipe, and counted on the tools list of its own'}
                </Text>
              </TouchableOpacity>
            )}
            {onToggleRootControls && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.root-controls')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onToggleRootControls}>
                <Text style={styles.nodeActionButtonText}>
                  {rootControlsShown ? 'Hide root controls' : 'Show root controls'}
                </Text>
                <Text style={styles.nodeActionButtonHint}>
                  The amount and recipe controls attached to the root node
                </Text>
              </TouchableOpacity>
            )}
            {onFocusBranch && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.focus-branch')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onFocusBranch}>
                <Text style={styles.nodeActionButtonText}>
                  {isFocused ? 'Show whole tree' : 'Focus this branch'}
                </Text>
                <Text style={styles.nodeActionButtonHint}>
                  {isFocused
                    ? 'Bring back the branches hidden by this focus'
                    : 'Hide every branch except this one and what it needs'}
                </Text>
              </TouchableOpacity>
            )}
            {hasSelectedRecipe && onCollapseRecipe && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.collapse-recipe')}
                accessibilityRole="button"
                style={styles.nodeActionButton}
                onPress={onCollapseRecipe}>
                <Text style={styles.nodeActionButtonText}>Collapse recipe</Text>
                <Text style={styles.nodeActionButtonHint}>Keep the remembered source</Text>
              </TouchableOpacity>
            )}
            {(hasSelectedRecipe || hasRememberedSource) && onUnsetRecipe && (
              <TouchableOpacity
                {...signalTarget('graph.node-menu.unset-recipe')}
                accessibilityRole="button"
                style={[styles.nodeActionButton, styles.nodeActionButtonDanger]}
                onPress={onUnsetRecipe}>
                <Text style={styles.nodeActionButtonDangerText}>Unset recipe</Text>
                <Text style={styles.nodeActionButtonHint}>Clear this node and its remembered source</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  );
}

function ContextAmountStepper({
  amount,
  onAmountChange,
}: {
  amount: number;
  onAmountChange: (amount: number) => void;
}) {
  const [amountText, setAmountText] = useState(String(amount));
  useEffect(() => setAmountText(String(amount)), [amount]);
  const updateAmountText = (value: string) => {
    setAmountText(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1) onAmountChange(parsed);
  };
  return (
    <View style={styles.nodeActionAmountSection}>
      <Text style={styles.nodeActionSectionLabel}>Requested amount</Text>
      <View style={styles.nodeActionAmountStepper}>
        <TouchableOpacity
          {...signalTarget('graph.node-menu.amount.decrease')}
          accessibilityRole="button"
          accessibilityLabel="Decrease requested amount"
          style={styles.nodeActionAmountButton}
          onPress={() => onAmountChange(amount - 1)}>
          <Text style={styles.nodeActionAmountButtonText}>−</Text>
        </TouchableOpacity>
        <TextInput
          accessibilityLabel="Amount requested"
          style={styles.nodeActionAmountInput}
          value={amountText}
          onChangeText={updateAmountText}
          onBlur={() => setAmountText(String(amount))}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
        />
        <TouchableOpacity
          {...signalTarget('graph.node-menu.amount.increase')}
          accessibilityRole="button"
          accessibilityLabel="Increase requested amount"
          style={[styles.nodeActionAmountButton, styles.nodeActionAmountButtonPrimary]}
          onPress={() => onAmountChange(amount + 1)}>
          <Text
            style={[
              styles.nodeActionAmountButtonText,
              styles.nodeActionAmountButtonPrimaryText,
            ]}>
            +
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nodeActionAmountButton: {
    width: 38,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.panelAlt,
  },
  nodeActionAmountButtonPrimary: {
    borderColor: theme.accent,
    backgroundColor: theme.accent,
  },
  nodeActionAmountButtonPrimaryText: {color: '#0b1610'},
  nodeActionAmountButtonText: {color: theme.text, fontSize: 18, fontWeight: '800'},
  nodeActionAmountInput: {
    flex: 1,
    height: 34,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    backgroundColor: '#0f141b',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  nodeActionAmountSection: {gap: 6},
  nodeActionAmountStepper: {flexDirection: 'row', alignItems: 'center'},
  nodeActionAnchor: {position: 'absolute', zIndex: 91},
  nodeActionButton: {
    minHeight: 44,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    backgroundColor: theme.panelAlt,
  },
  nodeActionButtonDanger: {borderColor: theme.warn},
  nodeActionButtonDangerText: {color: theme.warn, fontSize: 13, fontWeight: '700'},
  nodeActionButtonHint: {color: theme.textDim, fontSize: 10, marginTop: 2},
  nodeActionButtonPrimary: {borderColor: theme.accent, backgroundColor: '#173724'},
  nodeActionButtonPrimaryHint: {color: theme.text, fontSize: 10, marginTop: 2},
  nodeActionButtonPrimaryText: {color: theme.accent, fontSize: 13, fontWeight: '800'},
  nodeActionButtonText: {color: theme.text, fontSize: 13, fontWeight: '700'},
  nodeActionButtons: {gap: 5},
  nodeActionCard: {
    padding: 10,
    gap: 9,
    borderWidth: 1,
    borderColor: theme.borderLight,
    borderRadius: 9,
    backgroundColor: theme.panel,
    shadowColor: '#000',
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: {width: 0, height: 8},
    elevation: 20,
    overflow: 'hidden',
  },
  nodeActionDismiss: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  nodeActionHeader: {flexDirection: 'row', alignItems: 'center', gap: 10},
  nodeActionHeaderCopy: {flex: 1},
  nodeActionHint: {color: theme.textDim, fontSize: 11, marginTop: 2},
  nodeActionLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 90,
  },
  nodeActionSectionLabel: {
    color: theme.accent,
    fontSize: 11,
    fontWeight: '700',
  },
  nodeActionTitle: {color: theme.text, fontSize: 14, fontWeight: '700'},
  nodeAlternativeName: {flex: 1, color: theme.text, fontSize: 13},
  nodeAlternativeRow: {
    minHeight: 46,
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 8,
  },
  nodeAlternativeRowSelected: {backgroundColor: theme.panelAlt},
  nodeAlternativeScroll: {maxHeight: 220},
  nodeAlternativeSection: {gap: 7, minHeight: 0, flexShrink: 1},
  nodeAlternativeSelected: {color: theme.accent, fontSize: 16, fontWeight: '800'},
});
