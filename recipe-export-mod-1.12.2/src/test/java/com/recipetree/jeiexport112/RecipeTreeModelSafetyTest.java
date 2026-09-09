package com.recipetree.jeiexport112;

import mezz.jei.api.IJeiRuntime;
import mezz.jei.api.IRecipeRegistry;
import mezz.jei.api.ingredients.IIngredientRegistry;
import org.junit.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import java.nio.file.Paths;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public class RecipeTreeModelSafetyTest {
    @Test
    public void comparisonUsesAllThreeSidebarSummaryQuantities() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:root", 1);
        RecipeTreeViewerBridge.Ingredient input = ingredient("item|example:input", 3);
        RecipeTreeViewerBridge.Ingredient extra = ingredient("item|example:extra", 2);
        RecipeTreeModel model = model(root, 1);
        assertTrue(model.setRecipe(model.getPrimaryRoot(), recipe("comparison",
                Collections.singletonList(slot(input)), Arrays.asList(slot(root), slot(extra))), false));
        RecipeTreeModel.Summary a = model.summarize(false);
        model.setPrimaryAmount(4);
        RecipeTreeModel.Summary b = model.summarize(false);
        assertAmount("3", RecipeTreeComparison.differences(
                RecipeTreeComparison.types(a), RecipeTreeComparison.types(b)).get(0).change);
        assertAmount("9", RecipeTreeComparison.differences(
                RecipeTreeComparison.items(a.materials), RecipeTreeComparison.items(b.materials)).get(0).change);
        assertAmount("6", RecipeTreeComparison.differences(
                RecipeTreeComparison.items(a.byproducts), RecipeTreeComparison.items(b.byproducts)).get(0).change);
    }

    @Test(expected = IllegalStateException.class)
    @SuppressWarnings("unchecked")
    public void comparisonRejectsMissingSavedNodesInsteadOfShowingPartialTotals() throws Exception {
        RecipeTreeViewerBridge bridge = bridge();
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:root", 1);
        java.lang.reflect.Field field = RecipeTreeViewerBridge.class.getDeclaredField("ingredientsByKey");
        field.setAccessible(true);
        ((java.util.Map<String, RecipeTreeViewerBridge.Ingredient>) field.get(bridge)).put(root.getKey(), root);
        RecipeTreeProgress.RecipeHistoryEntry entry = new RecipeTreeProgress.RecipeHistoryEntry(
                root.getKey(), null, 1, false, 1, null,
                Collections.singletonList(new RecipeTreeProgress.RecipeHistorySelection(
                        0, Collections.singletonList(0), "missing-child", "Missing child", null, null)), false);
        RecipeTreeModel.restoreForComparison(bridge, entry);
    }

    @Test
    public void aspectSourceYieldDividesDemandInsteadOfMultiplyingIt() throws Exception {
        RecipeTreeViewerBridge.Ingredient source = ingredient("item|example:opal_block", 27);
        RecipeTreeViewerBridge.Ingredient aspect = ingredient("aspect|luna", 1);
        RecipeTreeViewerBridge.Recipe page = RecipeTreeViewerBridge.Recipe.aspectSourcePage(
                "aspect-page", RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_CATEGORY_UID,
                "Aspect from ItemStack", null, Collections.singletonList(slot(source)),
                Collections.singletonList(slot(aspect)), 220, 140, null, null, null,
                Collections.singletonList(source),
                Collections.<String, List<RecipeTreeViewerBridge.Ingredient>>emptyMap());
        RecipeTreeViewerBridge.Recipe selected = page.selectAspectSource(source);
        RecipeTreeViewerBridge.Ingredient masterSpell = ingredient("item|example:master_spell", 1);
        RecipeTreeModel model = model(masterSpell, 1);
        assertTrue(model.setRecipe(
                model.getPrimaryRoot(),
                recipe("master-spell", Collections.singletonList(slot(
                                ingredient("aspect|luna", 4096))),
                        Collections.singletonList(slot(masterSpell))),
                false));
        RecipeTreeModel.Node aspectNode = model.getPrimaryRoot().getChildren().get(0);

        assertTrue(model.setRecipe(aspectNode, selected, false));

        assertAmount("4096", aspectNode.getDemand());
        assertAmount("27", aspectNode.getOutputPerCraft());
        assertAmount("152", aspectNode.crafts());
        assertEquals(1, aspectNode.getChildren().size());
        assertAmount("152", aspectNode.getChildren().get(0).getDemand());
    }

    @Test
    public void clearingAnIngredientClearsEveryMatchingNodeAndItsFavorite() throws Exception {
        RecipeTreeViewerBridge.Ingredient item = ingredient("item|example:shared", 1);
        RecipeTreeViewerBridge.Ingredient firstInput = ingredient("item|example:first", 2);
        RecipeTreeViewerBridge.Ingredient secondInput = ingredient("item|example:second", 3);
        RecipeTreeViewerBridge.Ingredient unrelated = ingredient("item|example:unrelated", 1);
        RecipeTreeViewerBridge.Ingredient unrelatedInput = ingredient("item|example:kept", 4);
        RecipeTreeViewerBridge.Recipe firstRecipe = recipe(
                "first-recipe",
                Collections.singletonList(slot(firstInput)),
                Collections.singletonList(slot(item)));
        RecipeTreeViewerBridge.Recipe secondRecipe = recipe(
                "second-recipe",
                Collections.singletonList(slot(secondInput)),
                Collections.singletonList(slot(item)));
        RecipeTreeViewerBridge.Recipe unrelatedRecipe = recipe(
                "unrelated-recipe",
                Collections.singletonList(slot(unrelatedInput)),
                Collections.singletonList(slot(unrelated)));
        RecipeTreeProgress progress = progress();
        RecipeTreeModel model = new RecipeTreeModel(bridge(), progress, item, 1);
        assertTrue(model.addRoot(item, 1));
        assertTrue(model.addRoot(unrelated, 1));
        RecipeTreeModel.Node cleared = model.getRoots().get(0);
        RecipeTreeModel.Node alsoCleared = model.getRoots().get(1);
        RecipeTreeModel.Node untouched = model.getRoots().get(2);
        assertTrue(model.setRecipe(cleared, firstRecipe, false));
        assertTrue(model.setRecipe(alsoCleared, secondRecipe, false));
        assertTrue(model.setRecipe(untouched, unrelatedRecipe, false));
        progress.saveFavoriteRecipe(item.getKey(), firstRecipe.getKey());

        model.clearRecipesForIngredient(cleared, true);

        assertNull(cleared.getRecipe());
        assertTrue(cleared.getChildren().isEmpty());
        assertNull(alsoCleared.getRecipe());
        assertTrue(alsoCleared.getChildren().isEmpty());
        assertSame(unrelatedRecipe, untouched.getRecipe());
        assertEquals(1, untouched.getChildren().size());
        assertEquals(unrelatedInput.getKey(),
                untouched.getChildren().get(0).getIngredient().getKey());
        assertNull(progress.favoriteRecipe(item.getKey()));
    }

    @Test
    public void largeTreeSummaryIsReusedUntilTheModelChanges() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:summary_root", 1);
        RecipeTreeViewerBridge.Ingredient input = ingredient("item|example:summary_input", 2);
        RecipeTreeModel model = model(root, 1);
        assertTrue(model.setRecipe(
                model.getPrimaryRoot(),
                recipe("summary-recipe", Collections.singletonList(slot(input)),
                        Collections.singletonList(slot(root))),
                false));

        RecipeTreeModel.Summary first = model.summarize(true);
        assertSame(first, model.summarize(true));
        assertNotSame(first, model.summarize(false));

        model.setPrimaryAmount(4);
        RecipeTreeModel.Summary updated = model.summarize(true);
        assertNotSame(first, updated);
        assertSame(updated, model.summarize(true));
        assertAmount("8", updated.materials.get(0).remaining);
    }

    @Test
    public void outputAlternativesAreNotSummedOrDuplicatedAsByproducts() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:root", 1);
        RecipeTreeViewerBridge.Ingredient rootAlternativeAmount =
                ingredient("item|example:root", 4);
        RecipeTreeViewerBridge.Ingredient secondRootOutput =
                ingredient("item|example:root", 2);
        RecipeTreeViewerBridge.Ingredient byproductA =
                ingredient("item|example:byproduct_a", 5);
        RecipeTreeViewerBridge.Ingredient byproductB =
                ingredient("item|example:byproduct_b", 7);
        RecipeTreeViewerBridge.Recipe recipe = recipe(
                "alternative-outputs",
                Collections.<RecipeTreeViewerBridge.Slot>emptyList(),
                Arrays.asList(
                        slot(root, rootAlternativeAmount),
                        slot(secondRootOutput),
                        slot(byproductA, byproductB)));

        RecipeTreeModel model = model(root, 3);
        assertTrue(model.setRecipe(model.getPrimaryRoot(), recipe, false));
        assertAmount("3", model.getPrimaryRoot().getOutputPerCraft());

        RecipeTreeModel.Summary summary = model.summarize(false);
        assertTrue(summary.materials.isEmpty());
        assertEquals(1, summary.byproducts.size());
        assertEquals(byproductA.getKey(), summary.byproducts.get(0).ingredient.getKey());
        assertAmount("5", summary.byproducts.get(0).remaining);
    }

    @Test
    public void childLimitRetainsEveryOmittedInputAsMaterialDemand() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:root", 1);
        List<RecipeTreeViewerBridge.Slot> inputs = new ArrayList<RecipeTreeViewerBridge.Slot>();
        for (int index = 0; index < 40; index++) {
            inputs.add(slot(ingredient("item|example:input_" + index, 1)));
        }

        RecipeTreeModel model = model(root, 1);
        assertTrue(model.setRecipe(
                model.getPrimaryRoot(),
                recipe("too-many-children", inputs, Collections.singletonList(slot(root))),
                false));

        RecipeTreeModel.Node rootNode = model.getPrimaryRoot();
        assertEquals(RecipeTreeModel.MAX_CHILDREN, rootNode.getChildren().size());
        assertEquals(8, rootNode.getTruncatedDemands().size());
        for (RecipeTreeModel.TruncatedDemand truncated : rootNode.getTruncatedDemands()) {
            assertEquals(RecipeTreeModel.TruncationReason.CHILD_LIMIT, truncated.getReason());
            assertAmount("1", truncated.getQuantityPerCraft());
        }
        RecipeTreeModel.Summary summary = model.summarize(false);
        assertEquals(40, summary.materials.size());
        for (RecipeTreeModel.SummaryEntry entry : summary.materials) {
            assertAmount("1", entry.remaining);
        }
    }

    @Test
    public void depthLimitRetainsTheNextIngredientAsMaterialDemand() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:depth_0", 1);
        RecipeTreeModel model = model(root, 1);
        RecipeTreeModel.Node cursor = model.getPrimaryRoot();

        for (int depth = 0; depth < RecipeTreeModel.MAX_DEPTH; depth++) {
            RecipeTreeViewerBridge.Ingredient next =
                    ingredient("item|example:depth_" + (depth + 1), 1);
            assertTrue(model.setRecipe(
                    cursor,
                    recipe("depth-recipe-" + depth,
                            Collections.singletonList(slot(next)),
                            Collections.singletonList(slot(cursor.getIngredient()))),
                    false));
            assertEquals(1, cursor.getChildren().size());
            cursor = cursor.getChildren().get(0);
        }

        assertEquals(RecipeTreeModel.MAX_DEPTH, model.depth(cursor));
        RecipeTreeViewerBridge.Ingredient terminal =
                ingredient("fluid|example:depth_terminal", 250);
        assertTrue(model.setRecipe(
                cursor,
                recipe("depth-terminal-recipe",
                        Collections.singletonList(slot(terminal)),
                        Collections.singletonList(slot(cursor.getIngredient()))),
                false));
        assertTrue(cursor.getChildren().isEmpty());
        assertEquals(1, cursor.getTruncatedDemands().size());
        assertEquals(RecipeTreeModel.TruncationReason.DEPTH_LIMIT,
                cursor.getTruncatedDemands().get(0).getReason());

        RecipeTreeModel.SummaryEntry terminalSummary =
                summaryByKey(model.summarize(false).materials, terminal.getKey());
        assertNotNull(terminalSummary);
        assertAmount("250", terminalSummary.remaining);
    }

    @Test
    public void globalNodeLimitStopsAt2048AndAccountsForTheRemainder() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:global_root", 1);
        RecipeTreeModel model = model(root, 1);
        Deque<RecipeTreeModel.Node> queue = new ArrayDeque<RecipeTreeModel.Node>();
        queue.add(model.getPrimaryRoot());
        int nextIngredient = 0;
        RecipeTreeModel.Node truncatedAt = null;

        while (countNodes(model.getRoots()) < RecipeTreeModel.MAX_NODES) {
            RecipeTreeModel.Node node = queue.removeFirst();
            List<RecipeTreeViewerBridge.Slot> inputs =
                    new ArrayList<RecipeTreeViewerBridge.Slot>();
            for (int index = 0; index < RecipeTreeModel.MAX_CHILDREN; index++) {
                inputs.add(slot(ingredient("item|example:global_" + nextIngredient++, 1)));
            }
            assertTrue(model.setRecipe(
                    node,
                    recipe("global-recipe-" + nextIngredient,
                            inputs,
                            Collections.singletonList(slot(node.getIngredient()))),
                    false));
            queue.addAll(node.getChildren());
            if (!node.getTruncatedDemands().isEmpty()) truncatedAt = node;
        }

        assertEquals(RecipeTreeModel.MAX_NODES, countNodes(model.getRoots()));
        assertNotNull(truncatedAt);
        assertEquals(1, truncatedAt.getTruncatedDemands().size());
        assertEquals(RecipeTreeModel.TruncationReason.NODE_LIMIT,
                truncatedAt.getTruncatedDemands().get(0).getReason());
    }

    @Test
    public void favoriteExpansionBudgetResetsOnlyAtTheNextOuterOperation() {
        RecipeTreeModel.FavoriteExpansionBudget budget =
                new RecipeTreeModel.FavoriteExpansionBudget(3);
        budget.beginOperation();
        assertTrue(budget.tryConsume());
        assertTrue(budget.tryConsume());
        budget.beginOperation();
        assertTrue(budget.tryConsume());
        assertFalse(budget.tryConsume());
        budget.endOperation();
        assertFalse(budget.tryConsume());
        budget.endOperation();

        budget.beginOperation();
        assertEquals(3, budget.getRemaining());
        assertTrue(budget.tryConsume());
        budget.endOperation();
    }

    @Test
    public void reusableInputsAndMicroInfinityStayOutOfTheVisiblePlan() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:result", 1);
        RecipeTreeViewerBridge.Ingredient consumed = ingredient("item|example:material", 2);
        RecipeTreeViewerBridge.Ingredient mold = ingredient("item|example:mold", 1);
        RecipeTreeViewerBridge.Ingredient energy = ingredient(
                "custom_crazypants.enderio.base.integration.jei.energy.energyingredient"
                        + "|enderio:energy",
                25000);

        RecipeTreeModel model = model(root, 1);
        assertTrue(model.setRecipe(
                model.getPrimaryRoot(),
                recipe("operational-inputs",
                        Arrays.asList(slot(consumed), slot(mold), slot(energy)),
                        Arrays.asList(slot(root), slot(mold))),
                false));

        List<RecipeTreeModel.Node> children = model.getPrimaryRoot().getChildren();
        assertEquals(3, children.size());
        assertFalse(RecipeTreeModel.isOperationalOnly(children.get(0)));
        assertTrue(RecipeTreeModel.isOperationalOnly(children.get(1)));
        assertTrue(RecipeTreeModel.isOperationalOnly(children.get(2)));

        RecipeTreeModel.Summary summary = model.summarize(false);
        assertEquals(1, summary.materials.size());
        assertEquals(consumed.getKey(), summary.materials.get(0).ingredient.getKey());
        assertTrue(summary.byproducts.isEmpty());
    }

    @Test
    public void knownMetalPressMoldsAndTinkersCastsAreReusableTools() {
        assertTrue(RecipeTreeModel.isKnownReusableTool(
                "ie.metalPress", "item|immersiveengineering:mold:1"));
        assertTrue(RecipeTreeModel.isKnownReusableTool(
                "tconstruct.casting_table", "item|tconstruct:cast:0:tconstruct:large_plate"));
        assertFalse(RecipeTreeModel.isKnownReusableTool(
                "minecraft.crafting", "item|immersiveengineering:mold:1"));
        assertFalse(RecipeTreeModel.isKnownReusableTool(
                "tconstruct.casting_table", "item|tconstruct:clay_cast:0"));
        assertFalse(RecipeTreeModel.isKnownReusableTool(
                "ie.metalPress", "item|immersiveengineering:plate_iron"));
    }

    @Test
    public void playerCanToggleAnExactRecipeInputAsReusable() throws Exception {
        RecipeTreeViewerBridge.Ingredient root = ingredient("item|example:result", 1);
        RecipeTreeViewerBridge.Ingredient material = ingredient("item|example:material", 3);
        RecipeTreeViewerBridge.Ingredient alternative = ingredient("item|example:alternative", 3);
        RecipeTreeViewerBridge.Ingredient nestedInput =
                ingredient("item|example:nested_input", 4);
        RecipeTreeViewerBridge.Recipe recipe = recipe(
                "manual-reusable-input",
                Collections.singletonList(slot(material, alternative)),
                Collections.singletonList(slot(root)));
        RecipeTreeViewerBridge.Recipe materialRecipe = recipe(
                "material-recipe",
                Collections.singletonList(slot(nestedInput)),
                Collections.singletonList(slot(material)));
        RecipeTreeModel model = model(root, 2);
        assertTrue(model.setRecipe(model.getPrimaryRoot(), recipe, false));

        RecipeTreeModel.Node input = model.getPrimaryRoot().getChildren().get(0);
        assertTrue(model.setRecipe(input, materialRecipe, false));
        assertFalse(RecipeTreeModel.isOperationalOnly(input));
        assertEquals("6", input.getDemand().toPlainString());
        assertSame(materialRecipe, input.getRecipe());
        assertEquals(1, input.getChildren().size());
        assertEquals("8", input.getChildren().get(0).getDemand().toPlainString());
        assertEquals(1, model.summarize(false).materials.size());

        assertTrue(model.toggleReusableInput(input));
        assertTrue(input.isManualReusableInput());
        assertEquals("1", input.getDemand().toPlainString());
        assertSame(materialRecipe, input.getRecipe());
        assertEquals(1, input.getChildren().size());
        assertEquals("4", input.getChildren().get(0).getDemand().toPlainString());
        assertTrue(RecipeTreeModel.isOperationalOnly(input));
        assertTrue(model.isManuallyReusableInput(recipe, alternative));
        assertEquals(nestedInput.getKey(), model.summarize(false).materials.get(0)
                .ingredient.getKey());

        assertFalse(model.toggleReusableInput(recipe, alternative));
        assertFalse(input.isManualReusableInput());
        assertEquals("6", input.getDemand().toPlainString());
        assertSame(materialRecipe, input.getRecipe());
        assertEquals(1, input.getChildren().size());
        assertEquals("8", input.getChildren().get(0).getDemand().toPlainString());
        assertFalse(RecipeTreeModel.isOperationalOnly(input));
        assertFalse(model.isManuallyReusableInput(recipe, material));
        assertEquals(1, model.summarize(false).materials.size());
    }

    @Test
    public void primaryHistoryExportOmitsEveryAdditionalStartingNode() throws Exception {
        RecipeTreeViewerBridge.Ingredient primary = ingredient("item|example:primary", 1);
        RecipeTreeViewerBridge.Ingredient primaryInput =
                ingredient("item|example:primary_input", 2);
        RecipeTreeViewerBridge.Ingredient additional =
                ingredient("item|example:additional", 1);
        RecipeTreeViewerBridge.Ingredient additionalInput =
                ingredient("item|example:additional_input", 3);
        RecipeTreeModel model = model(primary, 4);
        assertTrue(model.setRecipe(
                model.getPrimaryRoot(),
                recipe("primary-recipe", Collections.singletonList(slot(primaryInput)),
                        Collections.singletonList(slot(primary))),
                false));
        assertTrue(model.addRoot(additional, 5));
        assertTrue(model.setRecipe(
                model.getRoots().get(1),
                recipe("additional-recipe", Collections.singletonList(slot(additionalInput)),
                        Collections.singletonList(slot(additional))),
                false));

        RecipeTreeProgress.RecipeHistoryEntry exported =
                model.primaryHistoryEntry(true, true);

        assertEquals(primary.getKey(), exported.getItemIdentity());
        assertEquals(1, exported.getRoots().size());
        assertEquals(primary.getKey(), exported.getRoots().get(0).getIngredientIdentity());
        assertFalse(exported.getSelections().isEmpty());
        for (RecipeTreeProgress.RecipeHistorySelection selection : exported.getSelections()) {
            assertEquals(0, selection.getRootIndex());
            assertFalse(additional.getKey().equals(selection.getIngredientIdentity()));
            assertFalse(additionalInput.getKey().equals(selection.getIngredientIdentity()));
        }
    }

    private static RecipeTreeModel model(
            RecipeTreeViewerBridge.Ingredient root,
            long amount) throws Exception {
        return new RecipeTreeModel(bridge(), progress(), root, amount);
    }

    private static RecipeTreeViewerBridge bridge() {
        final IRecipeRegistry recipes = proxy(IRecipeRegistry.class, null);
        IJeiRuntime runtime = proxy(IJeiRuntime.class, recipes);
        IIngredientRegistry ingredients = proxy(IIngredientRegistry.class, null);
        return new RecipeTreeViewerBridge(runtime, ingredients);
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(final Class<T> type, final IRecipeRegistry recipes) {
        return (T) Proxy.newProxyInstance(
                type.getClassLoader(),
                new Class<?>[] {type},
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] arguments) {
                        if ("getRecipeRegistry".equals(method.getName())) return recipes;
                        if ("toString".equals(method.getName())) return type.getSimpleName();
                        if ("hashCode".equals(method.getName())) return System.identityHashCode(proxy);
                        if ("equals".equals(method.getName())) return proxy == arguments[0];
                        Class<?> returnType = method.getReturnType();
                        if (returnType == boolean.class) return false;
                        if (returnType == int.class) return 0;
                        if (returnType == long.class) return 0L;
                        return null;
                    }
                });
    }

    private static RecipeTreeProgress progress() throws Exception {
        RecipeTreeProgress.StateData state = new RecipeTreeProgress.StateData(
                new LinkedHashMap<String, RecipeTreeProgress.SavedPlan>(),
                new LinkedHashMap<String, String>(),
                new LinkedHashMap<String, Boolean>(),
                Collections.<RecipeTreeProgress.RecipeHistoryEntry>emptyList(),
                null,
                false,
                new LinkedHashSet<String>(),
                new LinkedHashSet<String>());
        Constructor<RecipeTreeProgress> constructor = RecipeTreeProgress.class
                .getDeclaredConstructor(java.nio.file.Path.class,
                        RecipeTreeProgress.StateData.class,
                        boolean.class);
        constructor.setAccessible(true);
        return constructor.newInstance(Paths.get("unused-recipe-tree-progress.json"), state, false);
    }

    private static RecipeTreeViewerBridge.Ingredient ingredient(String key, int amount) {
        return new RecipeTreeViewerBridge.Ingredient(
                null,
                new Object(),
                key,
                key,
                BigDecimal.valueOf(amount));
    }

    private static RecipeTreeViewerBridge.Slot slot(
            RecipeTreeViewerBridge.Ingredient... alternatives) {
        return new RecipeTreeViewerBridge.Slot(Arrays.asList(alternatives));
    }

    private static RecipeTreeViewerBridge.Recipe recipe(
            String key,
            List<RecipeTreeViewerBridge.Slot> inputs,
            List<RecipeTreeViewerBridge.Slot> outputs) {
        return new RecipeTreeViewerBridge.Recipe(
                key,
                "example.machine",
                "Example Machine",
                null,
                inputs,
                outputs,
                100,
                50,
                null,
                null,
                null);
    }

    private static int countNodes(List<RecipeTreeModel.Node> roots) {
        int total = 0;
        Deque<RecipeTreeModel.Node> pending = new ArrayDeque<RecipeTreeModel.Node>(roots);
        while (!pending.isEmpty()) {
            RecipeTreeModel.Node node = pending.removeFirst();
            total++;
            pending.addAll(node.getChildren());
        }
        return total;
    }

    private static RecipeTreeModel.SummaryEntry summaryByKey(
            List<RecipeTreeModel.SummaryEntry> summaries,
            String key) {
        for (RecipeTreeModel.SummaryEntry summary : summaries) {
            if (key.equals(summary.ingredient.getKey())) return summary;
        }
        return null;
    }

    private static void assertAmount(String expected, BigDecimal actual) {
        assertEquals(0, new BigDecimal(expected).compareTo(actual));
    }
}
