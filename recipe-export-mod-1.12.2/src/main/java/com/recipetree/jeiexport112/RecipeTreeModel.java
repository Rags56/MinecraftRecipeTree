package com.recipetree.jeiexport112;

import mezz.jei.api.recipe.IFocus;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Mutable recipe-plan graph independent of Minecraft's screen classes.
 *
 * <p>All quantities use exact decimals because legacy JEI integrations use the same ingredient
 * channel for item counts, fluid millibuckets, gases, aspects, and pack-specific resources. The
 * screen is therefore free to render live native ingredients without losing their real units.</p>
 */
final class RecipeTreeModel {
    static final int MAX_ROOTS = 16;
    static final int MAX_DEPTH = 12;
    static final int MAX_CHILDREN = 32;
    static final int MAX_NODES = 2048;
    private static final int MAX_FAVORITE_EXPANSIONS = 128;

    private final RecipeTreeViewerBridge bridge;
    private final RecipeTreeProgress progress;
    private final List<Node> roots = new ArrayList<Node>();
    private final FavoriteExpansionBudget favoriteExpansionBudget =
            new FavoriteExpansionBudget(MAX_FAVORITE_EXPANSIONS);
    private Summary cachedSummaryWithByproducts;
    private Summary cachedSummaryWithoutByproducts;

    RecipeTreeModel(
            RecipeTreeViewerBridge bridge,
            RecipeTreeProgress progress,
            RecipeTreeViewerBridge.Ingredient rootIngredient,
            long amount) {
        if (bridge == null) throw new IllegalArgumentException("Recipe viewer bridge is required");
        if (rootIngredient == null) throw new IllegalArgumentException("Root ingredient is required");
        this.bridge = bridge;
        this.progress = progress;
        roots.add(new Node(rootIngredient, decimalAmount(amount), null, BigDecimal.ZERO,
                Collections.singletonList(rootIngredient), singletonAmountMap(rootIngredient)));
    }

    List<Node> getRoots() {
        return Collections.unmodifiableList(roots);
    }

    Node getPrimaryRoot() {
        return roots.isEmpty() ? null : roots.get(0);
    }

