import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useData} from '../data/DataContext';
import {theme} from '../theme';
import type {Recipe} from '../types';
import {MAXIMUM_CONTENT_ZOOM, MINIMUM_CONTENT_ZOOM, stepContentZoom} from '../ui/contentZoom';
import {MAXIMUM_INTERFACE_ZOOM, MINIMUM_INTERFACE_ZOOM} from '../ui/interfaceZoom';
import {useRenderedScale} from '../ui/nativeUiScale';
import {ItemGridCell} from './ItemsScreen';
import {RecipeCard} from './RecipeCard';

export function ScaleSettings({interfaceZoom, contentZoom, onInterfaceZoomChange, onContentZoomChange, onContentZoomComplete}: {
  interfaceZoom: number; contentZoom: number;
  onInterfaceZoomChange(direction: -1 | 1): void;
  onContentZoomChange(value: number): void;
  onContentZoomComplete(value: number): void;
}) {
  const data = useData();
  const renderedScale = useRenderedScale();
  const [width, setWidth] = useState(0);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const categoryIndex = data.categories.findIndex(category => category.count > 0 && /crafting/i.test(category.id + category.title));
  const category = data.categories[categoryIndex];
  const items = useMemo(() => {
    const result = [];
    const wanted = new Set(['minecraft:stone', 'minecraft:dirt', 'minecraft:crafting_table', 'minecraft:furnace']);
    for (const item of data.items) {
      if (wanted.has(item.id) && item.icon && (!item.t || item.t === 'item')) {
        result.push(item);
        wanted.delete(item.id);
      }
      if (result.length === 4) break;
    }
    return result;
  }, [data.items]);
  useEffect(() => {
    if (categoryIndex < 0) return;
    let cancelled = false;
    setRecipe(null); setError(null);
    void data.getRecipes([[categoryIndex, 0]]).then(recipes => {
      if (!recipes[0]) throw new Error('The example recipe is missing from this pack.');
      if (!cancelled) setRecipe(recipes[0]);
    }).catch(cause => {
      console.error('Settings recipe preview could not be loaded.', cause);
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Recipe preview unavailable.');
    });
    return () => {cancelled = true;};
  }, [categoryIndex, data.getRecipes, attempt]);
  const stepContent = (direction: -1 | 1) => {
    const next = stepContentZoom(contentZoom, direction);
    if (next === contentZoom) return;
    onContentZoomChange(next);
    onContentZoomComplete(next);
  };
  const columns = Math.max(1, Math.min(4, Math.floor((width - 24) * renderedScale / (104 * contentZoom))));

  return (
    <View style={s.section}>
      <Text style={s.heading} accessibilityRole="header">Display</Text>
      <View style={s.card}>
        <View style={s.row}>
          <View style={s.grow}><Text style={s.label}>UI scale</Text><Text style={s.detail}>Menus, text and controls</Text></View>
          <View style={s.stepper}>
            <TouchableOpacity style={s.step} accessibilityRole="button" accessibilityLabel="Decrease interface zoom" disabled={interfaceZoom <= MINIMUM_INTERFACE_ZOOM} onPress={() => onInterfaceZoomChange(-1)}>
              <Text style={[s.stepText, interfaceZoom <= MINIMUM_INTERFACE_ZOOM && s.disabled]}>−</Text>
            </TouchableOpacity>
            <Text style={s.value} accessibilityLabel={`Interface zoom ${Math.round(interfaceZoom * 100)} percent`}>{Math.round(interfaceZoom * 100)}%</Text>
            <TouchableOpacity style={s.step} accessibilityRole="button" accessibilityLabel="Increase interface zoom" disabled={interfaceZoom >= MAXIMUM_INTERFACE_ZOOM} onPress={() => onInterfaceZoomChange(1)}>
              <Text style={[s.stepText, interfaceZoom >= MAXIMUM_INTERFACE_ZOOM && s.disabled]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={s.row}>
          <View style={s.grow}><Text style={s.label}>Recipe/items scale</Text><Text style={s.detail}>Recipe cards and item icons</Text></View>
          <View style={s.stepper}>
            <TouchableOpacity style={s.step} accessibilityRole="button" accessibilityLabel="Decrease recipe and item size" disabled={contentZoom <= MINIMUM_CONTENT_ZOOM} onPress={() => stepContent(-1)}>
              <Text style={[s.stepText, contentZoom <= MINIMUM_CONTENT_ZOOM && s.disabled]}>−</Text>
            </TouchableOpacity>
            <Text style={s.value} accessibilityLabel={`Recipe and item size ${Math.round(contentZoom * 100)} percent`}>{Math.round(contentZoom * 100)}%</Text>
            <TouchableOpacity style={s.step} accessibilityRole="button" accessibilityLabel="Increase recipe and item size" disabled={contentZoom >= MAXIMUM_CONTENT_ZOOM} onPress={() => stepContent(1)}>
              <Text style={[s.stepText, contentZoom >= MAXIMUM_CONTENT_ZOOM && s.disabled]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <View style={s.preview} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
        <Text style={s.previewTitle}>Live preview</Text>
        <Text style={s.detail}>Same items and recipes as the viewer. Scroll larger previews to inspect them.</Text>
        <ScrollView nestedScrollEnabled style={{maxHeight: 210 / renderedScale}}>
          <View style={s.itemGrid}>
            {items.map(item => <ItemGridCell key={item.k} item={item} zoom={contentZoom} width={`${100 / columns}%`} />)}
          </View>
        </ScrollView>
        {items.length === 0 && <Text style={s.detail}>This pack has no Minecraft items to preview.</Text>}
        {width > 0 && recipe && category && <ScrollView nestedScrollEnabled style={{maxHeight: 240 / renderedScale}}>
          <RecipeCard recipe={recipe} dir={category.dir} catTitle={category.title} contentZoom={contentZoom} availableCardWidth={width - 24} />
        </ScrollView>}
        {!recipe && !error && category && <ActivityIndicator color={theme.accent} />}
        {!category && <Text style={s.detail}>This pack has no crafting recipe to preview.</Text>}
        {error && <View><Text style={s.error} accessibilityRole="alert">{error}</Text><TouchableOpacity style={s.step} onPress={() => setAttempt(value => value + 1)} accessibilityRole="button" accessibilityLabel="Retry recipe preview"><Text style={s.label}>Retry</Text></TouchableOpacity></View>}
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  section: {gap: 14},
  heading: {color: theme.text, fontSize: 17, fontWeight: '700', marginTop: 6},
  card: {borderWidth: 1, borderColor: theme.border, backgroundColor: theme.panel, borderRadius: 14, padding: 12, gap: 12},
  row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8},
  grow: {flexGrow: 1, gap: 4},
  label: {color: theme.text, fontSize: 14, fontWeight: '700'},
  detail: {color: theme.textDim, fontSize: 12, lineHeight: 17},
  stepper: {flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.borderLight, borderRadius: 8},
  step: {minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center'},
  stepText: {color: theme.accent, fontSize: 22, fontWeight: '700'},
  value: {color: theme.text, minWidth: 44, textAlign: 'center', fontSize: 13, fontWeight: '700'},
  disabled: {opacity: 0.3},
  preview: {borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 12, gap: 10, backgroundColor: theme.panel},
  previewTitle: {color: theme.text, fontWeight: '700', fontSize: 14},
  itemGrid: {flexDirection: 'row', flexWrap: 'wrap'},
  error: {color: theme.danger, fontSize: 12},
});