    boolean addRoot(RecipeTreeViewerBridge.Ingredient ingredient, long amount) {
        if (ingredient == null) return false;
        if (roots.size() >= MAX_ROOTS) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Refusing to add recipe-tree root {} because the root limit of "
                            + "{} is already active",
                    ingredient.getKey(), MAX_ROOTS);
            return false;
        }
        if (nodeCount() >= MAX_NODES) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Refusing to add recipe-tree root {} because the global node "
                            + "limit of {} is already active",
                    ingredient.getKey(), MAX_NODES);
            return false;
        }
        roots.add(new Node(ingredient, decimalAmount(amount), null, BigDecimal.ZERO,
                Collections.singletonList(ingredient), singletonAmountMap(ingredient)));
        invalidateSummary();
        return true;
    }

    boolean removeRoot(Node node) {
        boolean removed = roots.size() > 1 && roots.remove(node);
        if (removed) invalidateSummary();
        return removed;
    }

    void setPrimaryAmount(long amount) {
        if (!roots.isEmpty()) {
            roots.get(0).updateDemand(decimalAmount(amount));
            invalidateSummary();
        }
    }

    List<RecipeTreeViewerBridge.RecipeGroup> recipesFor(
            RecipeTreeViewerBridge.Ingredient ingredient,
            IFocus.Mode mode) {
        return bridge.query(ingredient, mode);
    }

    List<RecipeTreeViewerBridge.Recipe> flattenedRecipes(
            RecipeTreeViewerBridge.Ingredient ingredient,
            IFocus.Mode mode) {
        List<RecipeTreeViewerBridge.Recipe> recipes =
                new ArrayList<RecipeTreeViewerBridge.Recipe>();
        for (RecipeTreeViewerBridge.RecipeGroup group : bridge.query(ingredient, mode)) {
            recipes.addAll(group.getRecipes());
        }
        return recipes;
    }

    RecipeTreeViewerBridge.Recipe recipeByKey(
            RecipeTreeViewerBridge.Ingredient ingredient,
            String recipeKey) {
        if (ingredient == null || recipeKey == null) return null;
        for (RecipeTreeViewerBridge.Recipe recipe :
                flattenedRecipes(ingredient, IFocus.Mode.OUTPUT)) {
            if (!recipe.isAspectSourcePage() && recipeKey.equals(recipe.getKey())) return recipe;
            RecipeTreeViewerBridge.Recipe selected = recipe.resolveAspectSource(recipeKey);
            if (selected != null) return selected;
        }
        return null;
    }

    boolean setRecipe(Node node, RecipeTreeViewerBridge.Recipe recipe, boolean favorite) {
        favoriteExpansionBudget.beginOperation();
        try {
            return setRecipeWithinOperation(node, recipe, favorite);
        } finally {
            favoriteExpansionBudget.endOperation();
        }
    }

    private boolean setRecipeWithinOperation(
            Node node,
            RecipeTreeViewerBridge.Recipe recipe,
            boolean favorite) {
        return setRecipeWithinOperation(node, recipe, favorite, true);
    }

    private boolean setRecipeWithinOperation(
            Node node,
            RecipeTreeViewerBridge.Recipe recipe,
            boolean favorite,
            boolean expandChildFavorites) {
        if (node == null || recipe == null) return false;
        BigDecimal output = outputAmount(recipe, node.ingredient.getKey());
        if (output.signum() <= 0) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Refusing recipe {} for {} because its semantic outputs do not "
                            + "contain the selected ingredient",
                    recipe.getKey(),
                    node.ingredient.getKey());
            return false;
        }
        node.recipe = recipe;
        node.outputPerCraft = output;
        invalidateSummary();
        rebuildChildren(node, expandChildFavorites);
        if (favorite) {
            progress.saveFavoriteRecipe(node.ingredient.getKey(), recipe.getKey());
            applyFavoriteEverywhereWithinOperation(node.ingredient.getKey(), recipe.getKey());
        }
        return true;
    }

    void clearRecipe(Node node, boolean clearFavorite) {
        if (node == null) return;
        clearRecipeSelection(node);
        invalidateSummary();
        if (clearFavorite) progress.clearFavoriteRecipe(node.ingredient.getKey());
    }

    void clearRecipesForIngredient(Node node, boolean clearFavorite) {
        if (node == null) return;
        String ingredientKey = node.ingredient.getKey();
        List<Node> matches = new ArrayList<Node>();
        for (Node root : roots) collectMatching(root, ingredientKey, matches);
        for (Node match : matches) clearRecipeSelection(match);
        invalidateSummary();
        if (clearFavorite) progress.clearFavoriteRecipe(ingredientKey);
    }

    private static void clearRecipeSelection(Node node) {
        node.recipe = null;
        node.outputPerCraft = BigDecimal.ONE;
        node.children.clear();
        node.truncatedDemands.clear();
    }

    void applyFavoriteEverywhere(String ingredientKey, String recipeKey) {
        favoriteExpansionBudget.beginOperation();
        try {
            applyFavoriteEverywhereWithinOperation(ingredientKey, recipeKey);
        } finally {
            favoriteExpansionBudget.endOperation();
        }
    }

    private void applyFavoriteEverywhereWithinOperation(String ingredientKey, String recipeKey) {
        if (ingredientKey == null) return;
        List<Node> matches = new ArrayList<Node>();
        for (Node root : roots) collectMatching(root, ingredientKey, matches);
        for (Node match : matches) {
            RecipeTreeViewerBridge.Recipe replacement = recipeByKey(match.ingredient, recipeKey);
            if (replacement != null) setRecipeWithinOperation(match, replacement, false);
        }
    }

    boolean selectAlternative(Node node, int index, boolean expandFavorite) {
        favoriteExpansionBudget.beginOperation();
        try {
            return selectAlternativeWithinOperation(node, index, expandFavorite);
        } finally {
            favoriteExpansionBudget.endOperation();
        }
    }

    private boolean selectAlternativeWithinOperation(
            Node node,
            int index,
            boolean expandFavorite) {
        if (node == null || index < 0 || index >= node.alternatives.size()
                || index == node.alternativeIndex) {
            return false;
        }
        node.alternativeIndex = index;
        node.ingredient = node.alternatives.get(index);
        BigDecimal perCraft = node.amountByAlternative.get(node.ingredient.getKey());
        node.quantityPerParentCraft = positiveOrOne(perCraft);
        node.recipe = null;
        node.outputPerCraft = BigDecimal.ONE;
        node.children.clear();
        node.truncatedDemands.clear();
        node.refreshDemandFromParent();
        invalidateSummary();
        if (expandFavorite) {
            expandFavoriteWithinOperation(node, new LinkedHashSet<String>());
        }
        return true;
    }

    boolean cycleAlternative(Node node, int direction) {
        if (node == null || node.alternatives.size() < 2 || direction == 0) return false;
        int size = node.alternatives.size();
        int index = (node.alternativeIndex + (direction > 0 ? 1 : -1) + size) % size;
        return selectAlternative(node, index, true);
    }

    void expandFavorite(Node node) {
        favoriteExpansionBudget.beginOperation();
        try {
            expandFavoriteWithinOperation(node, new LinkedHashSet<String>());
        } finally {
            favoriteExpansionBudget.endOperation();
        }
    }

    int depth(Node node) {
        int depth = 0;
        while (node != null && node.parent != null) {
            depth++;
            node = node.parent;
        }
        return depth;
    }

    int maximumDepth() {
        int maximum = 0;
        for (Node root : roots) maximum = Math.max(maximum, subtreeDepth(root));
        return maximum;
    }

    RecipeTreeProgress.RecipeHistoryEntry historyEntry(boolean compact, boolean snapshot) {
        Node primary = getPrimaryRoot();
        List<RecipeTreeProgress.RecipeHistoryRoot> savedRoots =
                new ArrayList<RecipeTreeProgress.RecipeHistoryRoot>();
        List<RecipeTreeProgress.RecipeHistorySelection> selections =
                new ArrayList<RecipeTreeProgress.RecipeHistorySelection>();
        for (int rootIndex = 0; rootIndex < roots.size(); rootIndex++) {
            Node root = roots.get(rootIndex);
            savedRoots.add(new RecipeTreeProgress.RecipeHistoryRoot(
                    root.ingredient.getKey(),
                    root.ingredient.getDisplayName(),
                    root.recipe == null ? null : root.recipe.getKey(),
                    wholeAmount(root.demand)));
            appendSelections(root, rootIndex, Collections.<Integer>emptyList(), selections);
        }
        return new RecipeTreeProgress.RecipeHistoryEntry(
                primary == null ? null : primary.ingredient.getKey(),
                primary == null || primary.recipe == null ? null : primary.recipe.getKey(),
                primary == null ? 1L : wholeAmount(primary.demand),
                compact,
                maximumDepth(),
                savedRoots,
                selections,
                snapshot);
    }

    /** Returns a portable history entry containing only the main starting node. */
    RecipeTreeProgress.RecipeHistoryEntry primaryHistoryEntry(boolean compact, boolean snapshot) {
        Node primary = getPrimaryRoot();
        List<RecipeTreeProgress.RecipeHistoryRoot> savedRoots =
                new ArrayList<RecipeTreeProgress.RecipeHistoryRoot>();
        List<RecipeTreeProgress.RecipeHistorySelection> selections =
                new ArrayList<RecipeTreeProgress.RecipeHistorySelection>();
        if (primary != null) {
            savedRoots.add(new RecipeTreeProgress.RecipeHistoryRoot(
                    primary.ingredient.getKey(),
                    primary.ingredient.getDisplayName(),
                    primary.recipe == null ? null : primary.recipe.getKey(),
                    wholeAmount(primary.demand)));
            appendSelections(primary, 0, Collections.<Integer>emptyList(), selections);
        }
        return new RecipeTreeProgress.RecipeHistoryEntry(
                primary == null ? null : primary.ingredient.getKey(),
                primary == null || primary.recipe == null ? null : primary.recipe.getKey(),
                primary == null ? 1L : wholeAmount(primary.demand),
                compact,
                primary == null ? 0 : subtreeDepth(primary),
                savedRoots,
                selections,
                snapshot);
    }

    static RecipeTreeModel restore(
            RecipeTreeViewerBridge bridge,
            RecipeTreeProgress progress,
            RecipeTreeProgress.RecipeHistoryEntry entry) {
        return restore(bridge, progress, entry, false);
    }

    static RecipeTreeModel restoreForComparison(RecipeTreeViewerBridge bridge,
            RecipeTreeProgress.RecipeHistoryEntry entry) {
        // Comparison uses saved flags, never today's favorites or reusable settings.
        // Strict restoration below applies those flags directly without writing progress.
        return restore(bridge, new RecipeTreeProgress(null, null, false), entry, true);
    }

    private static RecipeTreeModel restore(RecipeTreeViewerBridge bridge,
            RecipeTreeProgress progress, RecipeTreeProgress.RecipeHistoryEntry entry, boolean strict) {
        if (entry == null || entry.getItemIdentity() == null) return null;
        RecipeTreeViewerBridge.Ingredient primary = bridge.findIngredient(entry.getItemIdentity());
        if (primary == null) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Could not restore the last recipe tree because ingredient {} is "
                            + "not present in this JEI/HEI runtime",
                    entry.getItemIdentity());
            return null;
        }
        RecipeTreeModel model = new RecipeTreeModel(bridge, progress, primary, entry.getAmount());
        model.roots.clear();
        for (RecipeTreeProgress.RecipeHistoryRoot savedRoot : entry.getRoots()) {
            if (model.roots.size() >= MAX_ROOTS) {
                if (strict) throw new IllegalStateException("Saved tree exceeds the root limit");
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Saved recipe tree contains more than {} roots; ignoring {} "
                                + "remaining roots rather than exceeding the documented limit",
                        MAX_ROOTS, entry.getRoots().size() - model.roots.size());
                break;
            }
            RecipeTreeViewerBridge.Ingredient ingredient =
                    bridge.findIngredient(savedRoot.getIngredientIdentity());
            if (ingredient == null) {
                if (strict) throw new IllegalStateException("Missing saved root: " + savedRoot.getIngredientName());
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Skipping unresolved saved recipe-tree root {}",
                        savedRoot.getIngredientIdentity());
                continue;
            }
            model.roots.add(new Node(
                    ingredient,
                    decimalAmount(savedRoot.getAmount()),
                    null,
                    BigDecimal.ZERO,
                    Collections.singletonList(ingredient),
                    singletonAmountMap(ingredient)));
        }
        if (model.roots.isEmpty()) {
            model.roots.add(new Node(primary, decimalAmount(entry.getAmount()), null,
                    BigDecimal.ZERO, Collections.singletonList(primary),
                    singletonAmountMap(primary)));
        }
        for (RecipeTreeProgress.RecipeHistorySelection selection : entry.getSelections()) {
            Node node = model.nodeAt(selection.getRootIndex(), selection.getPath());
            if (node == null) {
                if (strict) throw new IllegalStateException("Missing saved node: " + selection.getIngredientName());
                continue;
            }
            int alternative = node.alternativeIndex(selection.getIngredientIdentity());
            if (alternative >= 0) model.selectAlternative(node, alternative, false);
            if (!node.ingredient.getKey().equals(selection.getIngredientIdentity())) {
                if (strict) throw new IllegalStateException("Saved ingredient changed: " + selection.getIngredientName());
                continue;
            }
            if (strict) {
                node.manualReusableInput = node.parent != null && selection.isReusableInput();
                node.refreshDemandFromParent();
            }
            if (selection.getRecipeIdentity() == null) {
                model.clearRecipe(node, false);
                if (!strict && selection.isReusableInput()) model.setReusableInput(node, true);
                continue;
            }
            RecipeTreeViewerBridge.Recipe recipe =
                    model.recipeByKey(node.ingredient, selection.getRecipeIdentity());
            if (recipe != null) {
                boolean applied = model.setRecipeForRestore(node, recipe);
                if (strict && !applied) throw new IllegalStateException("Cannot restore recipe: " + selection.getIngredientName());
                if (!strict && selection.isReusableInput()) model.setReusableInput(node, true);
            } else if (strict) {
                throw new IllegalStateException("Recipe unavailable: " + selection.getIngredientName());
            }
        }
        return model;
    }

    Summary summarize(boolean useByproducts) {
        Summary cached = useByproducts
                ? cachedSummaryWithByproducts : cachedSummaryWithoutByproducts;
        if (cached != null) return cached;
        List<Node> nodes = allNodes();
        Map<String, MutableSummary> materials = new LinkedHashMap<String, MutableSummary>();
        Map<String, MutableSummary> byproducts = new LinkedHashMap<String, MutableSummary>();
        Map<String, ProcessSummary> processes = new LinkedHashMap<String, ProcessSummary>();

        for (Node node : nodes) {
            if (isOperationalOnly(node)) continue;
            if (node.recipe == null) {
                addSummary(materials, node.ingredient, node.demand, node);
                continue;
            }
            BigDecimal crafts = node.crafts();
            for (TruncatedDemand truncated : node.truncatedDemands) {
                addSummary(
                        materials,
                        truncated.ingredient,
                        truncated.quantityPerCraft.multiply(crafts),
                        node);
            }
            String processKey = node.recipe.getCategoryUid();
            ProcessSummary previous = processes.get(processKey);
            if (previous == null) {
                processes.put(processKey, new ProcessSummary(
                        processKey,
                        node.recipe.getCategoryTitle(),
                        node.recipe.getCatalystMachine(),
                        crafts));
            } else {
                previous.crafts = previous.crafts.add(crafts);
            }
            BigDecimal primaryProduced = BigDecimal.ZERO;
            RecipeTreeViewerBridge.Ingredient primaryOutput = null;
            for (RecipeTreeViewerBridge.Slot slot : node.recipe.getOutputs()) {
                RecipeTreeViewerBridge.Ingredient output =
                        selectedOutput(slot, node.ingredient.getKey());
                if (output == null) continue;
                BigDecimal produced = positiveOrOne(output.getAmount()).multiply(crafts);
                if (output.getKey().equals(node.ingredient.getKey())) {
                    primaryProduced = primaryProduced.add(produced);
                    if (primaryOutput == null) primaryOutput = output;
                } else if (!isOperationalChild(node, output.getKey())) {
                    addSummary(byproducts, output, produced, node);
                }
            }
            BigDecimal surplus = primaryProduced.subtract(node.demand);
            if (surplus.signum() > 0) {
                addSummary(byproducts,
                        primaryOutput == null ? node.ingredient : primaryOutput,
                        surplus,
                        node);
            }
        }

        if (useByproducts) allocateByproducts(materials, byproducts);
        Summary result = new Summary(freezeSummaries(materials), freezeSummaries(byproducts),
                new ArrayList<ProcessSummary>(processes.values()));
        if (useByproducts) cachedSummaryWithByproducts = result;
        else cachedSummaryWithoutByproducts = result;
        return result;
    }

    static boolean isOperationalOnly(Node node) {
        if (node == null || node.parent == null || node.parent.recipe == null) return false;
        if (node.manualReusableInput) return true;
        if (node.ingredient.getKey().endsWith("|enderio:energy")) return true;
        if (isKnownReusableTool(node.parent.recipe.getCategoryUid(),
                node.ingredient.getKey())) return true;
        BigDecimal returned = outputAmount(node.parent.recipe, node.ingredient.getKey());
        return returned.compareTo(positiveOrOne(node.quantityPerParentCraft)) >= 0;
    }

    static boolean isKnownReusableTool(String categoryUid, String ingredientKey) {
        if (categoryUid == null || ingredientKey == null) return false;
        String category = categoryUid.toLowerCase(Locale.ROOT);
        String ingredient = ingredientKey.toLowerCase(Locale.ROOT);
        if ("ie.metalpress".equals(category)) {
            return ingredient.startsWith("item|immersiveengineering:mold:");
        }
        if ("tconstruct.casting_table".equals(category)) {
            return ingredient.startsWith("item|tconstruct:cast:");
        }
        return false;
    }

    boolean toggleReusableInput(Node node) {
        if (node == null || node.parent == null || node.parent.recipe == null) return false;
        boolean reusable = !progress.isReusableInput(
                node.parent.recipe.getKey(), node.ingredient.getKey());
        setReusableInput(node, reusable);
        return reusable;
    }

    boolean toggleReusableInput(
            RecipeTreeViewerBridge.Recipe recipe,
            RecipeTreeViewerBridge.Ingredient ingredient) {
        if (recipe == null || ingredient == null) return false;
        List<RecipeTreeViewerBridge.Ingredient> alternatives = inputAlternatives(
                recipe, ingredient.getKey());
        if (!alternatives.isEmpty()) {
            boolean reusable = !progress.isReusableInput(recipe.getKey(), ingredient.getKey());
            setReusableInput(recipe, alternatives, reusable);
            return reusable;
        }
        return false;
    }

    boolean isRecipeInput(
            RecipeTreeViewerBridge.Recipe recipe,
            RecipeTreeViewerBridge.Ingredient ingredient) {
        return recipe != null && ingredient != null
                && !inputAlternatives(recipe, ingredient.getKey()).isEmpty();
    }

    boolean isManuallyReusableInput(
            RecipeTreeViewerBridge.Recipe recipe,
            RecipeTreeViewerBridge.Ingredient ingredient) {
        return recipe != null && ingredient != null
                && progress.isReusableInput(recipe.getKey(), ingredient.getKey());
    }

    private static List<RecipeTreeViewerBridge.Ingredient> inputAlternatives(
            RecipeTreeViewerBridge.Recipe recipe,
            String ingredientKey) {
        for (RecipeTreeViewerBridge.Slot slot : recipe.getInputs()) {
            List<RecipeTreeViewerBridge.Ingredient> alternatives = slot.getAlternatives();
            for (RecipeTreeViewerBridge.Ingredient alternative : alternatives) {
                if (alternative.getKey().equals(ingredientKey)) return alternatives;
            }
        }
        return Collections.emptyList();
    }

    private void setReusableInput(Node node, boolean reusable) {
        if (node == null || node.parent == null || node.parent.recipe == null) return;
        setReusableInput(node.parent.recipe, node.alternatives, reusable);
    }

    private void setReusableInput(
            RecipeTreeViewerBridge.Recipe recipe,
            List<RecipeTreeViewerBridge.Ingredient> alternatives,
            boolean reusable) {
        List<String> ingredientKeys = new ArrayList<String>();
        for (RecipeTreeViewerBridge.Ingredient alternative : alternatives) {
            ingredientKeys.add(alternative.getKey());
        }
        progress.setReusableInputs(recipe.getKey(), ingredientKeys, reusable);
        refreshManualReusableInputs();
    }

    private void refreshManualReusableInputs() {
        for (Node candidate : allNodes()) {
            candidate.manualReusableInput = candidate.parent != null
                    && candidate.parent.recipe != null
                    && progress.isReusableInput(
                            candidate.parent.recipe.getKey(), candidate.ingredient.getKey());
        }
        for (Node root : roots) {
            for (Node child : root.children) child.refreshDemandFromParent();
        }
        invalidateSummary();
    }

    private static boolean isOperationalChild(Node parent, String ingredientKey) {
        for (Node child : parent.children) {
            if (child.ingredient.getKey().equals(ingredientKey) && isOperationalOnly(child)) {
                return true;
            }
        }
        return false;
    }

    private void rebuildChildren(Node node, boolean expandFavorites) {
        node.children.clear();
        node.truncatedDemands.clear();
        if (node.recipe == null) return;
        List<InputGroup> groups = groupInputs(node.recipe.getInputs());
        if (groups.isEmpty()) return;
        if (depth(node) >= MAX_DEPTH) {
            truncateGroups(node, groups, 0, TruncationReason.DEPTH_LIMIT);
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Recipe {} reached recipe-tree depth limit {}; accounting for "
                            + "all {} remaining input groups as explicit terminal demand",
                    node.recipe.getKey(), MAX_DEPTH, groups.size());
            return;
        }
        int availableNodes = Math.max(0, MAX_NODES - nodeCount());
        int index = 0;
        for (; index < groups.size(); index++) {
            if (index >= MAX_CHILDREN) {
                truncateGroups(node, groups, index, TruncationReason.CHILD_LIMIT);
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Recipe {} exceeds the per-recipe child limit {}; "
                                + "accounting for {} remaining input groups as explicit terminal "
                                + "demand",
                        node.recipe.getKey(), MAX_CHILDREN, groups.size() - index);
                break;
            }
            if (availableNodes <= 0) {
                truncateGroups(node, groups, index, TruncationReason.NODE_LIMIT);
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Recipe {} reached the global recipe-tree node limit {}; "
                                + "accounting for {} remaining input groups as explicit terminal "
                                + "demand",
                        node.recipe.getKey(), MAX_NODES, groups.size() - index);
                break;
            }
            InputGroup group = groups.get(index);
            RecipeTreeViewerBridge.Ingredient selected = group.alternatives.get(0);
            BigDecimal perCraft = positiveOrOne(group.amounts.get(selected.getKey()));
            Node child = new Node(
                    selected,
                    perCraft.multiply(node.crafts()),
                    node,
                    perCraft,
                    group.alternatives,
                    group.amounts);
            child.manualReusableInput = progress.isReusableInput(
                    node.recipe.getKey(), selected.getKey());
            child.refreshDemandFromParent();
            node.children.add(child);
            availableNodes--;
        }
        if (expandFavorites) {
            for (Node child : node.children) {
                expandFavoriteWithinOperation(child, new LinkedHashSet<String>());
            }
        }
    }

    private boolean setRecipeForRestore(Node node, RecipeTreeViewerBridge.Recipe recipe) {
        favoriteExpansionBudget.beginOperation();
        try {
            return setRecipeWithinOperation(node, recipe, false, false);
        } finally {
            favoriteExpansionBudget.endOperation();
        }
    }

    private void invalidateSummary() {
        cachedSummaryWithByproducts = null;
        cachedSummaryWithoutByproducts = null;
    }

    private void expandFavoriteWithinOperation(Node node, Set<String> path) {
        if (node == null || node.recipe != null || depth(node) >= MAX_DEPTH) return;
        String ingredientKey = node.ingredient.getKey();
        if (!path.add(ingredientKey) || repeatsAncestor(node, ingredientKey)) return;
        String favorite = progress.favoriteRecipe(ingredientKey);
        if (favorite == null) return;
        if (!favoriteExpansionBudget.tryConsume()) {
            if (favoriteExpansionBudget.markExhaustionLogged()) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Recipe-tree favorite auto-expansion reached its per-change "
                                + "limit of {}; remaining favorites stay as explicit terminal "
                                + "nodes until a later tree change",
                        MAX_FAVORITE_EXPANSIONS);
            }
            return;
        }
        RecipeTreeViewerBridge.Recipe recipe = recipeByKey(node.ingredient, favorite);
        if (recipe == null) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Favorite recipe {} for {} is not available in the current "
                            + "JEI/HEI runtime",
                    favorite, ingredientKey);
            return;
        }
        setRecipeWithinOperation(node, recipe, false);
    }

    private static void truncateGroups(
            Node node,
            List<InputGroup> groups,
            int firstIndex,
            TruncationReason reason) {
        for (int index = firstIndex; index < groups.size(); index++) {
            InputGroup group = groups.get(index);
            if (group.alternatives.isEmpty()) continue;
            RecipeTreeViewerBridge.Ingredient selected = group.alternatives.get(0);
            node.truncatedDemands.add(new TruncatedDemand(
                    selected,
                    positiveOrOne(group.amounts.get(selected.getKey())),
                    reason));
        }
    }

    private static List<InputGroup> groupInputs(List<RecipeTreeViewerBridge.Slot> slots) {
        List<InputGroup> groups = new ArrayList<InputGroup>();
        if (slots == null) return groups;
        for (RecipeTreeViewerBridge.Slot slot : slots) {
            if (slot == null || slot.getAlternatives().isEmpty()) continue;
            InputGroup incoming = new InputGroup(slot.getAlternatives());
            if (incoming.alternatives.isEmpty()) continue;
            InputGroup mergeTarget = null;
            for (InputGroup candidate : groups) {
                if (candidate.canShareWith(incoming)) {
                    mergeTarget = candidate;
                    break;
                }
            }
            if (mergeTarget == null) groups.add(incoming);
            else mergeTarget.share(incoming);
        }
        return groups;
    }

    private static BigDecimal outputAmount(
            RecipeTreeViewerBridge.Recipe recipe,
            String ingredientKey) {
        BigDecimal total = BigDecimal.ZERO;
        for (RecipeTreeViewerBridge.Slot output : recipe.getOutputs()) {
            for (RecipeTreeViewerBridge.Ingredient alternative : output.getAlternatives()) {
                if (ingredientKey.equals(alternative.getKey())) {
                    total = total.add(positiveOrOne(alternative.getAmount()));
                    break;
                }
            }
        }
        return total;
    }

    private static RecipeTreeViewerBridge.Ingredient selectedOutput(
            RecipeTreeViewerBridge.Slot slot,
            String primaryIngredientKey) {
        if (slot == null || slot.getAlternatives().isEmpty()) return null;
        for (RecipeTreeViewerBridge.Ingredient alternative : slot.getAlternatives()) {
            if (primaryIngredientKey.equals(alternative.getKey())) return alternative;
        }
        return slot.getAlternatives().get(0);
    }

    private Node nodeAt(int rootIndex, List<Integer> path) {
        if (rootIndex < 0 || rootIndex >= roots.size()) return null;
        Node node = roots.get(rootIndex);
        if (path == null) return node;
        for (Integer index : path) {
            if (index == null || index < 0 || index >= node.children.size()) return null;
            node = node.children.get(index);
        }
        return node;
    }

    private void appendSelections(
            Node node,
            int rootIndex,
            List<Integer> path,
            List<RecipeTreeProgress.RecipeHistorySelection> destination) {
        destination.add(new RecipeTreeProgress.RecipeHistorySelection(
                rootIndex,
                path,
                node.ingredient.getKey(),
                node.ingredient.getDisplayName(),
                node.recipe == null ? null : node.recipe.getKey(),
                node.recipe == null ? null : node.recipe.getCategoryUid(),
                node.manualReusableInput));
        for (int index = 0; index < node.children.size(); index++) {
            List<Integer> childPath = new ArrayList<Integer>(path);
            childPath.add(index);
            appendSelections(node.children.get(index), rootIndex, childPath, destination);
        }
    }

    private static void collectMatching(Node node, String key, List<Node> destination) {
        if (node.ingredient.getKey().equals(key)) destination.add(node);
        for (Node child : node.children) collectMatching(child, key, destination);
    }

    private List<Node> allNodes() {
        List<Node> nodes = new ArrayList<Node>();
        Set<Node> seen = Collections.newSetFromMap(new IdentityHashMap<Node, Boolean>());
        for (Node root : roots) collectNodes(root, nodes, seen);
        return nodes;
    }

    private int nodeCount() {
        return allNodes().size();
    }

    private static void collectNodes(Node node, List<Node> destination, Set<Node> seen) {
        if (!seen.add(node)) return;
        destination.add(node);
        for (Node child : node.children) collectNodes(child, destination, seen);
    }

    private static boolean repeatsAncestor(Node node, String key) {
        Node cursor = node.parent;
        while (cursor != null) {
            if (cursor.ingredient.getKey().equals(key)) return true;
            cursor = cursor.parent;
        }
        return false;
    }

    private static int subtreeDepth(Node node) {
        int maximum = 1;
        for (Node child : node.children) maximum = Math.max(maximum, 1 + subtreeDepth(child));
        return maximum;
    }

    private static Map<String, BigDecimal> singletonAmountMap(
            RecipeTreeViewerBridge.Ingredient ingredient) {
        Map<String, BigDecimal> amounts = new LinkedHashMap<String, BigDecimal>();
        amounts.put(ingredient.getKey(), positiveOrOne(ingredient.getAmount()));
        return amounts;
    }

    private static BigDecimal decimalAmount(long amount) {
        return BigDecimal.valueOf(Math.max(1L, Math.min(RecipeQuantityMath.MAX_REQUESTED_AMOUNT,
                amount)));
    }

    static String formatAmount(BigDecimal amount) {
        if (amount == null) return "0";
        BigDecimal normalized = amount.stripTrailingZeros();
        if (normalized.scale() < 0) normalized = normalized.setScale(0);
        return normalized.toPlainString();
    }

    private static long wholeAmount(BigDecimal amount) {
        if (amount == null) return 1L;
        BigDecimal rounded = amount.setScale(0, RoundingMode.CEILING);
        BigDecimal maximum = BigDecimal.valueOf(RecipeQuantityMath.MAX_REQUESTED_AMOUNT);
        if (rounded.compareTo(maximum) > 0) return RecipeQuantityMath.MAX_REQUESTED_AMOUNT;
        return Math.max(1L, rounded.longValue());
    }

    private static BigDecimal positiveOrOne(BigDecimal amount) {
        return amount == null || amount.signum() <= 0 ? BigDecimal.ONE : amount;
    }

    private static void addSummary(
            Map<String, MutableSummary> destination,
            RecipeTreeViewerBridge.Ingredient ingredient,
            BigDecimal amount,
            Node node) {
        if (ingredient == null || amount == null || amount.signum() <= 0) return;
        MutableSummary summary = destination.get(ingredient.getKey());
        if (summary == null) {
            summary = new MutableSummary(ingredient);
            destination.put(ingredient.getKey(), summary);
        }
        summary.gross = summary.gross.add(amount);
        summary.remaining = summary.remaining.add(amount);
        summary.nodes.add(node);
    }

    private static void allocateByproducts(
            Map<String, MutableSummary> materials,
            Map<String, MutableSummary> byproducts) {
        for (Map.Entry<String, MutableSummary> materialEntry : materials.entrySet()) {
            MutableSummary supply = byproducts.get(materialEntry.getKey());
            if (supply == null || supply.remaining.signum() <= 0) continue;
            MutableSummary demand = materialEntry.getValue();
            BigDecimal used = demand.remaining.min(supply.remaining);
            demand.remaining = demand.remaining.subtract(used);
            supply.remaining = supply.remaining.subtract(used);
        }
    }

    private static List<SummaryEntry> freezeSummaries(Map<String, MutableSummary> source) {
        List<SummaryEntry> result = new ArrayList<SummaryEntry>();
        for (MutableSummary value : source.values()) {
            if (value.remaining.signum() > 0) {
                result.add(new SummaryEntry(value.ingredient, value.gross, value.remaining,
                        value.nodes));
            }
        }
        return result;
    }

    enum TruncationReason {
        DEPTH_LIMIT,
        CHILD_LIMIT,
        NODE_LIMIT
    }

    static final class TruncatedDemand {
        private final RecipeTreeViewerBridge.Ingredient ingredient;
        private final BigDecimal quantityPerCraft;
        private final TruncationReason reason;

        private TruncatedDemand(
                RecipeTreeViewerBridge.Ingredient ingredient,
                BigDecimal quantityPerCraft,
                TruncationReason reason) {
            this.ingredient = ingredient;
            this.quantityPerCraft = quantityPerCraft;
            this.reason = reason;
        }

        RecipeTreeViewerBridge.Ingredient getIngredient() { return ingredient; }
        BigDecimal getQuantityPerCraft() { return quantityPerCraft; }
        TruncationReason getReason() { return reason; }
    }

    static final class FavoriteExpansionBudget {
        private final int maximum;
        private int remaining;
        private int operationDepth;
        private boolean exhaustionLogged;

        FavoriteExpansionBudget(int maximum) {
            if (maximum <= 0) throw new IllegalArgumentException("maximum must be positive");
            this.maximum = maximum;
            this.remaining = maximum;
        }

        void beginOperation() {
            if (operationDepth == 0) {
                remaining = maximum;
                exhaustionLogged = false;
            }
            operationDepth++;
        }

        void endOperation() {
            if (operationDepth <= 0) {
                throw new IllegalStateException("Favorite expansion operation is not active");
            }
            operationDepth--;
        }

        boolean tryConsume() {
            if (operationDepth <= 0) {
                throw new IllegalStateException("Favorite expansion operation is not active");
            }
            if (remaining <= 0) return false;
            remaining--;
            return true;
        }

        boolean markExhaustionLogged() {
            if (exhaustionLogged) return false;
            exhaustionLogged = true;
            return true;
        }

        int getRemaining() { return remaining; }
    }

    static final class Node {
        private RecipeTreeViewerBridge.Ingredient ingredient;
        private final Node parent;
        private BigDecimal demand;
        private BigDecimal quantityPerParentCraft;
        private final List<RecipeTreeViewerBridge.Ingredient> alternatives;
        private final Map<String, BigDecimal> amountByAlternative;
        private int alternativeIndex;
        private BigDecimal outputPerCraft = BigDecimal.ONE;
        private RecipeTreeViewerBridge.Recipe recipe;
        private boolean manualReusableInput;
        private final List<Node> children = new ArrayList<Node>();
        private final List<TruncatedDemand> truncatedDemands =
                new ArrayList<TruncatedDemand>();

        private Node(
                RecipeTreeViewerBridge.Ingredient ingredient,
                BigDecimal demand,
                Node parent,
                BigDecimal quantityPerParentCraft,
                List<RecipeTreeViewerBridge.Ingredient> alternatives,
                Map<String, BigDecimal> amountByAlternative) {
            this.ingredient = ingredient;
            this.demand = positiveOrOne(demand);
            this.parent = parent;
            this.quantityPerParentCraft = quantityPerParentCraft == null
                    ? BigDecimal.ZERO : quantityPerParentCraft;
            this.alternatives = Collections.unmodifiableList(
                    new ArrayList<RecipeTreeViewerBridge.Ingredient>(alternatives));
            this.amountByAlternative = Collections.unmodifiableMap(
                    new LinkedHashMap<String, BigDecimal>(amountByAlternative));
            this.alternativeIndex = alternativeIndex(ingredient.getKey());
            if (this.alternativeIndex < 0) this.alternativeIndex = 0;
        }

        RecipeTreeViewerBridge.Ingredient getIngredient() { return ingredient; }
        Node getParent() { return parent; }
        BigDecimal getDemand() { return demand; }
        BigDecimal getQuantityPerParentCraft() { return quantityPerParentCraft; }
        List<RecipeTreeViewerBridge.Ingredient> getAlternatives() { return alternatives; }
        int getAlternativeIndex() { return alternativeIndex; }
        BigDecimal getOutputPerCraft() { return outputPerCraft; }
        RecipeTreeViewerBridge.Recipe getRecipe() { return recipe; }
        boolean isManualReusableInput() { return manualReusableInput; }
        List<Node> getChildren() { return Collections.unmodifiableList(children); }
        List<TruncatedDemand> getTruncatedDemands() {
            return Collections.unmodifiableList(truncatedDemands);
        }

        BigDecimal crafts() {
            return demand.divide(positiveOrOne(outputPerCraft), 0, RoundingMode.CEILING);
        }

        private int alternativeIndex(String key) {
            for (int index = 0; index < alternatives.size(); index++) {
                if (alternatives.get(index).getKey().equals(key)) return index;
            }
            return -1;
        }

        private void updateDemand(BigDecimal value) {
            demand = positiveOrOne(value);
            for (Node child : children) child.refreshDemandFromParent();
        }

        private void refreshDemandFromParent() {
            if (parent != null) {
                demand = manualReusableInput
                        ? BigDecimal.ONE
                        : quantityPerParentCraft.multiply(parent.crafts());
            }
            for (Node child : children) child.refreshDemandFromParent();
        }
    }

    static final class Summary {
        final List<SummaryEntry> materials;
        final List<SummaryEntry> byproducts;
        final List<ProcessSummary> processes;

        private Summary(
                List<SummaryEntry> materials,
                List<SummaryEntry> byproducts,
                List<ProcessSummary> processes) {
            this.materials = Collections.unmodifiableList(materials);
            this.byproducts = Collections.unmodifiableList(byproducts);
            this.processes = Collections.unmodifiableList(processes);
        }
    }

    static final class SummaryEntry {
        final RecipeTreeViewerBridge.Ingredient ingredient;
        final BigDecimal gross;
        final BigDecimal remaining;
        final List<Node> nodes;

        private SummaryEntry(
                RecipeTreeViewerBridge.Ingredient ingredient,
                BigDecimal gross,
                BigDecimal remaining,
                List<Node> nodes) {
            this.ingredient = ingredient;
            this.gross = gross;
            this.remaining = remaining;
            this.nodes = Collections.unmodifiableList(new ArrayList<Node>(nodes));
        }
    }

    static final class ProcessSummary {
        final String key;
        final String title;
        final RecipeTreeViewerBridge.Ingredient machine;
        BigDecimal crafts;

        private ProcessSummary(
                String key,
                String title,
                RecipeTreeViewerBridge.Ingredient machine,
                BigDecimal crafts) {
            this.key = key;
            this.title = title;
            this.machine = machine;
            this.crafts = crafts;
        }
    }

    private static final class MutableSummary {
        private final RecipeTreeViewerBridge.Ingredient ingredient;
        private BigDecimal gross = BigDecimal.ZERO;
        private BigDecimal remaining = BigDecimal.ZERO;
        private final List<Node> nodes = new ArrayList<Node>();

        private MutableSummary(RecipeTreeViewerBridge.Ingredient ingredient) {
            this.ingredient = ingredient;
        }
    }

    private static final class InputGroup {
        private List<RecipeTreeViewerBridge.Ingredient> alternatives;
        private final Map<String, BigDecimal> amounts =
                new LinkedHashMap<String, BigDecimal>();

        private InputGroup(List<RecipeTreeViewerBridge.Ingredient> alternatives) {
            LinkedHashMap<String, RecipeTreeViewerBridge.Ingredient> unique =
                    new LinkedHashMap<String, RecipeTreeViewerBridge.Ingredient>();
            for (RecipeTreeViewerBridge.Ingredient ingredient : alternatives) {
                if (ingredient == null) continue;
                unique.put(ingredient.getKey(), ingredient);
                amounts.put(ingredient.getKey(), ingredient.getAmount());
            }
            this.alternatives = new ArrayList<RecipeTreeViewerBridge.Ingredient>(unique.values());
        }

        private boolean canShareWith(InputGroup other) {
            for (RecipeTreeViewerBridge.Ingredient ingredient : alternatives) {
                if (other.amounts.containsKey(ingredient.getKey())) return true;
            }
            return false;
        }

        private void share(InputGroup other) {
            List<RecipeTreeViewerBridge.Ingredient> shared =
                    new ArrayList<RecipeTreeViewerBridge.Ingredient>();
            Map<String, BigDecimal> sharedAmounts = new LinkedHashMap<String, BigDecimal>();
            for (RecipeTreeViewerBridge.Ingredient ingredient : alternatives) {
                BigDecimal otherAmount = other.amounts.get(ingredient.getKey());
                if (otherAmount == null) continue;
                shared.add(ingredient);
                sharedAmounts.put(ingredient.getKey(),
                        amounts.get(ingredient.getKey()).add(otherAmount));
            }
            alternatives = shared;
            amounts.clear();
            amounts.putAll(sharedAmounts);
        }
    }
}
