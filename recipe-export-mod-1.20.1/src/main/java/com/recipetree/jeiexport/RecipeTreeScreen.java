package com.recipetree.jeiexport;

import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import java.io.IOException;
import net.minecraft.Util;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.forge.ForgeTypes;
import mezz.jei.api.gui.drawable.IDrawable;
import mezz.jei.api.gui.IRecipeLayoutDrawable;
import mezz.jei.api.gui.ingredient.IRecipeSlotDrawable;
import mezz.jei.api.gui.ingredient.IRecipeSlotView;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRenderer;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.recipe.IFocus;
import mezz.jei.api.recipe.IFocusGroup;
import mezz.jei.api.recipe.RecipeIngredientRole;
import mezz.jei.api.recipe.category.IRecipeCategory;
import mezz.jei.api.ingredients.subtypes.UidContext;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.client.renderer.Rect2i;
import net.minecraft.client.renderer.texture.TextureAtlasSprite;
import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.minecraftforge.client.extensions.common.IClientFluidTypeExtensions;
import net.minecraftforge.fluids.FluidStack;
import net.minecraftforge.fml.loading.FMLPaths;
import org.joml.Matrix4f;
import org.lwjgl.glfw.GLFW;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Lightweight, lazy in-game planner. JEI remains the recipe renderer and source of truth. */
public final class RecipeTreeScreen extends Screen {
    private static final Gson SHARE_GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final String SHARE_FORMAT = "minecraft-recipe-tree";
    private static final int SHARE_VERSION = 1;
    private static final int MAX_SHARE_BYTES = 1_048_576;
    private static final int PANEL_MARGIN = 8;
    private static final int JEI_RECIPE_BORDER_PADDING = 4;
    private static final int MAX_AUTOMATIC_FAVORITE_EXPANSIONS = 128;
    private static final int TREE_NODE_GAP = 12;
    private static final int TREE_LEVEL_GAP = 24;
    private static final int RECIPE_AMOUNT_GAP = 4;
    private static final int RECIPE_AMOUNT_HEIGHT = 12;
    private static final int INSPECTOR_PANEL_WIDTH = 180;
    private static final int SUMMARY_ROW_HEIGHT = 20;
    private static final int SUMMARY_GRID_CELL_SIZE = 28;
    private static final int SUMMARY_GRID_GAP = 4;
    private static final int SUMMARY_GRID_PADDING = 4;
    private static final int MAX_CACHED_RECIPE_AVAILABILITY = 2048;
    private static final int MAX_STARTING_NODES = 16;
    private static final int STARTING_NODE_GAP = 48;
    private static final int MULTI_OPTION_BACKGROUND = 0xff263f50;
    private static final int MULTI_OPTION_HOVER_BACKGROUND = 0xff3f657b;
    private static final int MULTI_OPTION_DISCOVERED_BACKGROUND = 0xff24534f;
    private static final int MULTI_OPTION_DISCOVERED_HOVER_BACKGROUND = 0xff36756e;
    private static final int MULTI_OPTION_NO_RECIPE_BACKGROUND = 0xff38434d;
    private static final int MULTI_OPTION_NO_RECIPE_HOVER_BACKGROUND = 0xff506170;
    private static final int MULTI_OPTION_BORDER = 0xff55cbe8;
    private static final int MULTI_OPTION_HOVER_BORDER = 0xffa4efff;
    private static final int[] PROCESS_COLORS = {
            0xff66c2a5, 0xfffc8d62, 0xff8da0cb, 0xffe78ac3,
            0xffa6d854, 0xffffd92f, 0xffe5c494, 0xff80b1d3
    };
    private static final ClassValue<Optional<Method>> RECIPE_LAYOUT_TICK_METHOD =
            new ClassValue<>() {
                @Override
                protected Optional<Method> computeValue(Class<?> type) {
                    try {
                        return Optional.of(type.getMethod("tick"));
                    } catch (NoSuchMethodException ignored) {
                        return Optional.empty();
                    }
                }
            };
    private static final ClassValue<Optional<Method>> RECIPE_LAYOUT_BORDER_METHOD =
            new ClassValue<>() {
                @Override
                protected Optional<Method> computeValue(Class<?> type) {
                    try {
                        return Optional.of(type.getMethod("getRectWithBorder"));
                    } catch (NoSuchMethodException ignored) {
                        return Optional.empty();
                    }
                }
            };

    private ItemStack target;
    private final IJeiRuntime runtime;
    private IFocus<ItemStack> targetFocus;
    private List<ItemStack> path;
    private final OutputHistory history;
    private final List<RecipePage<?>> pages = new ArrayList<>();
    private final RecipeTreeProgress progress = RecipeTreeProgress.get();
    private final Set<String> loggedAmountFallbackTypes = new HashSet<>();
    private final Set<ResourceLocation> loggedFluidRenderFallbacks = new HashSet<>();
    private final Set<String> loggedSummaryKeyFallbackTypes = new HashSet<>();
    private final Set<String> loggedByproductOutputFallbackRecipes = new HashSet<>();
    private final Set<String> loggedByproductLinkLayoutFailures = new HashSet<>();
    private final Set<String> loggedSupplementalInputFailures = new HashSet<>();

    private List<TreeNode> treeNodes = List.of();
    private List<RecipeBoxHitbox> recipeBoxes = List.of();
    private List<StartingNodeRemoveHitbox> startingNodeRemoveButtons = List.of();
    private List<RecipePage<?>> visibleRecipePages = List.of();
    private CompactTreeLayout cachedTreeLayout;
    private boolean treeLayoutDirty = true;
    private PlanNode rootNode;
    private final List<PlanNode> startingNodes = new ArrayList<>();
    private float treeZoom = 1.0f;
    private double treePanX;
    private double treePanY;
    private boolean treeViewInitialized;
    private boolean treePanning;
    private int treeViewportLeft;
    private int treeViewportTop;
    private int treeViewportRight;
    private int treeViewportBottom;
    private SummaryPanelBounds summaryPanelArea;
    private SummarySectionBounds materialSummaryArea;
    private SummarySectionBounds byproductSummaryArea;
    private SummarySectionBounds processSummaryArea;
    private List<SummaryRowHitbox> summaryRows = List.of();
    private List<ProcessRowHitbox> processRows = List.of();
    private List<InspectorTabHitbox> inspectorTabs = List.of();
    private InspectorTab inspectorTab = InspectorTab.TYPES;
    private PlanNode previewNode;
    private PlanSummary planSummary = PlanSummary.empty();
    private boolean planSummaryDirty = true;
    private int materialSummaryScroll;
    private int byproductSummaryScroll;
    private int processSummaryScroll;
    private final Map<String, Integer> byproductCenterIndices = new LinkedHashMap<>();
    private String selectedProcessKey;
    private final LinkedHashMap<String, Boolean> noRecipeCache =
            new LinkedHashMap<>(128, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > MAX_CACHED_RECIPE_AVAILABILITY;
                }
            };
    private int pageIndex;
    private int panelLeft;
    private int panelTop;
    private int panelWidth;
    private int panelHeight;
    private int treeViewportTopOffset = 60;
    private int amountLabelX;
    private int amountLabelY;
    private boolean compactMode;
    private String requestedAmount = "1";
    private EditBox amountBox;
    private Button previousButton;
    private Button historyButton;
    private Button nextButton;
    private Button modeButton;
    private Button useByproductsButton;
    private Button recipeBookButton;
    private boolean centerTreeRequested;
    private boolean useByproducts = true;
    private boolean recipeBookMode;
    private final Map<String, List<RecipePage<?>>> recipeQueryCache = new LinkedHashMap<>(64, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, List<RecipePage<?>>> entry) { return size() > 128; }
    };
    private int availabilityQueriesRemaining;
    private boolean restoringHistory;
    private SummarySectionBounds reusableToggleArea;
    private SummarySectionBounds byproductsToggleArea;
    private PlanNode inspectedNode;
    private int favoriteExpansionAttemptsRemaining = MAX_AUTOMATIC_FAVORITE_EXPANSIONS;
    private String status = "";

    public RecipeTreeScreen(ItemStack target, IJeiRuntime runtime) {
        this(target, runtime, List.of(target.copyWithCount(1)), false, null, new OutputHistory(runtime), true);
    }

    static RecipeTreeScreen restoreLastViewed(IJeiRuntime runtime) {
        return new OutputHistory(runtime).current();
    }

    private RecipeTreeScreen(
            ItemStack target,
            IJeiRuntime runtime,
            List<ItemStack> path,
            boolean compactMode,
            String preferredRecipeKey,
            OutputHistory history,
            boolean addToHistory) {
        super(Component.translatable("screen.jeiexport.recipe_tree"));
        this.restoringHistory = !addToHistory;
        this.target = target.copyWithCount(1);
        this.runtime = runtime;
        this.path = path.stream().map(stack -> stack.copyWithCount(1)).toList();
        this.history = history;
        this.compactMode = compactMode;
        this.recipeBookMode = progress.recipeBookMode();
        this.targetFocus = runtime.getJeiHelpers().getFocusFactory().createFocus(
                RecipeIngredientRole.OUTPUT, VanillaTypes.ITEM_STACK, this.target);
        collectPages();
        restorePlan();
        if (!selectRecipe(preferredRecipeKey)) {
            selectRecipe(progress.favoriteRecipe(this.target));
        }
        this.rootNode = new PlanNode(this.target, requestedQuantity(), null, 0);
        this.startingNodes.add(this.rootNode);
        currentPage()
                .filter(page -> page.layout().isPresent())
                .ifPresent(rootNode::setRecipe);
        this.previewNode = this.rootNode;
        this.restoringHistory = false;
        if (addToHistory) history.push(this);
    }

    private RecipeTreeProgress.RecipeHistoryEntry historyEntry() {
        String recipeKey = rootNode != null && rootNode.recipe != null
                ? rootNode.recipe.key
                : null;
        return RecipeTreeProgress.historyEntry(
                target,
                recipeKey,
                requestedQuantity(),
                compactMode,
                startingNodes.stream().mapToInt(this::treeDepth).max().orElse(1),
                historyRoots(),
                historySelections());
    }

    private List<RecipeTreeProgress.RecipeHistoryRoot> historyRoots() {
        return startingNodes.stream()
                .map(node -> new RecipeTreeProgress.RecipeHistoryRoot(
                        ingredientKey(node.ingredient),
                        ingredientDisplayName(node.ingredient),
                        node.recipe == null ? null : node.recipe.key,
                        node.quantity))
                .toList();
    }

    private List<RecipeTreeProgress.RecipeHistorySelection> historySelections() {
        if (startingNodes.isEmpty()) return List.of();
        List<RecipeTreeProgress.RecipeHistorySelection> selections = new ArrayList<>();
        for (int rootIndex = 0; rootIndex < startingNodes.size(); rootIndex++) {
            appendHistorySelection(selections, startingNodes.get(rootIndex), rootIndex, List.of());
        }
        return List.copyOf(selections);
    }

    private void appendHistorySelection(
            List<RecipeTreeProgress.RecipeHistorySelection> selections,
            PlanNode node,
            int rootIndex,
            List<Integer> path) {
        selections.add(new RecipeTreeProgress.RecipeHistorySelection(
                rootIndex,
                List.copyOf(path),
                ingredientKey(node.ingredient),
                ingredientDisplayName(node.ingredient),
                node.recipe == null ? null : node.recipe.key,
                node.recipe == null ? null : node.recipe.category.getTitle().getString(),
                node.manualReusableInput));
        for (int index = 0; index < node.children.size(); index++) {
            List<Integer> childPath = new ArrayList<>(path);
            childPath.add(index);
            appendHistorySelection(selections, node.children.get(index), rootIndex, childPath);
        }
    }

    private TreeComparisonData comparisonData() {
        PlanSummary summary = calculatePlanSummary(false);
        Map<String, ComparisonValue> materials = new LinkedHashMap<>();
        for (IngredientSummary material : summary.materials) {
            materials.put(summaryIngredientKey(material.ingredient), new ComparisonValue(
                    ingredientDisplayName(material.ingredient),
                    material.remaining));
        }
        Map<String, ComparisonValue> byproducts = new LinkedHashMap<>();
        for (IngredientSummary byproduct : summary.byproducts) {
            byproducts.put(summaryIngredientKey(byproduct.ingredient), new ComparisonValue(
                    ingredientDisplayName(byproduct.ingredient),
                    byproduct.remaining));
        }
        Map<String, ComparisonValue> processes = new LinkedHashMap<>();
        for (ProcessSummary process : summary.processes) {
            processes.put(process.key, new ComparisonValue(process.title, process.crafts));
        }
        return new TreeComparisonData(
                target.getHoverName().getString(),
                requestedQuantity(),
                startingNodes.stream().mapToInt(this::treeDepth).max().orElse(1),
                historySelections(),
                Map.copyOf(materials),
                Map.copyOf(byproducts),
                Map.copyOf(processes));
    }

    private int treeDepth(PlanNode node) {
        if (node == null) return 0;
        return 1 + node.children.stream()
                .mapToInt(this::treeDepth)
                .max()
                .orElse(0);
    }

    private void applyHistoryAmount(long amount) {
        requestedAmount = Long.toString(Math.min(
                RecipeQuantityMath.MAX_REQUESTED_AMOUNT,
                Math.max(1, amount)));
        startingNodes.forEach(node -> node.updateQuantity(requestedQuantity()));
    }

    private void applyHistoryRoots(List<RecipeTreeProgress.RecipeHistoryRoot> roots) {
        startingNodes.clear();
        List<RecipeTreeProgress.RecipeHistoryRoot> savedRoots = roots == null || roots.isEmpty()
                ? List.of(new RecipeTreeProgress.RecipeHistoryRoot(
                        ingredientKey(rootNode.ingredient),
                        ingredientDisplayName(rootNode.ingredient),
                        rootNode.recipe == null ? null : rootNode.recipe.key,
                        requestedQuantity()))
                : roots.stream().limit(MAX_STARTING_NODES).toList();
        for (RecipeTreeProgress.RecipeHistoryRoot savedRoot : savedRoots) {
            ItemStack stack = itemForPortableKey(savedRoot.ingredientKey());
            if (stack.isEmpty()) continue;
            PlanNode node = new PlanNode(stack, Math.max(1, savedRoot.amount()), null, 0);
            if (savedRoot.recipeKey() != null && !savedRoot.recipeKey().isBlank()) {
                collectPagesFor(node.ingredient, RecipeIngredientRole.OUTPUT).stream()
                        .filter(page -> page.key.equals(savedRoot.recipeKey()))
                        .filter(page -> page.layout().isPresent())
                        .findFirst()
                        .ifPresent(node::setRecipe);
            }
            startingNodes.add(node);
        }
        if (startingNodes.isEmpty()) startingNodes.add(rootNode);
        rootNode = startingNodes.get(0);
        previewNode = rootNode;
        invalidateTreeLayout();
        invalidatePlanSummary();
    }

    private void applyHistorySelections(
            List<RecipeTreeProgress.RecipeHistorySelection> selections) {
        if (selections == null || selections.isEmpty()) return;
        if (startingNodes.isEmpty()) {
            rootNode = new PlanNode(target, requestedQuantity(), null, 0);
            startingNodes.add(rootNode);
        }
        previewNode = rootNode;
        invalidateTreeLayout();
        for (RecipeTreeProgress.RecipeHistorySelection selection : selections) {
            if (selection == null || selection.path() == null) continue;
            PlanNode node;
            try {
                node = nodeAtImportedPath(selection.rootIndex(), selection.path());
            } catch (IllegalArgumentException ignored) {
                continue;
            }
            if (!ingredientKey(node.ingredient).equals(selection.ingredientKey())) {
                for (int option = 0; option < node.ingredientOptions.size(); option++) {
                    if (ingredientKey(node.ingredientOptions.get(option))
                            .equals(selection.ingredientKey())) {
                        node.selectIngredientOption(option, false);
                        break;
                    }
                }
            }
            if (!ingredientKey(node.ingredient).equals(selection.ingredientKey())) continue;
            restoreReusable(node, selection.reusableInput());
            if (selection.recipeKey() == null || selection.recipeKey().isBlank()) {
                node.clearRecipe();
                continue;
            }
            collectPagesFor(node.ingredient, RecipeIngredientRole.OUTPUT).stream()
                    .filter(page -> page.key.equals(selection.recipeKey()))
                    .filter(page -> page.layout().isPresent())
                    .findFirst()
                    .ifPresent(node::setRecipe);
            if (selection.rootIndex() == 0 && selection.path().isEmpty()) {
                selectRecipe(selection.recipeKey());
            }
        }
        startingNodes.forEach(root -> root.updateQuantity(root.quantity));
        invalidatePlanSummary();
        treeNodes = List.of();
        recipeBoxes = List.of();
        treeViewInitialized = false;
        treeZoom = 1.0f;
    }

    @Override
    protected void init() {
        RecipeTreeClient.rememberTree(this);
        panelWidth = Math.max(1, width - PANEL_MARGIN * 2);
        panelHeight = Math.max(1, height - PANEL_MARGIN * 2);
        panelLeft = (width - panelWidth) / 2;
        panelTop = (height - panelHeight) / 2;
        int left = panelLeft + 12;
        int firstRowY = panelTop + 32;
        ToolbarFlow toolbar = new ToolbarFlow(
                left,
                panelLeft + panelWidth - 12,
                firstRowY);
        ToolbarPlacement placement = toolbar.place(22);
        previousButton = addRenderableWidget(Button.builder(Component.literal("<"), button -> navigateHistory(-1))
                .bounds(placement.left, placement.top, placement.width, 20).build());
        placement = toolbar.place(22);
        historyButton = addRenderableWidget(Button.builder(Component.empty(), button -> openHistory())
                .bounds(placement.left, placement.top, placement.width, 20).build());
        placement = toolbar.place(22);
        nextButton = addRenderableWidget(Button.builder(Component.literal(">"), button -> navigateHistory(1))
                .bounds(placement.left, placement.top, placement.width, 20).build());
        placement = toolbar.place(78);
        addRenderableWidget(Button.builder(Component.translatable("button.jeiexport.open_jei"), button -> openJei())
                .bounds(placement.left, placement.top, placement.width, 20).build());

        placement = toolbar.place(90);
        amountLabelX = placement.left;
        amountLabelY = placement.top + 6;
        amountBox = numericBox(
                placement.left + 28,
                placement.top,
                62,
                "Requested output",
                requestedAmount);
        amountBox.setResponder(this::changeRequestedAmount);
        placement = toolbar.place(78);
        modeButton = addRenderableWidget(Button.builder(Component.empty(), button -> toggleMode())
                .bounds(placement.left, placement.top, placement.width, 20).build());

        placement = toolbar.place(104);
        addRenderableWidget(Button.builder(Component.literal("Import / Export"),
                        button -> minecraft.setScreen(new TransferScreen()))
                .bounds(placement.left, placement.top, placement.width, 20).build());
        placement = toolbar.place(58);
        addRenderableWidget(Button.builder(Component.literal("Center"), button -> centerTree())
                .bounds(placement.left, placement.top, placement.width, 20).build());
        placement = toolbar.place(108);
        recipeBookButton = addRenderableWidget(Button.builder(
                        Component.empty(), button -> toggleRecipeBook())
                .bounds(placement.left, placement.top, placement.width, 20).build());

        int nextTreeViewportTopOffset = 60 + toolbar.maximumRow() * 24;
        if (treeViewportTopOffset != nextTreeViewportTopOffset) treeViewInitialized = false;
        treeViewportTopOffset = nextTreeViewportTopOffset;
        updateButtons();
    }

    private EditBox numericBox(int x, int y, int boxWidth, String narration, String value) {
        EditBox box = new EditBox(font, x, y, boxWidth, 20, Component.literal(narration));
        box.setValue(value);
        box.setFilter(text -> text.isEmpty()
                || (text.matches("[0-9]{1,3}")
                && Long.parseLong(text) <= RecipeQuantityMath.MAX_REQUESTED_AMOUNT));
        return addRenderableWidget(box);
    }

    private void changeRequestedAmount(String value) {
        requestedAmount = value;
        status = "";
        try {
            long quantity = parseLong(value);
            if (quantity > 0
                    && quantity <= RecipeQuantityMath.MAX_REQUESTED_AMOUNT
                    && !startingNodes.isEmpty()) {
                startingNodes.forEach(node -> node.updateQuantity(quantity));
            }
        } catch (IllegalArgumentException ignored) {
            // Keep the last valid tree totals while the player edits an empty or invalid value.
        }
    }

    private long requestedQuantity() {
        try {
            return Math.min(
                    RecipeQuantityMath.MAX_REQUESTED_AMOUNT,
                    Math.max(1, parseLong(requestedAmount)));
        } catch (IllegalArgumentException ignored) {
            return 1;
        }
    }

    @Override
    public void tick() {
        super.tick();
        visibleRecipePages.forEach(page -> page.layout().ifPresent(this::tickRecipeLayout));
    }

    private void tickRecipeLayout(IRecipeLayoutDrawable<?> layout) {
        RECIPE_LAYOUT_TICK_METHOD.get(layout.getClass()).ifPresent(method -> {
            try {
                method.invoke(layout);
            } catch (ReflectiveOperationException error) {
                JeiExportMod.LOGGER.debug("Recipe viewer layout tick failed", error);
            }
        });
    }

    private Rect2i recipeRectWithBorder(IRecipeLayoutDrawable<?> layout) {
        Optional<Method> method = RECIPE_LAYOUT_BORDER_METHOD.get(layout.getClass());
        if (method.isPresent()) {
            try {
                Object value = method.get().invoke(layout);
                if (value instanceof Rect2i rect) return rect;
            } catch (ReflectiveOperationException error) {
                JeiExportMod.LOGGER.debug("Recipe viewer border bounds failed", error);
            }
        }
        Rect2i rect = layout.getRect();
        return new Rect2i(
                rect.getX() - JEI_RECIPE_BORDER_PADDING,
                rect.getY() - JEI_RECIPE_BORDER_PADDING,
                rect.getWidth() + JEI_RECIPE_BORDER_PADDING * 2,
                rect.getHeight() + JEI_RECIPE_BORDER_PADDING * 2);
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
        renderBackground(graphics);
        graphics.fill(panelLeft, panelTop, panelLeft + panelWidth, panelTop + panelHeight, 0xf0181a1b);
        graphics.fill(panelLeft, panelTop, panelLeft + panelWidth, panelTop + 2, 0xff69a847);

        reusableToggleArea = null;
        byproductsToggleArea = null;
        renderTree(graphics, mouseX, mouseY);

        graphics.pose().pushPose();
        graphics.pose().translate(0, 0, 500);
        graphics.renderItem(target, panelLeft + 12, panelTop + 9);
        if (isUndiscovered(target)) {
            graphics.drawString(font, "?", panelLeft + 25, panelTop + 7, 0xff8fc1ff, false);
        }
        String rootLabel = target.getHoverName().getString()
                + (startingNodes.size() > 1 ? " +" + (startingNodes.size() - 1) : "");
        String targetName = font.plainSubstrByWidth(
                rootLabel, Math.max(40, panelWidth / 2 - 54));
        graphics.drawString(font, targetName, panelLeft + 34, panelTop + 13, 0xffffffff, false);

        Optional<RecipePage<?>> current = currentPage();
        String pageText = pages.isEmpty() ? "No JEI recipe" : (pageIndex + 1) + " / " + pages.size();
        int pageX = panelLeft + (panelWidth - font.width(pageText)) / 2;
        graphics.drawString(font, pageText, pageX, panelTop + 13, 0xffaeb7aa, false);
        current.ifPresent(page -> {
            Component title = page.category.getTitle();
            int maxTitleWidth = Math.min(compactMode ? 112 : 150, Math.max(40, panelWidth / 3));
            String categoryTitle = font.plainSubstrByWidth(title.getString(), maxTitleWidth);
            graphics.drawString(font, categoryTitle,
                    panelLeft + panelWidth - 12 - font.width(categoryTitle), panelTop + 13, 0xffd7e6ce, false);
        });

        graphics.drawString(font, "AMT", amountLabelX, amountLabelY, 0xff8f9b8b, false);

        super.render(graphics, mouseX, mouseY, partialTick);
        renderHistoryClock(graphics);

        if (!status.isEmpty()) {
            graphics.fill(panelLeft + 1, panelTop + panelHeight - 22,
                    panelLeft + panelWidth - 1, panelTop + panelHeight - 1, 0xf0181a1b);
            graphics.drawCenteredString(font, status, width / 2, panelTop + panelHeight - 14, 0xff9fcf7f);
        }
        graphics.pose().popPose();
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (!(getFocused() instanceof EditBox) && keyCode == org.lwjgl.glfw.GLFW.GLFW_KEY_R && inspectedNode != null) {
            toggleReusable(inspectedNode);
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    private void toggleReusable(PlanNode node) {
        if (node.parent == null || node.parent.recipe == null) return;
        history.beginEdit(this);
        boolean reusable = !node.manualReusableInput;
        progress.setReusableInputs(node.parent.recipe.key,
                node.ingredientOptions.stream().map(this::ingredientKey).toList(), reusable);
        startingNodes.forEach(root -> updateReusablePreference(root, node.parent.recipe.key, node.ingredientOptions, reusable));
        startingNodes.forEach(root -> root.updateQuantity(root.quantity));
        invalidateTreeLayout();
        invalidatePlanSummary();
        history.finishEdit(this);
        status = "Reusable input " + (reusable ? "enabled" : "disabled");
    }

    private void updateReusablePreference(PlanNode node, String recipe, List<ITypedIngredient<?>> options, boolean reusable) {
        if (node.parent != null && node.parent.recipe != null && node.parent.recipe.key.equals(recipe)
                && options.stream().anyMatch(option -> sameIngredient(option, node.ingredient))) {
            restoreReusable(node, reusable);
        }
        node.children.forEach(child -> updateReusablePreference(child, recipe, options, reusable));
    }

    private void restoreReusable(PlanNode node, boolean reusable) {
        if (node.parent == null) return;
        node.reusableOverride = reusable;
        node.refreshReusable();
    }

    private void renderHistoryClock(GuiGraphics graphics) {
        if (historyButton == null || !historyButton.visible) return;
        int centerX = historyButton.getX() + historyButton.getWidth() / 2;
        int centerY = historyButton.getY() + historyButton.getHeight() / 2;
        int left = centerX - 8;
        int top = centerY - 8;
        int color = historyButton.active ? 0xffffffff : 0xffa0a0a0;

        renderHistoryClockShape(graphics, left + 1, top + 1, 0xff3f3f3f);
        renderHistoryClockShape(graphics, left, top, color);
    }

    private void renderHistoryClockShape(GuiGraphics graphics, int left, int top, int color) {
        // Exact 16x16 clock outline with simple L-shaped hands.
        graphics.fill(left + 5, top, left + 11, top + 1, color);
        graphics.fill(left + 3, top + 1, left + 5, top + 2, color);
        graphics.fill(left + 11, top + 1, left + 13, top + 2, color);
        graphics.fill(left + 2, top + 2, left + 3, top + 4, color);
        graphics.fill(left + 13, top + 2, left + 14, top + 4, color);
        graphics.fill(left + 1, top + 4, left + 2, top + 6, color);
        graphics.fill(left + 14, top + 4, left + 15, top + 6, color);
        graphics.fill(left, top + 6, left + 1, top + 10, color);
        graphics.fill(left + 15, top + 6, left + 16, top + 10, color);
        graphics.fill(left + 1, top + 10, left + 2, top + 12, color);
        graphics.fill(left + 14, top + 10, left + 15, top + 12, color);
        graphics.fill(left + 2, top + 12, left + 3, top + 14, color);
        graphics.fill(left + 13, top + 12, left + 14, top + 14, color);
        graphics.fill(left + 3, top + 14, left + 5, top + 15, color);
        graphics.fill(left + 11, top + 14, left + 13, top + 15, color);
        graphics.fill(left + 5, top + 15, left + 11, top + 16, color);
        graphics.fill(left + 7, top + 4, left + 9, top + 9, color);
        graphics.fill(left + 8, top + 8, left + 12, top + 10, color);
    }

    private void renderTree(GuiGraphics graphics, int mouseX, int mouseY) {
        availabilityQueriesRemaining = 8;
        treeViewportLeft = panelLeft + 8;
        int contentRight = panelLeft + panelWidth - 8;
        treeViewportBottom = panelTop + panelHeight - 8;
        treeViewportTop = Math.min(panelTop + treeViewportTopOffset, treeViewportBottom - 1);
        int availableWidth = Math.max(1, contentRight - treeViewportLeft);
        int summaryWidth = Math.min(INSPECTOR_PANEL_WIDTH, Math.max(1, availableWidth / 3));
        treeViewportRight = Math.max(treeViewportLeft + 1, contentRight - summaryWidth - 6);
        summaryPanelArea = new SummaryPanelBounds(
                treeViewportRight + 6,
                treeViewportTop,
                Math.max(1, contentRight - treeViewportRight - 6),
                Math.max(1, treeViewportBottom - treeViewportTop));
        int viewportWidth = Math.max(1, treeViewportRight - treeViewportLeft);
        PlanSummary summary = currentPlanSummary();

        CompactTreeLayout treeLayout = currentTreeLayout();
        int contentWidth = treeLayout.width;
        List<TreeLayoutNode> layoutNodes = treeLayout.nodes;
        if (centerTreeRequested) {
            int viewportHeight = Math.max(1, treeViewportBottom - treeViewportTop);
            treePanX = (viewportWidth - contentWidth * treeZoom) / 2.0;
            treePanY = (viewportHeight - treeLayout.height * treeZoom) / 2.0;
            treeViewInitialized = true;
            centerTreeRequested = false;
        } else if (!treeViewInitialized) {
            treePanX = Math.max(8, (viewportWidth - contentWidth) / 2.0);
            treePanY = 8;
            treeViewInitialized = true;
        }

        double modelMouseX = toTreeX(mouseX);
        double modelMouseY = toTreeY(mouseY);
        PlanNode hoveredByproductEndpoint = insideTreeViewport(mouseX, mouseY)
                ? layoutNodes.stream()
                        .filter(node -> modelMouseX >= node.left
                                && modelMouseX < node.left + node.width
                                && modelMouseY >= node.top
                                && modelMouseY < node.top + node.height)
                        .map(TreeLayoutNode::node)
                        .findFirst()
                        .orElse(null)
                : null;
        List<TreeNode> nodes = new ArrayList<>();
        List<RecipeBoxHitbox> boxes = new ArrayList<>();
        graphics.enableScissor(treeViewportLeft, treeViewportTop, treeViewportRight, treeViewportBottom);
        graphics.pose().pushPose();
        graphics.pose().translate(treeViewportLeft + treePanX, treeViewportTop + treePanY, 0);
        graphics.pose().scale(treeZoom, treeZoom, 1.0f);

        for (TreeLayoutNode layoutNode : layoutNodes) {
            if (layoutNode.parentIndex < 0) continue;
            TreeLayoutNode parent = layoutNodes.get(layoutNode.parentIndex);
            int parentX = parent.left + parent.width / 2;
            int parentBottom = parent.top + parent.height;
            int parentContentBottom = parent.top + nodeContentHeight(parent.node);
            int childX = layoutNode.left + layoutNode.width / 2;
            int childTop = layoutNode.top;
            int branchY = parentBottom + Math.max(8, (childTop - parentBottom) / 2);
            if (!treeModelBoundsVisible(
                    Math.min(parentX, childX),
                    Math.min(parentContentBottom, parentBottom),
                    Math.abs(parentX - childX) + 1,
                    Math.max(1, childTop - Math.min(parentContentBottom, parentBottom) + 1))) {
                continue;
            }
            if (parentContentBottom < parentBottom) {
                graphics.fill(parentX, parentContentBottom, parentX + 1, parentBottom + 1, 0xff52624d);
            }
            graphics.fill(parentX, parentBottom, parentX + 1, branchY + 1, 0xff52624d);
            graphics.fill(Math.min(parentX, childX), branchY, Math.max(parentX, childX) + 1,
                    branchY + 1, 0xff52624d);
            graphics.fill(childX, branchY, childX + 1, childTop + 1, 0xff52624d);
        }

        renderByproductLinks(
                graphics,
                summary.links,
                treeLayout,
                contentWidth,
                hoveredByproductEndpoint);

        for (TreeLayoutNode layoutNode : layoutNodes) {
            if (!treeModelBoundsVisible(
                    layoutNode.left, layoutNode.top, layoutNode.width, layoutNode.height)) {
                continue;
            }
            PlanNode node = layoutNode.node;
            if (!compactMode && node.recipe != null && !isRecipeBookCollapsed(node)) {
                IRecipeLayoutDrawable<?> recipeLayout = node.recipe.requireLayout();
                recipeLayout.setPosition(0, 0);
                Rect2i originBounds = recipeRectWithBorder(recipeLayout);
                int recipeLeft = layoutNode.left - originBounds.getX();
                int recipeTop = layoutNode.top - originBounds.getY();
                recipeLayout.setPosition(recipeLeft, recipeTop);
                recipeLayout.drawRecipe(graphics, (int) modelMouseX, (int) modelMouseY);
                Rect2i rect = recipeRectWithBorder(recipeLayout);
                renderProcessAccent(
                        graphics,
                        node,
                        rect.getX(),
                        rect.getY(),
                        rect.getWidth(),
                        rect.getHeight());
                if (isUndiscovered(node)) {
                    graphics.fill(rect.getX(), rect.getY(),
                            rect.getX() + rect.getWidth(), rect.getY() + rect.getHeight(),
                            0x30070d18);
                    graphics.fill(rect.getX(), rect.getY(),
                            rect.getX() + rect.getWidth(), rect.getY() + 1, 0xff6fa8ff);
                    graphics.drawString(font, "?",
                            rect.getX() + rect.getWidth() - 7, rect.getY() + 2,
                            0xff8fc1ff, false);
                }
                ByproductCoverage nodeCoverage = summary.coverage.get(node);
                if (useByproducts
                        && nodeCoverage != null
                        && nodeCoverage.amount >= nodeCoverage.request) {
                    graphics.fill(rect.getX(), rect.getY(),
                            rect.getX() + rect.getWidth(), rect.getY() + rect.getHeight(),
                            0x3026a65b);
                    graphics.fill(rect.getX(), rect.getY(),
                            rect.getX() + rect.getWidth(), rect.getY() + 2,
                            0xff70db8c);
                }
                long displayedQuantity = node.quantity;
                if (displayedQuantity > 1) {
                    String count = formatQuantity(node, displayedQuantity);
                    int countTop = rect.getY() + rect.getHeight() + RECIPE_AMOUNT_GAP;
                    int countCenter = rect.getX() + rect.getWidth() / 2;
                    int countLeft = countCenter - font.width(count) / 2;
                    graphics.fill(countLeft - 2, countTop - 1,
                            countLeft + font.width(count) + 2, countTop + 10,
                            0xe0181a1b);
                    graphics.drawCenteredString(font, count, countCenter, countTop, 0xffffffff);
                }
                boxes.add(canvasRecipeHitbox(
                        node,
                        node.recipe,
                        rect,
                        recipeLeft,
                        recipeTop));
            } else {
                int size = layoutNode.width;
                renderNode(graphics, node, layoutNode.left, layoutNode.top, size,
                        visibleQuantity(node), (int) modelMouseX, (int) modelMouseY);
                renderProcessAccent(
                        graphics,
                        node,
                        layoutNode.left,
                        layoutNode.top,
                        size,
                        Math.min(size, nodeContentHeight(node)));
                nodes.add(canvasTreeHitbox(node, layoutNode.left, layoutNode.top, size));
            }
        }
        graphics.pose().popPose();
        graphics.disableScissor();

        renderPanOverview(graphics, treeLayout);

        Optional<TreeNode> hoveredNode = insideTreeViewport(mouseX, mouseY)
                ? nodes.stream().filter(node -> node.contains(mouseX, mouseY)).findFirst()
                : Optional.empty();
        PlanNode hoveredPlanNode = hoveredNode.map(node -> node.node).orElseGet(() -> boxes.stream()
                .filter(box -> box.contains(mouseX, mouseY))
                .map(box -> box.node)
                .findFirst()
                .orElse(null));
        if (hoveredPlanNode != null) {
            previewNode = hoveredPlanNode;
        }
        renderInspectorPanel(graphics, summary, mouseX, mouseY, boxes, hoveredPlanNode);

        treeNodes = List.copyOf(nodes);
        recipeBoxes = List.copyOf(boxes);
        renderStartingNodeRemoveButton(graphics, nodes, boxes, hoveredPlanNode, mouseX, mouseY);
        List<RecipePage<?>> tickingPages = new ArrayList<>();
        for (RecipeBoxHitbox box : boxes) {
            if (!tickingPages.contains(box.page)) tickingPages.add(box.page);
        }
        visibleRecipePages = List.copyOf(tickingPages);
        renderTreeTooltip(graphics, nodes, mouseX, mouseY);
        boxes.stream()
                .filter(box -> box.contains(mouseX, mouseY))
                .findFirst()
                .flatMap(box -> box.recipeSlotUnderMouse(mouseX, mouseY))
                .ifPresent(slot -> graphics.renderComponentTooltip(font, slot.getTooltip(), mouseX, mouseY));
        renderSummaryTooltip(graphics, mouseX, mouseY);
    }

    private void renderPanOverview(GuiGraphics graphics, CompactTreeLayout layout) {
        int viewportWidth = treeViewportRight - treeViewportLeft;
        int viewportHeight = treeViewportBottom - treeViewportTop;
        if (!treePanning || layout.nodes.isEmpty()
                || (layout.width * treeZoom <= viewportWidth && layout.height * treeZoom <= viewportHeight)) return;
        int width = Math.min(144, viewportWidth - 12);
        int height = Math.min(96, viewportHeight - 12);
        if (width < 36 || height < 28) return;
        int left = treeViewportLeft + 6, top = treeViewportTop + 6;
        // Keep the entire overview in one GUI overlay batch. Native recipe renderers may
        // leave depth/culling state that hides raw quads behind this panel.
        graphics.drawManaged(() -> {
            var overlay = net.minecraft.client.renderer.RenderType.guiOverlay();
            graphics.fill(overlay, left, top, left + width, top + height, 0xff718171);
            graphics.fill(overlay, left + 1, top + 1, left + width - 1, top + height - 1, 0xe61c2721);
            double scale = Math.min((width - 10.0) / layout.width, (height - 10.0) / layout.height);
            double x = left + (width - layout.width * scale) / 2;
            double y = top + (height - layout.height * scale) / 2;
            for (TreeLayoutNode node : layout.nodes) {
                if (node.parentIndex < 0) continue;
                TreeLayoutNode parent = layout.nodes.get(node.parentIndex);
                int px = (int) Math.round(x + (parent.left + parent.width / 2.0) * scale);
                int py = (int) Math.round(y + (parent.top + parent.height / 2.0) * scale);
                int nx = (int) Math.round(x + (node.left + node.width / 2.0) * scale);
                int ny = (int) Math.round(y + (node.top + node.height / 2.0) * scale);
                int branchY = (py + ny) / 2;
                graphics.fill(overlay, px, Math.min(py, branchY), px + 1, Math.max(py, branchY) + 1, 0xff718171);
                graphics.fill(overlay, Math.min(px, nx), branchY, Math.max(px, nx) + 1, branchY + 1, 0xff718171);
                graphics.fill(overlay, nx, Math.min(branchY, ny), nx + 1, Math.max(branchY, ny) + 1, 0xff718171);
            }
            for (TreeLayoutNode node : layout.nodes) {
                int nx = (int) Math.round(x + node.left * scale);
                int ny = (int) Math.round(y + node.top * scale);
                int nr = Math.max(nx + 1, (int) Math.round(x + (node.left + node.width) * scale));
                int nb = Math.max(ny + 1, (int) Math.round(y + (node.top + node.height) * scale));
                graphics.fill(overlay, nx, ny, nr, nb, node.parentIndex < 0 ? 0xff8fe871 : 0xffd8e9d5);
            }
            int mapLeft = (int) x, mapTop = (int) y;
            int mapRight = Math.max(mapLeft + 2, (int) Math.ceil(x + layout.width * scale));
            int mapBottom = Math.max(mapTop + 2, (int) Math.ceil(y + layout.height * scale));
            int vx = Mth.clamp((int) (x - treePanX / treeZoom * scale), mapLeft, mapRight - 2);
            int vy = Mth.clamp((int) (y - treePanY / treeZoom * scale), mapTop, mapBottom - 2);
            int vr = Mth.clamp((int) (x + (viewportWidth - treePanX) / treeZoom * scale), vx + 2, mapRight);
            int vb = Mth.clamp((int) (y + (viewportHeight - treePanY) / treeZoom * scale), vy + 2, mapBottom);
            graphics.fill(overlay, vx, vy, vr, vb, 0x44ffffff);
            graphics.fill(overlay, vx, vy, vr, vy + 1, 0xffffffff);
            graphics.fill(overlay, vx, vb - 1, vr, vb, 0xffffffff);
            graphics.fill(overlay, vx, vy, vx + 1, vb, 0xffffffff);
            graphics.fill(overlay, vr - 1, vy, vr, vb, 0xffffffff);
        });
    }

    private void renderStartingNodeRemoveButton(
            GuiGraphics graphics,
            List<TreeNode> nodes,
            List<RecipeBoxHitbox> boxes,
            PlanNode hoveredPlanNode,
            int mouseX,
            int mouseY) {
        if (startingNodes.size() <= 1) {
            startingNodeRemoveButtons = List.of();
            return;
        }
        PlanNode removable = startingNodeRemoveButtons.stream()
                .filter(button -> button.keepsVisible(mouseX, mouseY))
                .map(StartingNodeRemoveHitbox::node)
                .filter(startingNodes::contains)
                .findFirst()
                .orElse(null);
        if (removable == null
                && hoveredPlanNode != null
                && startingNodes.contains(hoveredPlanNode)) {
            removable = hoveredPlanNode;
        }
        if (removable == null) {
            startingNodeRemoveButtons = List.of();
            return;
        }

        PlanNode selectedRoot = removable;
        int nodeLeft;
        int nodeTop;
        int nodeWidth;
        int nodeHeight;
        Optional<TreeNode> compactNode = nodes.stream()
                .filter(node -> node.node == selectedRoot)
                .findFirst();
        if (compactNode.isPresent()) {
            TreeNode node = compactNode.get();
            nodeLeft = node.left;
            nodeTop = node.top;
            nodeWidth = node.size;
            nodeHeight = node.size;
        } else {
            RecipeBoxHitbox box = boxes.stream()
                    .filter(candidate -> candidate.node == selectedRoot)
                    .findFirst()
                    .orElse(null);
            if (box == null) {
                startingNodeRemoveButtons = List.of();
                return;
            }
            nodeLeft = box.left;
            nodeTop = box.top;
            nodeWidth = box.width;
            nodeHeight = box.height;
        }

        int size = 16;
        int minimumLeft = treeViewportLeft + 1;
        int maximumLeft = Math.max(minimumLeft, treeViewportRight - size - 1);
        int minimumTop = treeViewportTop + 1;
        int maximumTop = Math.max(minimumTop, treeViewportBottom - size - 1);
        int left = Mth.clamp(nodeLeft + (nodeWidth - size) / 2, minimumLeft, maximumLeft);
        int top = nodeTop - size - 3;
        if (top < minimumTop) {
            top = Mth.clamp(nodeTop + (nodeHeight - size) / 2, minimumTop, maximumTop);
            if (nodeLeft + nodeWidth + 3 <= maximumLeft) {
                left = nodeLeft + nodeWidth + 3;
            } else if (nodeLeft - size - 3 >= minimumLeft) {
                left = nodeLeft - size - 3;
            } else if (nodeTop + nodeHeight + 3 <= maximumTop) {
                left = Mth.clamp(nodeLeft + (nodeWidth - size) / 2, minimumLeft, maximumLeft);
                top = nodeTop + nodeHeight + 3;
            } else {
                startingNodeRemoveButtons = List.of();
                return;
            }
        }
        boolean hovered = contains(left, top, size, mouseX, mouseY);
        graphics.enableScissor(treeViewportLeft, treeViewportTop, treeViewportRight, treeViewportBottom);
        graphics.fill(left + 2, top + 2, left + size + 2, top + size + 2, 0xa0000000);
        graphics.fill(left, top, left + size, top + size,
                hovered ? 0xff744444 : 0xff4a3434);
        int border = hovered ? 0xffffa3a3 : 0xffc77b7b;
        graphics.fill(left, top, left + size, top + 1, border);
        graphics.fill(left, top, left + 1, top + size, border);
        graphics.fill(left + size - 1, top, left + size, top + size, 0xff241818);
        graphics.fill(left, top + size - 1, left + size, top + size, 0xff241818);
        graphics.drawCenteredString(font, "x", left + size / 2, top + 4, 0xffffffff);
        graphics.disableScissor();
        int keepLeft = Math.min(left, nodeLeft);
        int keepRight = Math.max(left + size, nodeLeft + nodeWidth);
        int keepTop = top;
        int keepBottom = Math.max(top + size, nodeTop + 1);
        startingNodeRemoveButtons = List.of(new StartingNodeRemoveHitbox(
                selectedRoot,
                left,
                top,
                size,
                size,
                keepLeft,
                keepTop,
                keepRight - keepLeft,
                keepBottom - keepTop));
    }

    private CompactTreeLayout currentTreeLayout() {
        if (treeLayoutDirty || cachedTreeLayout == null) {
            cachedTreeLayout = compactForestLayout(startingNodes);
            treeLayoutDirty = false;
        }
        return cachedTreeLayout;
    }

    private void invalidateTreeLayout() {
        treeLayoutDirty = true;
    }

    private CompactTreeLayout compactForestLayout(List<PlanNode> roots) {
        if (roots.isEmpty()) return new CompactTreeLayout(List.of(), Map.of(), 1, 1);
        List<TreeLayoutNode> combined = new ArrayList<>();
        Map<PlanNode, TreeLayoutNode> nodesByPlan = new LinkedHashMap<>();
        int removeButtonClearance = roots.size() > 1
                ? Math.max(1, (int) Math.ceil(20.0 / Math.max(0.01, treeZoom)))
                : 0;
        int nextLeft = 0;
        int contentHeight = 1;
        for (PlanNode root : roots) {
            CompactTreeLayout tree = compactTreeLayout(root);
            int indexOffset = combined.size();
            for (TreeLayoutNode node : tree.nodes) {
                TreeLayoutNode shifted = new TreeLayoutNode(
                        node.node,
                        node.left + nextLeft,
                        node.top + removeButtonClearance,
                        node.width,
                        node.height,
                        node.parentIndex < 0 ? -1 : node.parentIndex + indexOffset);
                combined.add(shifted);
                nodesByPlan.put(shifted.node, shifted);
            }
            nextLeft += tree.width + STARTING_NODE_GAP;
            contentHeight = Math.max(contentHeight, tree.height + removeButtonClearance);
        }
        return new CompactTreeLayout(
                List.copyOf(combined),
                Map.copyOf(nodesByPlan),
                Math.max(1, nextLeft - STARTING_NODE_GAP),
                contentHeight);
    }

    private CompactTreeLayout compactTreeLayout(PlanNode root) {
        LayoutDraft draft = compactLayoutDraft(root);
        List<Integer> depthHeights = new ArrayList<>();
        collectDepthHeights(draft, 0, depthHeights);
        List<Integer> depthTops = new ArrayList<>(depthHeights.size());
        int nextTop = 0;
        for (int height : depthHeights) {
            depthTops.add(nextTop);
            nextTop += height + TREE_LEVEL_GAP;
        }

        List<RawTreeLayoutNode> rawNodes = new ArrayList<>();
        flattenLayoutDraft(draft, 0.0, 0, -1, depthTops, rawNodes);
        double minimumLeft = rawNodes.stream().mapToDouble(node -> node.left).min().orElse(0.0);
        double maximumRight = rawNodes.stream()
                .mapToDouble(node -> node.left + node.width)
                .max()
                .orElse(1.0);
        int contentWidth = Math.max(1, (int) Math.ceil(maximumRight - minimumLeft));
        List<TreeLayoutNode> nodes = rawNodes.stream()
                .map(node -> new TreeLayoutNode(
                        node.node,
                        (int) Math.round(node.left - minimumLeft),
                        node.top,
                        node.width,
                        node.height,
                        node.parentIndex))
                .toList();
        Map<PlanNode, TreeLayoutNode> nodesByPlan = new LinkedHashMap<>();
        nodes.forEach(node -> nodesByPlan.put(node.node, node));
        int contentHeight = nodes.stream()
                .mapToInt(node -> node.top + node.height)
                .max()
                .orElse(1);
        return new CompactTreeLayout(nodes, Map.copyOf(nodesByPlan), contentWidth, contentHeight);
    }

    private boolean treeModelBoundsVisible(int left, int top, int width, int height) {
        double visibleLeft = -treePanX / treeZoom;
        double visibleTop = -treePanY / treeZoom;
        double visibleRight = visibleLeft + (treeViewportRight - treeViewportLeft) / treeZoom;
        double visibleBottom = visibleTop + (treeViewportBottom - treeViewportTop) / treeZoom;
        return left + width >= visibleLeft - 2.0
                && left <= visibleRight + 2.0
                && top + height >= visibleTop - 2.0
                && top <= visibleBottom + 2.0;
    }

    private LayoutDraft compactLayoutDraft(PlanNode node) {
        NodeSize size = nodeSize(node);
        List<LayoutDraft> children = isRecipeBookCollapsed(node)
                || isFullyCoveredByByproducts(node)
                ? List.of()
                : node.children.stream()
                        .map(this::compactLayoutDraft)
                        .toList();
        if (children.isEmpty()) {
            return new LayoutDraft(
                    node,
                    size,
                    children,
                    List.of(-size.width / 2.0),
                    List.of(size.width / 2.0));
        }

        List<Double> combinedMinimums = new ArrayList<>();
        List<Double> combinedMaximums = new ArrayList<>();
        for (LayoutDraft child : children) {
            double offset = 0.0;
            if (!combinedMinimums.isEmpty()) {
                int sharedDepths = Math.min(combinedMaximums.size(), child.minimumContour.size());
                for (int depth = 0; depth < sharedDepths; depth++) {
                    offset = Math.max(
                            offset,
                            combinedMaximums.get(depth) + TREE_NODE_GAP
                                    - child.minimumContour.get(depth));
                }
            }
            child.offsetX = offset;
            mergeContour(combinedMinimums, combinedMaximums, child, offset);
        }

        double childrenCenter = (children.get(0).offsetX
                + children.get(children.size() - 1).offsetX) / 2.0;
        children.forEach(child -> child.offsetX -= childrenCenter);
        for (int depth = 0; depth < combinedMinimums.size(); depth++) {
            combinedMinimums.set(depth, combinedMinimums.get(depth) - childrenCenter);
            combinedMaximums.set(depth, combinedMaximums.get(depth) - childrenCenter);
        }

        List<Double> minimumContour = new ArrayList<>();
        List<Double> maximumContour = new ArrayList<>();
        minimumContour.add(-size.width / 2.0);
        maximumContour.add(size.width / 2.0);
        minimumContour.addAll(combinedMinimums);
        maximumContour.addAll(combinedMaximums);
        return new LayoutDraft(node, size, children, minimumContour, maximumContour);
    }

    private static void mergeContour(
            List<Double> minimums,
            List<Double> maximums,
            LayoutDraft child,
            double offset) {
        for (int depth = 0; depth < child.minimumContour.size(); depth++) {
            double minimum = child.minimumContour.get(depth) + offset;
            double maximum = child.maximumContour.get(depth) + offset;
            if (depth >= minimums.size()) {
                minimums.add(minimum);
                maximums.add(maximum);
            } else {
                minimums.set(depth, Math.min(minimums.get(depth), minimum));
                maximums.set(depth, Math.max(maximums.get(depth), maximum));
            }
        }
    }

    private static void collectDepthHeights(
            LayoutDraft draft,
            int depth,
            List<Integer> heights) {
        while (heights.size() <= depth) heights.add(0);
        heights.set(depth, Math.max(heights.get(depth), draft.size.height));
        draft.children.forEach(child -> collectDepthHeights(child, depth + 1, heights));
    }

    private static void flattenLayoutDraft(
            LayoutDraft draft,
            double centerX,
            int depth,
            int parentIndex,
            List<Integer> depthTops,
            List<RawTreeLayoutNode> result) {
        int nodeIndex = result.size();
        result.add(new RawTreeLayoutNode(
                draft.node,
                centerX - draft.size.width / 2.0,
                depthTops.get(depth),
                draft.size.width,
                draft.size.height,
                parentIndex));
        for (LayoutDraft child : draft.children) {
            flattenLayoutDraft(
                    child,
                    centerX + child.offsetX,
                    depth + 1,
                    nodeIndex,
                    depthTops,
                    result);
        }
    }

    private void renderByproductLinks(
            GuiGraphics graphics,
            List<ByproductLink> links,
            CompactTreeLayout treeLayout,
            int contentWidth,
            PlanNode hoveredEndpoint) {
        if (links.isEmpty() || hoveredEndpoint == null) return;
        Set<ByproductEdgeKey> renderedEdges = new HashSet<>();
        List<CurveEndpoints> curves = new ArrayList<>();
        for (ByproductLink link : links) {
            if (link.source != hoveredEndpoint && link.target != hoveredEndpoint) continue;
            ByproductEdgeKey edge = new ByproductEdgeKey(link.source, link.target);
            if (!renderedEdges.add(edge)) continue;
            TreeLayoutNode source = treeLayout.nodesByPlan.get(link.source);
            TreeLayoutNode targetNode = treeLayout.nodesByPlan.get(link.target);
            if (source == null || targetNode == null) {
                String failureKey = System.identityHashCode(link.source)
                        + "->" + System.identityHashCode(link.target);
                if (loggedByproductLinkLayoutFailures.add(failureKey)) {
                    JeiExportMod.LOGGER.warn(
                            "Could not draw byproduct link from {} to {} because a tree layout node is missing",
                            ingredientDisplayName(link.source.ingredient),
                            ingredientDisplayName(link.target.ingredient));
                }
                continue;
            }
            double startX = source.left + source.width / 2.0;
            double startY = source.top + source.height / 2.0;
            double endX = targetNode.left + targetNode.width / 2.0;
            double endY = targetNode.top + targetNode.height / 2.0;
            int curveLeft = (int) Math.floor(Math.min(startX, endX) - 72.0);
            int curveTop = (int) Math.floor(Math.min(startY, endY));
            int curveWidth = (int) Math.ceil(Math.abs(endX - startX) + 145.0);
            int curveHeight = Math.max(1, (int) Math.ceil(Math.abs(endY - startY) + 1.0));
            if (!treeModelBoundsVisible(curveLeft, curveTop, curveWidth, curveHeight)) continue;
            curves.add(new CurveEndpoints(startX, startY, endX, endY));
        }
        if (curves.isEmpty()) return;

        Matrix4f pose = graphics.pose().last().pose();
        BufferBuilder buffer = Tesselator.getInstance().getBuilder();
        buffer.begin(VertexFormat.Mode.QUADS, DefaultVertexFormat.POSITION_COLOR);
        int alpha = useByproducts ? 255 : 190;
        for (CurveEndpoints curve : curves) {
            double midpointX = (curve.startX + curve.endX) / 2.0;
            double midpointY = (curve.startY + curve.endY) / 2.0;
            double distance = Math.hypot(curve.endX - curve.startX, curve.endY - curve.startY);
            double direction = midpointX < contentWidth / 2.0 ? 1.0 : -1.0;
            double controlX = midpointX + direction * Mth.clamp(distance / 3.0, 24.0, 72.0);
            double controlY = midpointY;
            int steps = Mth.clamp((int) Math.ceil(distance / 8.0), 16, 48);
            double previousX = curve.startX;
            double previousY = curve.startY;
            for (int step = 1; step <= steps; step++) {
                double t = (double) step / steps;
                double inverse = 1.0 - t;
                double nextX = inverse * inverse * curve.startX
                        + 2.0 * inverse * t * controlX
                        + t * t * curve.endX;
                double nextY = inverse * inverse * curve.startY
                        + 2.0 * inverse * t * controlY
                        + t * t * curve.endY;
                appendLineQuad(buffer, pose, previousX, previousY, nextX, nextY,
                        1.5, 66, 165, 245, alpha);
                previousX = nextX;
                previousY = nextY;
            }
        }
        RenderSystem.setShader(GameRenderer::getPositionColorShader);
        BufferUploader.drawWithShader(buffer.end());
    }

    private static void appendLineQuad(
            BufferBuilder buffer,
            Matrix4f pose,
            double startX,
            double startY,
            double endX,
            double endY,
            double thickness,
            int red,
            int green,
            int blue,
            int alpha) {
        double deltaX = endX - startX;
        double deltaY = endY - startY;
        double length = Math.hypot(deltaX, deltaY);
        if (length <= 0.0001) return;
        double normalX = -deltaY / length * thickness / 2.0;
        double normalY = deltaX / length * thickness / 2.0;
        buffer.vertex(pose, (float) (startX + normalX), (float) (startY + normalY), 0)
                .color(red, green, blue, alpha).endVertex();
        buffer.vertex(pose, (float) (startX - normalX), (float) (startY - normalY), 0)
                .color(red, green, blue, alpha).endVertex();
        buffer.vertex(pose, (float) (endX - normalX), (float) (endY - normalY), 0)
                .color(red, green, blue, alpha).endVertex();
        buffer.vertex(pose, (float) (endX + normalX), (float) (endY + normalY), 0)
                .color(red, green, blue, alpha).endVertex();
    }

    private NodeSize nodeSize(PlanNode node) {
        long visibleQuantity = visibleQuantity(node);
        if (!compactMode && node.recipe != null && !isRecipeBookCollapsed(node)) {
            Rect2i bounds = recipeRectWithBorder(node.recipe.requireLayout());
            int labelHeight = visibleQuantity > 1 ? RECIPE_AMOUNT_GAP + RECIPE_AMOUNT_HEIGHT : 0;
            return new NodeSize(bounds.getWidth(), bounds.getHeight() + labelHeight);
        }
        return new NodeSize(28, 28 + (visibleQuantity > 1 ? 12 : 0));
    }

    private int nodeContentHeight(PlanNode node) {
        if (!compactMode && node.recipe != null && !isRecipeBookCollapsed(node)) {
            return recipeRectWithBorder(node.recipe.requireLayout()).getHeight();
        }
        return 28;
    }

    private long visibleQuantity(PlanNode node) {
        return node.quantity;
    }

    private boolean isFullyCoveredByByproducts(PlanNode node) {
        if (!useByproducts) return false;
        ByproductCoverage coverage = currentPlanSummary().coverage.get(node);
        return coverage != null && coverage.amount >= coverage.request;
    }

    private TreeNode canvasTreeHitbox(PlanNode node, int left, int top, int size) {
        int screenLeft = (int) Math.floor(treeViewportLeft + treePanX + left * treeZoom);
        int screenTop = (int) Math.floor(treeViewportTop + treePanY + top * treeZoom);
        int screenSize = Math.max(1, (int) Math.ceil(size * treeZoom));
        return new TreeNode(node, screenLeft, screenTop, screenSize);
    }

    private RecipeBoxHitbox canvasRecipeHitbox(
            PlanNode node,
            RecipePage<?> page,
            net.minecraft.client.renderer.Rect2i rect,
            int layoutLeft,
            int layoutTop) {
        double renderOriginX = treeViewportLeft + treePanX;
        double renderOriginY = treeViewportTop + treePanY;
        int screenLeft = (int) Math.floor(renderOriginX + rect.getX() * treeZoom);
        int screenTop = (int) Math.floor(renderOriginY + rect.getY() * treeZoom);
        int screenWidth = Math.max(1, (int) Math.ceil(rect.getWidth() * treeZoom));
        int screenHeight = Math.max(1, (int) Math.ceil(rect.getHeight() * treeZoom));
        return new RecipeBoxHitbox(node, page, screenLeft, screenTop, screenWidth, screenHeight,
                renderOriginX, renderOriginY, treeZoom, layoutLeft, layoutTop);
    }

    private void renderRecipePreview(
            GuiGraphics graphics,
            SummarySectionBounds bounds,
            PlanNode node,
            int mouseX,
            int mouseY,
            List<RecipeBoxHitbox> boxes) {
        int reservedLeft = bounds.left;
        int reservedTop = bounds.top;
        int reservedWidth = bounds.width;
        int reservedHeight = bounds.height;

        if (node == null) {
            graphics.drawCenteredString(font, "Hover a recipe node",
                    reservedLeft + reservedWidth / 2, reservedTop + reservedHeight / 2 - 4, 0xff8f9b8b);
            return;
        }

        renderIngredient(graphics, node.ingredient, reservedLeft + 6, reservedTop + 4, 16);
        boolean undiscovered = isUndiscovered(node);
        boolean noRecipes = hasNoRecipes(node);
        if (undiscovered) {
            graphics.drawString(font, "?", reservedLeft + 18, reservedTop + 3,
                    0xff8fc1ff, false);
        }
        String itemName = font.plainSubstrByWidth(
                ingredientDisplayName(node.ingredient), Math.max(1, reservedWidth - 30));
        graphics.drawString(font, itemName, reservedLeft + 28, reservedTop + 8,
                undiscovered ? 0xff8fc1ff : (noRecipes ? 0xffb8bdc2 : 0xffffffff), false);
        if (node.recipe == null) {
            if (noRecipes) {
                graphics.drawCenteredString(font, "No recipes",
                        reservedLeft + reservedWidth / 2, reservedTop + reservedHeight / 2 - 4,
                        0xffb8bdc2);
                return;
            }
            Component attackKey = minecraft == null
                    ? Component.literal("Left Button")
                    : minecraft.options.keyAttack.getTranslatedKeyMessage();
            String action = attackKey.getString() + " Select recipe";
            String selectHint = font.plainSubstrByWidth(action, Math.max(1, reservedWidth - 12));
            graphics.drawCenteredString(font, selectHint,
                    reservedLeft + reservedWidth / 2, reservedTop + reservedHeight / 2 - 9,
                    0xffffffff);
            if (node.hasIngredientOptions()) {
                String optionHint = "Scroll to change item " + (node.ingredientOptionIndex + 1)
                        + " / " + node.ingredientOptions.size();
                graphics.drawCenteredString(font, optionHint,
                        reservedLeft + reservedWidth / 2, reservedTop + reservedHeight / 2 + 17,
                        0xffaeb7aa);
            }
            return;
        }
        IRecipeLayoutDrawable<?> recipeLayout = node.recipe.requireLayout();
        recipeLayout.setPosition(0, 0);
        Rect2i rect = recipeRectWithBorder(recipeLayout);
        int availableWidth = Math.max(1, reservedWidth - 8);
        int availableHeight = Math.max(1, reservedHeight - 28);
        double recipeScale = Math.min(1.0, Math.min(
                (double) availableWidth / Math.max(1, rect.getWidth()),
                (double) availableHeight / Math.max(1, rect.getHeight())));
        double fittedLeft = reservedLeft + 4 + (availableWidth - rect.getWidth() * recipeScale) / 2.0;
        double fittedTop = reservedTop + 24 + (availableHeight - rect.getHeight() * recipeScale) / 2.0;
        double renderOriginX = fittedLeft - rect.getX() * recipeScale;
        double renderOriginY = fittedTop - rect.getY() * recipeScale;
        double recipeMouseX = (mouseX - renderOriginX) / recipeScale;
        double recipeMouseY = (mouseY - renderOriginY) / recipeScale;

        graphics.pose().pushPose();
        graphics.pose().translate(renderOriginX, renderOriginY, 0);
        graphics.pose().scale((float) recipeScale, (float) recipeScale, 1.0f);
        recipeLayout.drawRecipe(graphics, (int) recipeMouseX, (int) recipeMouseY);
        graphics.pose().popPose();

        int screenLeft = (int) Math.floor(renderOriginX + rect.getX() * recipeScale);
        int screenTop = (int) Math.floor(renderOriginY + rect.getY() * recipeScale);
        int screenWidth = Math.max(1, (int) Math.ceil(rect.getWidth() * recipeScale));
        int screenHeight = Math.max(1, (int) Math.ceil(rect.getHeight() * recipeScale));
        boxes.add(new RecipeBoxHitbox(node, node.recipe,
                screenLeft, screenTop, screenWidth, screenHeight,
                renderOriginX, renderOriginY, recipeScale, 0, 0));
    }

    private double toTreeX(double screenX) {
        return (screenX - treeViewportLeft - treePanX) / treeZoom;
    }

    private double toTreeY(double screenY) {
        return (screenY - treeViewportTop - treePanY) / treeZoom;
    }

    private void renderNode(
            GuiGraphics graphics,
            PlanNode node,
            int left,
            int top,
            int size,
            long quantity,
            int mouseX,
            int mouseY) {
        boolean hovered = contains(left, top, size, mouseX, mouseY);
        boolean noRecipes = hasNoRecipes(node);
        boolean discovered = isDiscovered(node);
        boolean hasMultipleOptions = node.hasIngredientOptions();
        ByproductCoverage coverage = currentPlanSummary().coverage.get(node);
        int background = hovered ? 0xff4c5d46 : 0xff293029;
        int border = hovered ? 0xff9fcf7f : 0xff52624d;
        if (coverage != null && coverage.amount > 0) {
            if (!useByproducts) {
                background = hovered ? 0xff405b65 : 0xff263f47;
                border = 0xff62c9df;
            } else if (coverage.amount >= coverage.request) {
                background = hovered ? 0xff3f6b4c : 0xff244832;
                border = 0xff70db8c;
            } else {
                background = hovered ? 0xff6b5b34 : 0xff4b3d20;
                border = 0xffffc857;
            }
        }
        if (discovered) {
            background = hovered ? 0xff3f6b4c : 0xff244832;
            if (coverage == null || coverage.amount <= 0) {
                border = 0xff70db8c;
            }
        }
        if (noRecipes) {
            background = hovered ? 0xff4a4d50 : 0xff343638;
            border = hovered ? 0xffc6c9cc : 0xff73777b;
        }
        if (hasMultipleOptions) {
            if (noRecipes) {
                background = hovered
                        ? MULTI_OPTION_NO_RECIPE_HOVER_BACKGROUND
                        : MULTI_OPTION_NO_RECIPE_BACKGROUND;
            } else if (discovered) {
                background = hovered
                        ? MULTI_OPTION_DISCOVERED_HOVER_BACKGROUND
                        : MULTI_OPTION_DISCOVERED_BACKGROUND;
            } else if (coverage == null || coverage.amount <= 0) {
                background = hovered
                        ? MULTI_OPTION_HOVER_BACKGROUND
                        : MULTI_OPTION_BACKGROUND;
            }
            border = hovered ? MULTI_OPTION_HOVER_BORDER : MULTI_OPTION_BORDER;
        }
        graphics.fill(left, top, left + size, top + size, background);
        graphics.fill(left, top, left + size, top + 1, border);
        if (hasMultipleOptions) {
            graphics.fill(left, top, left + 2, top + size, border);
        }
        renderIngredient(graphics, node.ingredient,
                left + (size - 16) / 2, top + (size - 16) / 2, 16);
        if (isUndiscovered(node)) {
            graphics.fill(left, top, left + size, top + size, 0x70070d18);
            graphics.fill(left, top, left + size, top + 1, 0xff6fa8ff);
            graphics.drawString(font, "?", left + size - 7, top + 2, 0xff8fc1ff, false);
        }
        if (quantity > 1) {
            String count = node.stack.isEmpty() ? Long.toString(quantity) : quantity + "x";
            int countLeft = left + (size - font.width(count)) / 2;
            graphics.fill(countLeft - 2, top + size + 1,
                    countLeft + font.width(count) + 2, top + size + 12, 0xe0181a1b);
            graphics.drawCenteredString(font, count, left + size / 2, top + size + 2,
                    noRecipes ? 0xffb8bdc2 : 0xffffffff);
        }
    }

    private void renderProcessAccent(
            GuiGraphics graphics,
            PlanNode node,
            int left,
            int top,
            int width,
            int height) {
        if (node.recipe == null || width <= 0 || height <= 0) return;
        String key = processKey(node);
        int color = processColor(key);
        if (key.equals(selectedProcessKey)) {
            // Draw over the native JEI recipe, matching the 1.12 selection tint.
            graphics.flush();
            graphics.fill(net.minecraft.client.renderer.RenderType.guiOverlay(),
                    left, top, left + width, top + height, (color & 0x00ffffff) | 0x44000000);
            graphics.flush();
        }
    }

    private static String processKey(PlanNode node) {
        return node.recipe == null
                ? ""
                : node.recipe.category.getRecipeType().getUid().toString();
    }

    private static String processTitle(PlanNode node) {
        return node.recipe == null ? "" : node.recipe.category.getTitle().getString();
    }

    private static int processColor(String key) {
        return PROCESS_COLORS[Math.floorMod(key.hashCode(), PROCESS_COLORS.length)];
    }

    private List<GroupedIngredient> groupedInputs(RecipePage<?> page) {
        List<GroupedIngredient> grouped = new ArrayList<>();
        if (page.recipe instanceof mezz.jei.api.recipe.vanilla.IJeiBrewingRecipe brewing) {
            for (List<ItemStack> alternatives : List.of(brewing.getPotionInputs(), brewing.getIngredients())) {
                List<ITypedIngredient<?>> options = alternatives.stream().filter(stack -> !stack.isEmpty())
                        .map(stack -> (ITypedIngredient<?>) typedItem(stack)).collect(java.util.stream.Collectors.toList());
                if (!options.isEmpty()) grouped.add(new GroupedIngredient(options.get(0), 1, options));
            }
            return grouped;
        }
        for (IRecipeSlotView slot : page.requireLayout().getRecipeSlotsView()
                .getSlotViews(RecipeIngredientRole.INPUT)) {
            List<ITypedIngredient<?>> options = slot.getAllIngredients()
                    .filter(ingredient -> !ItemCatalog.isEmptyIngredient(ingredient))
                    .collect(ArrayList::new, (ingredients, ingredient) -> {
                        if (ingredients.stream().noneMatch(existing ->
                                sameIngredient(existing, ingredient))) {
                            ingredients.add(ingredient);
                        }
                    }, ArrayList::addAll);
            Optional<ITypedIngredient<?>> displayed = slot.getDisplayedIngredient()
                    .filter(ingredient -> !ItemCatalog.isEmptyIngredient(ingredient));
            if (displayed.isEmpty() && !options.isEmpty()) displayed = Optional.of(options.get(0));
            if (displayed.isEmpty()) continue;

            ITypedIngredient<?> ingredient = displayed.get();
            if (options.stream().noneMatch(option -> sameIngredient(option, ingredient))) {
                options.add(0, ingredient);
            }
            long quantity = ingredientAmount(ingredient);
            boolean merged = false;
            for (int index = 0; index < grouped.size(); index++) {
                GroupedIngredient existing = grouped.get(index);
                List<ITypedIngredient<?>> sharedOptions = sharedIngredientOptions(
                        existing.options, options);
                if (!sharedOptions.isEmpty()) {
                    ITypedIngredient<?> sharedIngredient = sharedOptions.stream()
                            .filter(option -> sameIngredient(option, existing.ingredient))
                            .findFirst()
                            .orElseGet(() -> sharedOptions.stream()
                                    .filter(option -> sameIngredient(option, ingredient))
                                    .findFirst()
                                    .orElse(sharedOptions.get(0)));
                    grouped.set(index, new GroupedIngredient(
                            sharedIngredient,
                            RecipeQuantityMath.safeAdd(existing.quantity, quantity),
                            List.copyOf(sharedOptions)));
                    merged = true;
                    break;
                }
            }
            if (!merged) {
                grouped.add(new GroupedIngredient(ingredient, quantity, List.copyOf(options)));
            }
        }
        for (GroupedIngredient supplemental : supplementalInputs(page)) {
            boolean alreadyExposedByJei = grouped.stream()
                    .anyMatch(existing -> sameIngredient(existing.ingredient, supplemental.ingredient));
            if (!alreadyExposedByJei) grouped.add(supplemental);
        }
        return grouped;
    }

    private List<GroupedIngredient> supplementalInputs(RecipePage<?> page) {
        List<SupplementalRecipeInputs.FluidCost> costs;
        try {
            costs = SupplementalRecipeInputs.fluidCosts(
                    page.category.getRecipeType().getUid(),
                    page.recipe);
        } catch (RuntimeException error) {
            if (loggedSupplementalInputFailures.add(page.key)) {
                JeiExportMod.LOGGER.error(
                        "Could not extract supplemental resource inputs for recipe {}",
                        page.key,
                        error);
            }
            return List.of();
        }
        List<GroupedIngredient> inputs = new ArrayList<>();
        for (SupplementalRecipeInputs.FluidCost cost : costs) {
            if (cost.amount() > Integer.MAX_VALUE) {
                if (loggedSupplementalInputFailures.add(page.key)) {
                    JeiExportMod.LOGGER.error(
                            "Supplemental fluid input {} for recipe {} exceeds FluidStack's integer capacity: {}",
                            cost.fluidId(),
                            page.key,
                            cost.amount());
                }
                continue;
            }
            Optional<ITypedIngredient<FluidStack>> typed = BuiltInRegistries.FLUID
                    .getOptional(cost.fluidId())
                    .flatMap(fluid -> runtime.getIngredientManager().createTypedIngredient(
                            ForgeTypes.FLUID_STACK,
                            new FluidStack(fluid, (int) cost.amount())));
            if (typed.isEmpty()) {
                if (loggedSupplementalInputFailures.add(page.key)) {
                    JeiExportMod.LOGGER.error(
                            "Supplemental fluid {} for recipe {} is unavailable to JEI",
                            cost.fluidId(),
                            page.key);
                }
                continue;
            }
            ITypedIngredient<?> ingredient = typed.get();
            inputs.add(new GroupedIngredient(
                    ingredient,
                    cost.amount(),
                    List.of(ingredient)));
        }
        return inputs;
    }

    private List<ITypedIngredient<?>> sharedIngredientOptions(
            List<ITypedIngredient<?>> first,
            List<ITypedIngredient<?>> second) {
        return IngredientOptionSets.sharedOptions(first, second, this::sameIngredient);
    }

    private long outputAmount(RecipePage<?> page, ITypedIngredient<?> output) {
        if (page.recipe instanceof mezz.jei.api.recipe.vanilla.IJeiBrewingRecipe) return 1;
        long exact = page.requireLayout().getRecipeSlotsView()
                .getSlotViews(RecipeIngredientRole.OUTPUT).stream()
                .map(slot -> slot.getAllIngredients()
                        .filter(ingredient -> sameIngredient(ingredient, output))
                        .findFirst()
                        .map(this::ingredientAmount)
                        .orElse(0L))
                .reduce(0L, RecipeQuantityMath::safeAdd);
        return Math.max(1, exact);
    }

    private void invalidatePlanSummary() {
        planSummaryDirty = true;
    }

    private PlanSummary currentPlanSummary() {
        if (planSummaryDirty) {
            planSummary = calculatePlanSummary();
            planSummaryDirty = false;
        }
        return planSummary;
    }

    private PlanSummary calculatePlanSummary() {
        return calculatePlanSummary(true);
    }

    private PlanSummary calculatePlanSummary(boolean applyRecipeBookCollapse) {
        if (startingNodes.isEmpty()) return PlanSummary.empty();
        LinkedHashMap<String, MutableIngredientSummary> materials = new LinkedHashMap<>();
        LinkedHashMap<String, MutableProcessSummary> processes = new LinkedHashMap<>();
        LinkedHashMap<String, MutableIngredientSummary> byproducts = new LinkedHashMap<>();
        LinkedHashMap<String, List<MutableByproductSupply>> supplies = new LinkedHashMap<>();
        Map<PlanNode, ByproductCoverage> coverage = new LinkedHashMap<>();
        List<ByproductLink> byproductLinks = new ArrayList<>();
        startingNodes.forEach(root -> evaluatePlanNode(
                root,
                root.quantity,
                applyRecipeBookCollapse,
                materials,
                processes,
                byproducts,
                supplies,
                coverage,
                byproductLinks));

        List<IngredientSummary> materialList = materials.values().stream()
                .map(MutableIngredientSummary::freeze)
                .toList();
        List<IngredientSummary> byproductList = byproducts.entrySet().stream()
                .map(entry -> new IngredientSummary(
                        entry.getValue().ingredient,
                        entry.getValue().gross,
                        useByproducts
                                ? remainingByproducts(supplies.get(entry.getKey()))
                                : entry.getValue().gross,
                        List.copyOf(entry.getValue().nodes)))
                .toList();
        return new PlanSummary(
                processes.values().stream().map(MutableProcessSummary::freeze).toList(),
                materialList,
                byproductList,
                Map.copyOf(coverage),
                List.copyOf(byproductLinks));
    }

    private void evaluatePlanNode(
            PlanNode node,
            long requested,
            boolean applyRecipeBookCollapse,
            LinkedHashMap<String, MutableIngredientSummary> materials,
            LinkedHashMap<String, MutableProcessSummary> processes,
            LinkedHashMap<String, MutableIngredientSummary> byproducts,
            LinkedHashMap<String, List<MutableByproductSupply>> supplies,
            Map<PlanNode, ByproductCoverage> coverage,
            List<ByproductLink> byproductLinks) {
        if (node.manualReusableInput) return;
        long demand = Math.max(1, requested);
        ByproductConsumption consumption = consumeMatchingByproducts(node, demand, supplies);
        long covered = consumption.amount;
        if (covered > 0) {
            coverage.put(node, new ByproductCoverage(covered, demand));
            byproductLinks.addAll(consumption.links);
        }
        long remainingDemand = useByproducts
                ? RecipeQuantityMath.remainingAfterSupply(demand, covered)
                : demand;
        boolean collapsed = applyRecipeBookCollapse && isRecipeBookCollapsed(node);
        if (node.recipe == null || collapsed) {
            addSummaryAmount(
                    materials,
                    summaryIngredientKey(node.ingredient),
                    node.ingredient,
                    demand,
                    remainingDemand,
                    node);
            return;
        }
        if (remainingDemand <= 0) return;

        long crafts = RecipeQuantityMath.craftsForRemaining(
                remainingDemand, node.outputPerCraft);
        String processKey = processKey(node);
        MutableProcessSummary process = processes.computeIfAbsent(
                processKey,
                ignored -> new MutableProcessSummary(
                        processKey,
                        processTitle(node),
                        processColor(processKey),
                        processMachine(node)));
        if (!process.nodes.contains(node)) process.nodes.add(node);
        process.crafts = RecipeQuantityMath.safeAdd(process.crafts, crafts);

        for (PlanNode child : node.children) {
            evaluatePlanNode(
                    child,
                    RecipeQuantityMath.inputTotal(child.quantityPerParentCraft, crafts),
                    applyRecipeBookCollapse,
                    materials,
                    processes,
                    byproducts,
                    supplies,
                    coverage,
                    byproductLinks);
        }
        addRecipeByproducts(
                node,
                remainingDemand,
                crafts,
                byproducts,
                supplies);
    }

    private ItemStack processMachine(PlanNode node) {
        if (node.recipe == null) return ItemStack.EMPTY;
        try {
            return runtime.getRecipeManager()
                    .createRecipeCatalystLookup(node.recipe.category.getRecipeType())
                    .get()
                    .map(this::ingredientItemStack)
                    .filter(stack -> !stack.isEmpty())
                    .findFirst()
                    .map(stack -> stack.copyWithCount(1))
                    .orElse(ItemStack.EMPTY);
        } catch (RuntimeException error) {
            JeiExportMod.LOGGER.debug(
                    "Could not resolve a live machine item for recipe type {}",
                    node.recipe.category.getRecipeType().getUid(),
                    error);
            return ItemStack.EMPTY;
        }
    }

    private ByproductConsumption consumeMatchingByproducts(
            PlanNode node,
            long requested,
            Map<String, List<MutableByproductSupply>> supplies) {
        List<ITypedIngredient<?>> accepted = new ArrayList<>();
        accepted.add(node.ingredient);
        node.ingredientOptions.stream()
                .filter(option -> !sameIngredient(option, node.ingredient))
                .forEach(accepted::add);
        long covered = 0;
        List<ByproductLink> links = new ArrayList<>();
        for (ITypedIngredient<?> option : accepted) {
            if (covered >= requested) break;
            String optionKey = summaryIngredientKey(option);
            for (MutableByproductSupply supply : supplies.getOrDefault(optionKey, List.of())) {
                if (covered >= requested) break;
                long used = Math.min(requested - covered, supply.remaining);
                if (used <= 0) continue;
                covered = RecipeQuantityMath.safeAdd(covered, used);
                supply.remaining -= used;
                links.add(new ByproductLink(supply.source, node, used));
            }
        }
        return new ByproductConsumption(covered, List.copyOf(links));
    }

    private static long remainingByproducts(List<MutableByproductSupply> supplies) {
        if (supplies == null) return 0;
        long remaining = 0;
        for (MutableByproductSupply supply : supplies) {
            remaining = RecipeQuantityMath.safeAdd(remaining, supply.remaining);
        }
        return remaining;
    }

    private void collectSummaryNodes(
            PlanNode node,
            List<PlanNode> recipeNodes,
            List<PlanNode> materialNodes,
            boolean applyRecipeBookCollapse) {
        if (node.recipe == null || applyRecipeBookCollapse && isRecipeBookCollapsed(node)) {
            materialNodes.add(node);
            return;
        }
        recipeNodes.add(node);
        node.children.forEach(child -> collectSummaryNodes(
                child, recipeNodes, materialNodes, applyRecipeBookCollapse));
    }

    private void addRecipeByproducts(
            PlanNode node,
            long consumedPrimary,
            long crafts,
            LinkedHashMap<String, MutableIngredientSummary> totals,
            LinkedHashMap<String, List<MutableByproductSupply>> supplies) {
        long outputPerCraft = node.outputPerCraft;
        long primarySurplus = RecipeQuantityMath.surplusAfterCrafts(
                consumedPrimary, outputPerCraft, crafts);
        if (primarySurplus > 0) {
            String key = summaryIngredientKey(node.ingredient);
            addSummaryAmount(
                    totals,
                    key,
                    node.ingredient,
                    primarySurplus,
                    primarySurplus,
                    node);
            addByproductSupply(supplies, key, node, primarySurplus);
        }

        for (IRecipeSlotView slot : node.recipe.requireLayout().getRecipeSlotsView()
                .getSlotViews(RecipeIngredientRole.OUTPUT)) {
            Optional<ITypedIngredient<?>> output = slot.getDisplayedIngredient()
                    .filter(ingredient -> !ItemCatalog.isEmptyIngredient(ingredient));
            if (output.isEmpty()) {
                output = slot.getAllIngredients()
                        .filter(ingredient -> !ItemCatalog.isEmptyIngredient(ingredient))
                        .findFirst();
                if (output.isPresent() && loggedByproductOutputFallbackRecipes.add(node.recipe.key)) {
                    JeiExportMod.LOGGER.warn(
                            "Recipe {} has an output slot without a displayed JEI ingredient; "
                                    + "using the slot's first available ingredient for its byproduct ledger",
                            node.recipe.key);
                }
            }
            if (output.isEmpty() || sameIngredient(output.get(), node.ingredient)) continue;
            long amount = RecipeQuantityMath.producedTotal(ingredientAmount(output.get()), crafts);
            String key = summaryIngredientKey(output.get());
            addSummaryAmount(
                    totals,
                    key,
                    output.get(),
                    amount,
                    amount,
                    node);
            addByproductSupply(supplies, key, node, amount);
        }
    }

    private static void addByproductSupply(
            LinkedHashMap<String, List<MutableByproductSupply>> supplies,
            String key,
            PlanNode source,
            long amount) {
        List<MutableByproductSupply> entries = supplies.computeIfAbsent(
                key,
                ignored -> new ArrayList<>());
        for (MutableByproductSupply entry : entries) {
            if (entry.source == source) {
                entry.remaining = RecipeQuantityMath.safeAdd(entry.remaining, amount);
                return;
            }
        }
        entries.add(new MutableByproductSupply(source, amount));
    }

    private void addSummaryAmount(
            LinkedHashMap<String, MutableIngredientSummary> totals,
            String key,
            ITypedIngredient<?> ingredient,
            long gross,
            long remaining,
            PlanNode sourceNode) {
        MutableIngredientSummary total = totals.computeIfAbsent(
                key,
                ignored -> new MutableIngredientSummary(ingredient));
        total.gross = RecipeQuantityMath.safeAdd(total.gross, gross);
        total.remaining = RecipeQuantityMath.safeAdd(total.remaining, remaining);
        if (!total.nodes.contains(sourceNode)) total.nodes.add(sourceNode);
    }

    private String summaryIngredientKey(ITypedIngredient<?> ingredient) {
        try {
            return ingredientKey(ingredient);
        } catch (RuntimeException error) {
            String type = IngredientKeys.typePrefix(ingredient.getType());
            if (loggedSummaryKeyFallbackTypes.add(type)) {
                JeiExportMod.LOGGER.warn(
                        "Could not obtain a stable JEI key for summary ingredient type {}; "
                                + "using its runtime representation",
                        type,
                        error);
            }
            return type + "|runtime|" + ingredient.getIngredient();
        }
    }

    private String formatIngredientQuantity(ITypedIngredient<?> ingredient, long quantity) {
        if (ingredient.getItemStack().filter(stack -> !stack.isEmpty()).isPresent()) {
            return quantity + "x";
        }
        if (ingredient.getIngredient() instanceof FluidStack) return quantity + " mB";
        return Long.toString(quantity);
    }

    private void renderInspectorPanel(
            GuiGraphics graphics,
            PlanSummary summary,
            int mouseX,
            int mouseY,
            List<RecipeBoxHitbox> boxes,
            PlanNode hoveredPlanNode) {
        if (summaryPanelArea == null) return;
        int left = summaryPanelArea.left;
        int top = summaryPanelArea.top;
        int right = left + summaryPanelArea.width;
        int bottom = top + summaryPanelArea.height;
        graphics.fill(left, top, right, bottom, 0xc8202421);
        graphics.fill(left, top, right, top + 1, 0xff52624d);
        renderInspectorTabs(graphics, mouseX, mouseY);

        SummarySectionBounds content = new SummarySectionBounds(
                left,
                top + 22,
                summaryPanelArea.width,
                Math.max(1, summaryPanelArea.height - 22));
        materialSummaryArea = null;
        byproductSummaryArea = null;
        processSummaryArea = null;
        summaryRows = List.of();
        processRows = List.of();
        if (hoveredPlanNode == null && content.contains(mouseX, mouseY)) hoveredPlanNode = inspectedNode;
        inspectedNode = hoveredPlanNode;
        if (hoveredPlanNode != null) {
            int footerHeight = hoveredPlanNode.parent == null ? 18 : 42;
            int desiredPreviewHeight = hoveredPlanNode.recipe == null ? 64
                    : 28 + Math.min(90, recipeRectWithBorder(hoveredPlanNode.recipe.requireLayout()).getHeight());
            int previewHeight = Math.min(desiredPreviewHeight,
                    Math.max(28, content.height - footerHeight - 64));
            SummarySectionBounds preview = new SummarySectionBounds(
                    content.left, content.top, content.width, previewHeight);
            renderRecipePreview(graphics, preview, hoveredPlanNode, mouseX, mouseY, boxes);
            int footerY = preview.top + preview.height;
            graphics.fill(content.left, footerY, content.left + content.width, footerY + footerHeight, 0xf0181a1b);
            graphics.drawString(font, "Required: " + formatIngredientQuantity(hoveredPlanNode.ingredient, hoveredPlanNode.quantity),
                    content.left + 4, footerY + 3, 0xffd7e6ce, false);
            if (hoveredPlanNode.parent != null) {
                reusableToggleArea = new SummarySectionBounds(content.left + 4, footerY + 17, Math.max(1, content.width - 8), 20);
                graphics.fill(reusableToggleArea.left, reusableToggleArea.top,
                        reusableToggleArea.left + reusableToggleArea.width, reusableToggleArea.top + 20, 0xff354331);
                graphics.drawString(font, "Reusable: " + (hoveredPlanNode.manualReusableInput ? "ON" : "OFF") + " (R)",
                        reusableToggleArea.left + 4, reusableToggleArea.top + 6, 0xffffffff, false);
            }
            int summaryTop = footerY + footerHeight + 6;
            content = new SummarySectionBounds(content.left, summaryTop, content.width,
                    Math.max(1, content.top + content.height - summaryTop));
        }

        List<SummaryRowHitbox> rows = new ArrayList<>();
        if (inspectorTab == InspectorTab.TYPES) {
            processSummaryArea = content;
            List<ProcessRowHitbox> processHitboxes = new ArrayList<>();
            processSummaryScroll = renderProcessSection(
                    graphics,
                    content,
                    summary.processes,
                    processSummaryScroll,
                    mouseX,
                    mouseY,
                    processHitboxes);
            processRows = List.copyOf(processHitboxes);
        } else if (inspectorTab == InspectorTab.MATERIALS) {
            materialSummaryArea = content;
            materialSummaryScroll = renderSummarySection(
                    graphics,
                    content,
                    "Materials (" + summary.materials.size() + ")",
                    summary.materials,
                    SummaryKind.MATERIAL,
                    materialSummaryScroll,
                    mouseX,
                    mouseY,
                    rows);
        } else {
            byproductsToggleArea = new SummarySectionBounds(content.left + 4, content.top, content.width - 8, 20);
            graphics.fill(content.left, content.top, content.left + content.width, content.top + 20, 0xff354331);
            graphics.drawString(font, "Use byproducts: " + (useByproducts ? "ON" : "OFF"), content.left + 4, content.top + 6, 0xffffffff, false);
            content = new SummarySectionBounds(content.left, content.top + 24, content.width, Math.max(1, content.height - 24));
            byproductSummaryArea = content;
            if (compactMode) {
                byproductSummaryScroll = renderSummaryGrid(
                        graphics,
                        content,
                        summary.byproducts,
                        SummaryKind.BYPRODUCT,
                        byproductSummaryScroll,
                        mouseX,
                        mouseY,
                        rows);
            } else {
                byproductSummaryScroll = renderSummarySection(
                        graphics,
                        content,
                        "Byproducts (" + summary.byproducts.size() + ")",
                        summary.byproducts,
                        SummaryKind.BYPRODUCT,
                        byproductSummaryScroll,
                        mouseX,
                        mouseY,
                        rows);
            }
        }
        summaryRows = List.copyOf(rows);
    }

    private int renderProcessSection(
            GuiGraphics graphics,
            SummarySectionBounds bounds,
            List<ProcessSummary> entries,
            int requestedScroll,
            int mouseX,
            int mouseY,
            List<ProcessRowHitbox> rows) {
        int contentTop = bounds.top + 18;
        int visibleRows = Math.max(0, (bounds.height - 20) / SUMMARY_ROW_HEIGHT);
        int maximumScroll = Math.max(0, entries.size() - visibleRows);
        int scroll = Mth.clamp(requestedScroll, 0, maximumScroll);
        String title = "Types (" + entries.size() + ")";
        graphics.drawString(font,
                font.plainSubstrByWidth(title, Math.max(1, bounds.width - 10)),
                bounds.left + 5,
                bounds.top + 5,
                0xffd7e6ce,
                false);

        graphics.enableScissor(
                bounds.left,
                contentTop,
                bounds.left + bounds.width,
                bounds.top + bounds.height);
        for (int visibleIndex = 0; visibleIndex < visibleRows; visibleIndex++) {
            int entryIndex = scroll + visibleIndex;
            if (entryIndex >= entries.size()) break;
            ProcessSummary entry = entries.get(entryIndex);
            int rowTop = contentTop + visibleIndex * SUMMARY_ROW_HEIGHT;
            boolean hovered = mouseX >= bounds.left && mouseX < bounds.left + bounds.width
                    && mouseY >= rowTop && mouseY < rowTop + SUMMARY_ROW_HEIGHT;
            boolean selected = entry.key.equals(selectedProcessKey);
            if (hovered || selected) {
                graphics.fill(bounds.left + 2, rowTop, bounds.left + bounds.width - 2,
                        rowTop + SUMMARY_ROW_HEIGHT,
                        selected ? 0x9052634d : 0x704c5d46);
            }
            boolean machineHovered = !entry.machine.isEmpty()
                    && mouseX >= bounds.left + 2 && mouseX < bounds.left + 22
                    && mouseY >= rowTop && mouseY < rowTop + SUMMARY_ROW_HEIGHT;
            graphics.fill(bounds.left + 2, rowTop, bounds.left + 22,
                    rowTop + SUMMARY_ROW_HEIGHT,
                    machineHovered ? 0xff4c5d46 : 0xff293029);
            graphics.fill(bounds.left + 2, rowTop, bounds.left + 22,
                    rowTop + 1, entry.color);
            if (!entry.machine.isEmpty()) {
                graphics.renderItem(entry.machine, bounds.left + 4, rowTop + 2);
            } else if (!entry.nodes.isEmpty()) {
                IDrawable machineIcon = entry.nodes.get(0).recipe.category.getIcon();
                if (machineIcon != null) {
                    machineIcon.draw(graphics, bounds.left + 4, rowTop + 2);
                }
            }
            String usage = entry.crafts + (entry.crafts == 1 ? " use" : " uses");
            int usageLeft = bounds.left + bounds.width - 5 - font.width(usage);
            int nameWidth = Math.max(1, usageLeft - (bounds.left + 24) - 4);
            graphics.drawString(
                    font,
                    font.plainSubstrByWidth(entry.title, nameWidth),
                    bounds.left + 24,
                    rowTop + 6,
                    selected ? 0xffffffff : 0xffd7e6ce,
                    false);
            graphics.drawString(font, usage, usageLeft, rowTop + 6, 0xffaeb7aa, false);
            rows.add(new ProcessRowHitbox(
                    entry,
                    bounds.left,
                    rowTop,
                    bounds.width,
                    SUMMARY_ROW_HEIGHT));
        }
        graphics.disableScissor();
        if (maximumScroll > 0) {
            String position = (scroll + 1) + "-" + Math.min(entries.size(), scroll + visibleRows)
                    + "/" + entries.size();
            graphics.drawString(font, position,
                    bounds.left + bounds.width - 5 - font.width(position),
                    bounds.top + 5,
                    0xff8f9b8b,
                    false);
        }
        return scroll;
    }

    private void renderInspectorTabs(GuiGraphics graphics, int mouseX, int mouseY) {
        int left = summaryPanelArea.left;
        int top = summaryPanelArea.top + 2;
        int width = summaryPanelArea.width;
        List<InspectorTabHitbox> hitboxes = new ArrayList<>();
        InspectorTab[] tabs = InspectorTab.values();
        for (int index = 0; index < tabs.length; index++) {
            InspectorTab tab = tabs[index];
            int tabLeft = left + width * index / tabs.length;
            int tabRight = left + width * (index + 1) / tabs.length;
            boolean selected = inspectorTab == tab;
            boolean hovered = mouseX >= tabLeft && mouseX < tabRight
                    && mouseY >= top && mouseY < top + 18;
            graphics.fill(tabLeft, top, tabRight - 1, top + 18,
                    selected ? 0xff405239 : (hovered ? 0xff343b34 : 0xff252925));
            graphics.fill(tabLeft, top + 17, tabRight - 1, top + 18,
                    selected ? 0xff9fcf7f : 0xff394139);
            String label = font.plainSubstrByWidth(tab.label, Math.max(1, tabRight - tabLeft - 4));
            graphics.drawCenteredString(font, label, (tabLeft + tabRight - 1) / 2, top + 5,
                    selected ? 0xffffffff : 0xffaeb7aa);
            hitboxes.add(new InspectorTabHitbox(tab, tabLeft, top, tabRight - tabLeft, 18));
        }
        inspectorTabs = List.copyOf(hitboxes);
    }

    private int renderSummarySection(
            GuiGraphics graphics,
            SummarySectionBounds bounds,
            String title,
            List<IngredientSummary> entries,
            SummaryKind kind,
            int requestedScroll,
            int mouseX,
            int mouseY,
            List<SummaryRowHitbox> rows) {
        int contentTop = bounds.top + 18;
        int visibleRows = Math.max(0, (bounds.height - 20) / SUMMARY_ROW_HEIGHT);
        int maximumScroll = Math.max(0, entries.size() - visibleRows);
        int scroll = Mth.clamp(requestedScroll, 0, maximumScroll);
        int titleColor = kind == SummaryKind.MATERIAL ? 0xffd7e6ce : 0xffffc857;
        String fittedTitle = font.plainSubstrByWidth(title, Math.max(1, bounds.width - 10));
        graphics.drawString(font, fittedTitle, bounds.left + 5, bounds.top + 5, titleColor, false);

        graphics.enableScissor(
                bounds.left,
                contentTop,
                bounds.left + bounds.width,
                bounds.top + bounds.height);
        for (int visibleIndex = 0; visibleIndex < visibleRows; visibleIndex++) {
            int entryIndex = scroll + visibleIndex;
            if (entryIndex >= entries.size()) break;
            IngredientSummary entry = entries.get(entryIndex);
            int rowTop = contentTop + visibleIndex * SUMMARY_ROW_HEIGHT;
            boolean hovered = mouseX >= bounds.left && mouseX < bounds.left + bounds.width
                    && mouseY >= rowTop && mouseY < rowTop + SUMMARY_ROW_HEIGHT;
            if (hovered) {
                graphics.fill(bounds.left + 2, rowTop, bounds.left + bounds.width - 2,
                        rowTop + SUMMARY_ROW_HEIGHT, 0x704c5d46);
            }
            renderIngredient(graphics, entry.ingredient, bounds.left + 4, rowTop + 2, 16);
            boolean undiscovered = isUndiscovered(entry.ingredient);
            if (undiscovered) {
                graphics.drawString(font, "?", bounds.left + 16, rowTop + 1,
                        0xff8fc1ff, false);
            }
            String amount = entry.remaining == 0
                    ? (kind == SummaryKind.MATERIAL ? "covered" : "used")
                    : formatIngredientQuantity(entry.ingredient, entry.remaining);
            int amountColor = entry.remaining < entry.gross
                    ? (kind == SummaryKind.MATERIAL ? 0xff70db8c : 0xffffc857)
                    : 0xffffffff;
            int amountLeft = bounds.left + bounds.width - 5 - font.width(amount);
            int nameWidth = Math.max(1, amountLeft - (bounds.left + 24) - 4);
            String name = font.plainSubstrByWidth(ingredientDisplayName(entry.ingredient), nameWidth);
            graphics.drawString(font, name, bounds.left + 24, rowTop + 6,
                    undiscovered ? 0xff8fc1ff : 0xffd7e6ce, false);
            graphics.drawString(font, amount, amountLeft, rowTop + 6, amountColor, false);
            rows.add(new SummaryRowHitbox(
                    entry,
                    kind,
                    bounds.left,
                    rowTop,
                    bounds.width,
                    SUMMARY_ROW_HEIGHT));
        }
        graphics.disableScissor();
        if (maximumScroll > 0) {
            String position = (scroll + 1) + "-" + Math.min(entries.size(), scroll + visibleRows)
                    + "/" + entries.size();
            graphics.drawString(font, position,
                    bounds.left + bounds.width - 5 - font.width(position),
                    bounds.top + 5,
                    0xff8f9b8b,
                    false);
        }
        return scroll;
    }

    private int renderSummaryGrid(
            GuiGraphics graphics,
            SummarySectionBounds bounds,
            List<IngredientSummary> entries,
            SummaryKind kind,
            int requestedScrollRow,
            int mouseX,
            int mouseY,
            List<SummaryRowHitbox> rows) {
        int columns = summaryGridColumns(bounds);
        int visibleRows = summaryGridVisibleRows(bounds);
        int totalRows = (entries.size() + columns - 1) / columns;
        int maximumScrollRow = Math.max(0, totalRows - visibleRows);
        int scrollRow = Mth.clamp(requestedScrollRow, 0, maximumScrollRow);
        int step = SUMMARY_GRID_CELL_SIZE + SUMMARY_GRID_GAP;
        int gridWidth = columns * step - SUMMARY_GRID_GAP;
        int gridLeft = bounds.left + Math.max(
                SUMMARY_GRID_PADDING,
                (bounds.width - gridWidth) / 2);
        int gridTop = bounds.top + SUMMARY_GRID_PADDING;

        graphics.enableScissor(
                bounds.left,
                bounds.top,
                bounds.left + bounds.width,
                bounds.top + bounds.height);
        int firstIndex = scrollRow * columns;
        int lastIndex = Math.min(entries.size(), firstIndex + visibleRows * columns);
        for (int index = firstIndex; index < lastIndex; index++) {
            int visibleIndex = index - firstIndex;
            int column = visibleIndex % columns;
            int row = visibleIndex / columns;
            int left = gridLeft + column * step;
            int top = gridTop + row * step;
            IngredientSummary entry = entries.get(index);
            boolean hovered = contains(left, top, SUMMARY_GRID_CELL_SIZE, mouseX, mouseY);
            graphics.fill(
                    left,
                    top,
                    left + SUMMARY_GRID_CELL_SIZE,
                    top + SUMMARY_GRID_CELL_SIZE,
                    hovered ? 0xff4c5d46 : 0xff293029);
            if (hovered) {
                graphics.fill(left, top,
                        left + SUMMARY_GRID_CELL_SIZE, top + 1, 0xff9fcf7f);
            }
            renderIngredient(graphics, entry.ingredient, left + 6, top + 6, 16);
            if (isUndiscovered(entry.ingredient)) {
                graphics.fill(left, top,
                        left + SUMMARY_GRID_CELL_SIZE,
                        top + SUMMARY_GRID_CELL_SIZE,
                        0x70070d18);
                graphics.fill(left, top,
                        left + SUMMARY_GRID_CELL_SIZE, top + 1, 0xff6fa8ff);
                graphics.drawString(font, "?",
                        left + SUMMARY_GRID_CELL_SIZE - 7, top + 2, 0xff8fc1ff, false);
            }
            rows.add(new SummaryRowHitbox(
                    entry,
                    kind,
                    left,
                    top,
                    SUMMARY_GRID_CELL_SIZE,
                    SUMMARY_GRID_CELL_SIZE));
        }
        graphics.disableScissor();

        if (maximumScrollRow > 0) {
            int trackLeft = bounds.left + bounds.width - 3;
            int trackTop = bounds.top + SUMMARY_GRID_PADDING;
            int trackHeight = Math.max(1, bounds.height - SUMMARY_GRID_PADDING * 2);
            int thumbHeight = Math.max(10,
                    trackHeight * visibleRows / Math.max(1, totalRows));
            int travel = Math.max(0, trackHeight - thumbHeight);
            int thumbTop = trackTop + travel * scrollRow / maximumScrollRow;
            graphics.fill(trackLeft, trackTop, trackLeft + 1,
                    trackTop + trackHeight, 0xff394139);
            graphics.fill(trackLeft, thumbTop, trackLeft + 1,
                    thumbTop + thumbHeight, 0xff9fcf7f);
        }
        return scrollRow;
    }

    private static int summaryGridColumns(SummarySectionBounds bounds) {
        return Math.max(1,
                (bounds.width - SUMMARY_GRID_PADDING * 2 + SUMMARY_GRID_GAP)
                        / (SUMMARY_GRID_CELL_SIZE + SUMMARY_GRID_GAP));
    }

    private static int summaryGridVisibleRows(SummarySectionBounds bounds) {
        return Math.max(1,
                (bounds.height - SUMMARY_GRID_PADDING * 2 + SUMMARY_GRID_GAP)
                        / (SUMMARY_GRID_CELL_SIZE + SUMMARY_GRID_GAP));
    }

    private void renderSummaryTooltip(GuiGraphics graphics, int mouseX, int mouseY) {
        processRows.stream()
                .filter(row -> row.contains(mouseX, mouseY))
                .findFirst()
                .ifPresent(row -> {
                    if (row.containsMachine(mouseX, mouseY) && !row.entry.machine.isEmpty()) {
                        graphics.renderComponentTooltip(
                                font,
                                row.entry.machine.getTooltipLines(
                                        minecraft.player,
                                        minecraft.options.advancedItemTooltips
                                                ? TooltipFlag.Default.ADVANCED
                                                : TooltipFlag.Default.NORMAL),
                                mouseX,
                                mouseY);
                        return;
                    }
                    List<Component> tooltip = new ArrayList<>();
                    tooltip.add(Component.literal(row.entry.title).withStyle(ChatFormatting.WHITE));
                    tooltip.add(Component.literal(row.entry.crafts
                                    + (row.entry.crafts == 1 ? " total use" : " total uses"))
                            .withStyle(ChatFormatting.GRAY));
                    tooltip.add(Component.literal(row.entry.key.equals(selectedProcessKey)
                                    ? "Click: clear highlight"
                                    : "Click: highlight matching nodes")
                            .withStyle(ChatFormatting.DARK_GRAY));
                    graphics.renderComponentTooltip(font, tooltip, mouseX, mouseY);
                });
        summaryRows.stream()
                .filter(row -> row.contains(mouseX, mouseY))
                .findFirst()
                .ifPresent(row -> {
                    List<Component> tooltip = new ArrayList<>(ingredientTooltip(row.entry.ingredient));
                    appendDiscoveryTooltip(tooltip, row.entry.ingredient);
                    String totalLabel = row.kind == SummaryKind.MATERIAL
                            ? "Gross material demand: "
                            : "Total byproduct: ";
                    tooltip.add(Component.literal(totalLabel
                            + formatIngredientQuantity(row.entry.ingredient, row.entry.gross))
                            .withStyle(ChatFormatting.GRAY));
                    if (row.entry.remaining < row.entry.gross) {
                        String remainingLabel = row.kind == SummaryKind.MATERIAL
                                ? "Still required: "
                                : "Remaining byproduct: ";
                        tooltip.add(Component.literal(remainingLabel
                                + formatIngredientQuantity(row.entry.ingredient, row.entry.remaining))
                                .withStyle(row.kind == SummaryKind.MATERIAL
                                        ? ChatFormatting.GREEN
                                        : ChatFormatting.GOLD));
                    }
                    String action = row.kind == SummaryKind.MATERIAL
                            ? "Click: select input recipe"
                            : (row.entry.nodes.size() > 1
                                    ? "Click: cycle through source nodes"
                                    : "Click: center source node");
                    tooltip.add(Component.literal(action).withStyle(ChatFormatting.DARK_GRAY));
                    graphics.renderComponentTooltip(font, tooltip, mouseX, mouseY);
                });
    }

    private void renderTreeTooltip(
            GuiGraphics graphics,
            List<TreeNode> nodes,
            int mouseX,
            int mouseY) {
        if (!insideTreeViewport(mouseX, mouseY)) return;
        nodes.stream()
                .filter(node -> node.contains(mouseX, mouseY))
                .findFirst()
                .filter(node -> !compactMode || node.node.recipe == null)
                .ifPresent(node -> {
                    List<Component> tooltip = new ArrayList<>(ingredientTooltip(node.node.ingredient));
                    graphics.renderComponentTooltip(font, tooltip, mouseX, mouseY);
                });
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0 && reusableToggleArea != null && reusableToggleArea.contains(mouseX, mouseY)) {
            toggleReusable(inspectedNode);
            return true;
        }
        if (button == 0 && byproductsToggleArea != null && byproductsToggleArea.contains(mouseX, mouseY)) {
            toggleByproducts();
            return true;
        }
        if (super.mouseClicked(mouseX, mouseY, button)) return true;
        if ((button != 0 && button != 1 && button != 2) || minecraft == null) return false;
        if (button == 0) {
            Optional<StartingNodeRemoveHitbox> selectedRemove = startingNodeRemoveButtons.stream()
                    .filter(remove -> remove.contains(mouseX, mouseY))
                    .findFirst();
            if (selectedRemove.isPresent()) {
                removeStartingNode(selectedRemove.get().node);
                return true;
            }
            Optional<InspectorTabHitbox> selectedTab = inspectorTabs.stream()
                    .filter(tab -> tab.contains(mouseX, mouseY))
                    .findFirst();
            if (selectedTab.isPresent()) {
                inspectorTab = selectedTab.get().tab;
                summaryRows = List.of();
                processRows = List.of();
                materialSummaryArea = null;
                byproductSummaryArea = null;
                processSummaryArea = null;
                status = "";
                return true;
            }
            Optional<ProcessRowHitbox> selectedProcessMachine = processRows.stream()
                    .filter(row -> row.containsMachine(mouseX, mouseY))
                    .filter(row -> !row.entry.machine.isEmpty())
                    .findFirst();
            if (selectedProcessMachine.isPresent()) {
                openProcessMachine(selectedProcessMachine.get().entry.machine);
                return true;
            }
            Optional<ProcessRowHitbox> selectedProcess = processRows.stream()
                    .filter(row -> row.contains(mouseX, mouseY))
                    .findFirst();
            if (selectedProcess.isPresent()) {
                toggleProcessHighlight(selectedProcess.get().entry);
                return true;
            }
            Optional<SummaryRowHitbox> selectedSummary = summaryRows.stream()
                    .filter(row -> row.contains(mouseX, mouseY))
                    .findFirst();
            if (selectedSummary.isPresent()) {
                activateSummaryRow(selectedSummary.get());
                return true;
            }
        }

        Optional<TreeNode> selectedNode = insideTreeViewport(mouseX, mouseY)
                ? treeNodes.stream().filter(node -> node.contains(mouseX, mouseY)).findFirst()
                : Optional.empty();
        if (selectedNode.isPresent()) {
            TreeNode node = selectedNode.get();
            if (button == 0) {
                openInputRecipePicker(node.node);
            } else if (button == 1) {
                openOutputPicker(node.node);
            } else if (node.node.hasIngredientOptions()) {
                openIngredientOptionGrid(node.node);
            } else {
                treePanning = true;
            }
            return true;
        }

        Optional<RecipeBoxHitbox> selectedBox = recipeBoxes.stream()
                .filter(box -> box.contains(mouseX, mouseY))
                .findFirst();
        if (selectedBox.isPresent() && button != 2) {
            RecipeBoxHitbox box = selectedBox.get();
            Optional<IRecipeSlotView> slot = box.recipeSlotUnderMouse(mouseX, mouseY)
                    .map(value -> value);
            if (slot.isPresent()) {
                Optional<ITypedIngredient<?>> selected = slot.get().getDisplayedIngredient()
                        .filter(ingredient -> !ItemCatalog.isEmptyIngredient(ingredient));
                if (selected.isPresent()) {
                    if (button == 0) {
                        PlanNode planNode = slot.get().getRole() == RecipeIngredientRole.OUTPUT
                                ? box.node
                                : box.node.childFor(selected.get());
                        if (planNode != null) openInputRecipePicker(planNode);
                    } else {
                        PlanNode planNode = slot.get().getRole() == RecipeIngredientRole.OUTPUT
                                ? box.node
                                : box.node.childFor(selected.get());
                        if (planNode != null) openOutputPicker(planNode);
                    }
                    return true;
                }
            }
        }

        if ((button == 0 || button == 2) && insideTreeViewport(mouseX, mouseY)) {
            treePanning = true;
            return true;
        }
        return false;
    }

    private void activateSummaryRow(SummaryRowHitbox row) {
        if (row.entry.nodes.isEmpty()) {
            JeiExportMod.LOGGER.error(
                    "Cannot activate {} summary entry {} because it has no source tree node",
                    row.kind,
                    ingredientDisplayName(row.entry.ingredient));
            status = "Summary entry has no source node";
            return;
        }
        if (row.kind == SummaryKind.MATERIAL) {
            PlanNode materialNode = row.entry.nodes.get(0);
            previewNode = materialNode;
            openInputRecipePicker(materialNode);
            return;
        }

        String key = summaryIngredientKey(row.entry.ingredient);
        int sourceIndex = Math.floorMod(
                byproductCenterIndices.getOrDefault(key, 0),
                row.entry.nodes.size());
        PlanNode sourceNode = row.entry.nodes.get(sourceIndex);
        byproductCenterIndices.put(key, sourceIndex + 1);
        previewNode = sourceNode;
        if (centerTreeOnNode(sourceNode)) {
            status = row.entry.nodes.size() == 1
                    ? "Centered byproduct source"
                    : "Centered byproduct source " + (sourceIndex + 1) + "/" + row.entry.nodes.size();
        }
    }

    private void openProcessMachine(ItemStack machine) {
        ItemStack targetMachine = machine.copyWithCount(1);
        minecraft.setScreen(screenForOpenedItem(
                targetMachine,
                null,
                List.of(targetMachine),
                null));
    }

    private void toggleProcessHighlight(ProcessSummary process) {
        if (process.key.equals(selectedProcessKey)) {
            selectedProcessKey = null;
            status = "Type highlight cleared";
        } else {
            selectedProcessKey = process.key;
            status = process.title + " highlighted";
        }
    }

    @Override
    public boolean mouseDragged(
            double mouseX,
            double mouseY,
            int button,
            double dragX,
            double dragY) {
        if (treePanning && (button == 0 || button == 2)) {
            treePanX += dragX;
            treePanY += dragY;
            return true;
        }
        return super.mouseDragged(mouseX, mouseY, button, dragX, dragY);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (treePanning) {
            treePanning = false;
            return true;
        }
        return super.mouseReleased(mouseX, mouseY, button);
    }

    private boolean insideTreeViewport(double mouseX, double mouseY) {
        return mouseX >= treeViewportLeft && mouseX < treeViewportRight
                && mouseY >= treeViewportTop && mouseY < treeViewportBottom;
    }

    private void openInputRecipePicker(PlanNode selectedNode) {
        createInputRecipePicker(selectedNode).ifPresent(minecraft::setScreen);
    }

    private void openIngredientOptionGrid(PlanNode selectedNode) {
        createInputRecipePicker(selectedNode).ifPresent(screen -> {
            screen.openIngredientGrid();
            minecraft.setScreen(screen);
        });
    }

    Screen initialInputRecipeScreen() {
        String favorite = progress.favoriteRecipe(target);
        if (favorite != null) {
            if (rootNode.recipe != null && favorite.equals(rootNode.recipe.key)) return this;
            JeiExportMod.LOGGER.warn(
                    "Favorite recipe {} for {} is unavailable; opening the recipe chooser",
                    favorite,
                    target.getHoverName().getString());
        }
        return createInputRecipePicker(rootNode).<Screen>map(screen -> screen).orElse(this);
    }

    private Optional<RecipePickerScreen> createInputRecipePicker(PlanNode selectedNode) {
        ITypedIngredient<?> selected = selectedNode.ingredient;
        List<RecipePage<?>> choices = selectedNode == rootNode
                ? List.copyOf(pages)
                : collectPagesFor(selected, RecipeIngredientRole.OUTPUT);
        if (choices.isEmpty() && !selectedNode.hasIngredientOptions()) {
            status = "No input recipes found for " + ingredientDisplayName(selected);
            return Optional.empty();
        }
        return Optional.of(new RecipePickerScreen(
                PickerKind.INPUT_RECIPE,
                selected,
                selectedNode,
                choices.stream().map(page -> new RecipeChoice(selected, page, false)).toList()));
    }

    private void openOutputPicker(PlanNode selectedNode) {
        ITypedIngredient<?> selected = selectedNode.ingredient;
        List<RecipeChoice> choices = collectPagesFor(selected, RecipeIngredientRole.INPUT).stream()
                .map(page -> new RecipeChoice(selected, page, true))
                .toList();
        if (choices.isEmpty()) {
            status = "No recipe outputs found for " + ingredientDisplayName(selected);
            return;
        }
        minecraft.setScreen(new RecipePickerScreen(
                PickerKind.OUTPUT,
                selected,
                selectedNode,
                choices));
    }

    private void navigateHistory(int delta) {
        RecipeTreeScreen destination = history.move(delta);
        if (destination != null && minecraft != null) {
            minecraft.setScreen(destination);
        } else if (history.canMove(delta)) {
            status = "Saved recipe history entry is unavailable in this modpack";
        }
    }

    private void openHistory() {
        if (minecraft != null) minecraft.setScreen(new HistorySelectorScreen());
    }

    Screen screenForOpenedItem(ItemStack stack) {
        ItemStack openedItem = stack == null ? ItemStack.EMPTY : stack.copyWithCount(1);
        return screenForOpenedItem(
                openedItem,
                null,
                openedItem.isEmpty() ? List.of() : List.of(openedItem),
                null);
    }

    private Screen screenForOpenedItem(
            ItemStack stack,
            String preferredRecipeKey,
            List<ItemStack> nextPath,
            PlanNode previousRoot) {
        if (stack == null || stack.isEmpty()) return this;
        ITypedIngredient<?> typed = typedItem(stack.copyWithCount(1));
        PlanNode existingRoot = startingNodes.stream()
                .filter(node -> sameIngredient(node.ingredient, typed))
                .findFirst()
                .orElse(null);
        if (existingRoot != null) {
            if (preferredRecipeKey != null) {
                progress.saveFavoriteRecipe(stack, preferredRecipeKey);
                collectPagesFor(existingRoot.ingredient, RecipeIngredientRole.OUTPUT).stream()
                        .filter(page -> page.key.equals(preferredRecipeKey))
                        .filter(page -> page.layout().isPresent())
                        .findFirst()
                        .ifPresent(page -> {
                            history.beginEdit(this);
                            favoriteExpansionAttemptsRemaining = MAX_AUTOMATIC_FAVORITE_EXPANSIONS;
                            applyFavoriteRecipeEverywhere(existingRoot.ingredient, page, existingRoot);
                            startingNodes.forEach(this::expandFavoriteIngredients);
                            if (existingRoot == rootNode) selectRecipe(page.key);
                            history.finishEdit(this);
                        });
            }
            previewNode = existingRoot;
            if (treeViewportRight > treeViewportLeft && treeViewportBottom > treeViewportTop) {
                centerTreeOnNode(existingRoot);
            } else {
                centerTreeRequested = true;
            }
            status = stack.getHoverName().getString() + " is already a starting node";
            return this;
        }
        return new OpenItemChoiceScreen(
                stack.copyWithCount(1),
                preferredRecipeKey,
                nextPath,
                previousRoot);
    }

    private Screen createNewTreeScreen(
            ItemStack stack,
            String preferredRecipeKey,
            List<ItemStack> nextPath,
            PlanNode previousRoot) {
        if (preferredRecipeKey != null) {
            progress.saveFavoriteRecipe(stack, preferredRecipeKey);
        }
        RecipeTreeScreen next = new RecipeTreeScreen(
                stack.copyWithCount(1),
                runtime,
                nextPath,
                compactMode,
                preferredRecipeKey,
                history,
                true);
        if (previousRoot != null) next.attachPreviousRoot(previousRoot);
        return preferredRecipeKey == null ? next.initialInputRecipeScreen() : next;
    }

    private void addStartingNode(ItemStack stack) {
        addStartingNode(stack, null);
    }

    private void addStartingNode(ItemStack stack, String preferredRecipeKey) {
        if (stack == null || stack.isEmpty() || startingNodes.size() >= MAX_STARTING_NODES) return;
        if (preferredRecipeKey != null) {
            progress.saveFavoriteRecipe(stack, preferredRecipeKey);
        }
        ITypedIngredient<?> typed = typedItem(stack.copyWithCount(1));
        if (startingNodes.stream().anyMatch(node -> sameIngredient(node.ingredient, typed))) {
            status = stack.getHoverName().getString() + " is already a starting node";
            minecraft.setScreen(this);
            return;
        }
        history.beginEdit(this);
        PlanNode node = new PlanNode(stack.copyWithCount(1), requestedQuantity(), null, 0);
        boolean selectedPreferredRecipe = preferredRecipeKey != null
                && collectPagesFor(typed, RecipeIngredientRole.OUTPUT).stream()
                        .filter(page -> page.key.equals(preferredRecipeKey))
                        .filter(page -> page.layout().isPresent())
                        .findFirst()
                        .map(page -> {
                            node.setRecipe(page);
                            return true;
                        })
                        .orElse(false);
        if (!selectedPreferredRecipe) node.expandFavoriteRecipe();
        startingNodes.add(node);
        previewNode = node;
        invalidateTreeLayout();
        invalidatePlanSummary();
        treeViewInitialized = false;
        centerTreeRequested = true;
        history.finishEdit(this);
        status = "Added " + stack.getHoverName().getString() + " as starting node "
                + startingNodes.size();
        if (selectedPreferredRecipe) {
            minecraft.setScreen(this);
        } else {
            createInputRecipePicker(node)
                    .<Screen>map(screen -> screen)
                    .ifPresentOrElse(minecraft::setScreen, () -> minecraft.setScreen(this));
        }
    }

    private void removeStartingNode(ItemStack stack) {
        if (stack == null || stack.isEmpty() || startingNodes.size() <= 1) return;
        PlanNode removable = startingNodes.stream()
                .filter(node -> !node.stack.isEmpty()
                        && ItemStack.isSameItemSameTags(node.stack, stack))
                .findFirst()
                .orElse(null);
        removeStartingNode(removable);
    }

    private void removeStartingNode(PlanNode removable) {
        if (removable == null
                || startingNodes.size() <= 1
                || !startingNodes.contains(removable)) return;
        history.beginEdit(this);
        startingNodes.remove(removable);
        if (removable == rootNode) {
            rootNode = startingNodes.get(0);
            target = rootNode.stack.copyWithCount(1);
            targetFocus = runtime.getJeiHelpers().getFocusFactory().createFocus(
                    RecipeIngredientRole.OUTPUT, VanillaTypes.ITEM_STACK, target);
            path = List.of(target.copyWithCount(1));
            pages.clear();
            collectPages();
            pageIndex = 0;
            if (rootNode.recipe != null) selectRecipe(rootNode.recipe.key);
            requestedAmount = Long.toString(rootNode.quantity);
        }
        previewNode = rootNode;
        inspectedNode = null;
        startingNodeRemoveButtons = List.of();
        invalidateTreeLayout();
        invalidatePlanSummary();
        treeViewInitialized = false;
        centerTreeRequested = true;
        history.finishEdit(this);
        status = "Removed " + ingredientDisplayName(removable.ingredient) + " starting node";
        minecraft.setScreen(this);
    }

    private void toggleMode() {
        compactMode = !compactMode;
        treeNodes = List.of();
        recipeBoxes = List.of();
        startingNodeRemoveButtons = List.of();
        visibleRecipePages = List.of();
        invalidateTreeLayout();
        treeViewInitialized = false;
        treeZoom = 1.0f;
        rebuildWidgets();
    }

    private void centerTree() {
        centerTreeRequested = true;
        status = "Tree centered";
    }

    private boolean centerTreeOnNode(PlanNode targetNode) {
        TreeLayoutNode node = currentTreeLayout().nodesByPlan.get(targetNode);
        if (node == null) {
            JeiExportMod.LOGGER.warn(
                    "Could not center the tree on byproduct source {} because its node is no longer in the plan",
                    ingredientDisplayName(targetNode.ingredient));
            status = "Byproduct source is no longer in the tree";
            return false;
        }
        double nodeCenterX = node.left + node.width / 2.0;
        double nodeCenterY = node.top + node.height / 2.0;
        int viewportWidth = Math.max(1, treeViewportRight - treeViewportLeft);
        int viewportHeight = Math.max(1, treeViewportBottom - treeViewportTop);
        treePanX = viewportWidth / 2.0 - nodeCenterX * treeZoom;
        treePanY = viewportHeight / 2.0 - nodeCenterY * treeZoom;
        treeViewInitialized = true;
        centerTreeRequested = false;
        return true;
    }

    private void toggleByproducts() {
        useByproducts = !useByproducts;
        invalidatePlanSummary();
        invalidateTreeLayout();
        updateButtons();
        status = useByproducts
                ? "Byproducts now reduce matching material requirements"
                : "Byproduct allocation disabled";
    }

    private void toggleRecipeBook() {
        recipeBookMode = !recipeBookMode;
        progress.setRecipeBookMode(recipeBookMode);
        invalidateTreeLayout();
        invalidatePlanSummary();
        treeViewInitialized = false;
        updateButtons();
        status = recipeBookMode
                ? "Discovered ingredients collapsed"
                : "Discovered ingredient branches restored";
    }

    private boolean isRecipeBookCollapsed(PlanNode node) {
        return recipeBookMode
                && node != null
                && node.parent != null
                && !node.stack.isEmpty()
                && progress.hasDiscovered(node.stack);
    }

    private boolean hasNoRecipes(PlanNode node) {
        if (node == null || node.recipe != null || node.stack.isEmpty()) return false;
        String key;
        try {
            key = ingredientKey(node.ingredient);
        } catch (RuntimeException error) {
            JeiExportMod.LOGGER.warn("Could not identify recipe availability ingredient", error);
            return false;
        }
        Boolean cached = noRecipeCache.get(key);
        if (cached != null) return cached;
        if (availabilityQueriesRemaining-- <= 0) return false;
        boolean noRecipes = node == rootNode
                ? pages.isEmpty()
                : !hasRecipe(node.ingredient);
        noRecipeCache.put(key, noRecipes);
        return noRecipes;
    }

    private <V> boolean hasRecipe(ITypedIngredient<V> ingredient) {
        if (ingredient.getItemStack().flatMap(ProjectEPlanner::recipe).isPresent()) return true;
        IFocus<V> focus = runtime.getJeiHelpers().getFocusFactory().createFocus(RecipeIngredientRole.OUTPUT, ingredient);
        return runtime.getRecipeManager().createRecipeCategoryLookup().limitFocus(List.of(focus)).get()
                .filter(category -> !RecipeExporter.isMetaCategory(category.getRecipeType().getUid()))
                .anyMatch(category -> runtime.getRecipeManager().createRecipeLookup(category.getRecipeType())
                        .limitFocus(List.of(focus)).get().findAny().isPresent());
    }

    private boolean isStartingNode(PlanNode node) {
        return node != null && startingNodes.contains(node);
    }

    private boolean isUndiscovered(PlanNode node) {
        return recipeBookMode && node != null && isUndiscovered(node.stack);
    }

    private boolean isDiscovered(PlanNode node) {
        return recipeBookMode
                && node != null
                && node.stack != null
                && !node.stack.isEmpty()
                && progress.hasDiscovered(node.stack);
    }

    private boolean isUndiscovered(ItemStack stack) {
        return recipeBookMode && stack != null && !stack.isEmpty() && !progress.hasDiscovered(stack);
    }

    private boolean isUndiscovered(ITypedIngredient<?> ingredient) {
        return recipeBookMode && ingredient != null
                && ingredient.getItemStack()
                .filter(stack -> !stack.isEmpty())
                .map(stack -> !progress.hasDiscovered(stack))
                .orElse(false);
    }

    private void appendDiscoveryTooltip(List<Component> tooltip, ITypedIngredient<?> ingredient) {
        if (!recipeBookMode || ingredient == null) return;
        ingredient.getItemStack()
                .filter(stack -> !stack.isEmpty())
                .ifPresent(stack -> tooltip.add(progress.hasDiscovered(stack)
                        ? Component.literal("Discovered").withStyle(ChatFormatting.GREEN)
                        : Component.literal("Undiscovered").withStyle(ChatFormatting.BLUE)));
    }

    private void expandFavoriteIngredients(PlanNode node) {
        if (node == null) return;
        if (node.recipe == null) node.expandFavoriteRecipe();
        List.copyOf(node.children).forEach(this::expandFavoriteIngredients);
    }

    private int applyFavoriteRecipeEverywhere(
            ITypedIngredient<?> ingredient,
            RecipePage<?> recipe,
            PlanNode explicitlySelectedNode) {
        int changed = 0;
        for (PlanNode root : startingNodes) {
            changed += applyFavoriteRecipeEverywhere(
                    root, ingredient, recipe, explicitlySelectedNode);
        }
        return changed;
    }

    private int applyFavoriteRecipeEverywhere(
            PlanNode node,
            ITypedIngredient<?> ingredient,
            RecipePage<?> recipe,
            PlanNode explicitlySelectedNode) {
        int changed = 0;
        if (sameIngredient(node.ingredient, ingredient)
                && (node == explicitlySelectedNode || !node.repeatsAncestorIngredient())
                && (node.recipe == null || !node.recipe.key.equals(recipe.key))) {
            node.setRecipe(recipe);
            changed++;
        }
        for (PlanNode child : List.copyOf(node.children)) {
            changed += applyFavoriteRecipeEverywhere(
                    child, ingredient, recipe, explicitlySelectedNode);
        }
        return changed;
    }

    private int clearFavoriteRecipeEverywhere(ITypedIngredient<?> ingredient) {
        int changed = 0;
        for (PlanNode root : startingNodes) {
            changed += clearFavoriteRecipeEverywhere(root, ingredient);
        }
        return changed;
    }

    private int clearFavoriteRecipeEverywhere(
            PlanNode node,
            ITypedIngredient<?> ingredient) {
        if (sameIngredient(node.ingredient, ingredient)) {
            boolean changed = node.recipe != null;
            node.clearRecipe();
            return changed ? 1 : 0;
        }
        int changed = 0;
        for (PlanNode child : List.copyOf(node.children)) {
            changed += clearFavoriteRecipeEverywhere(child, ingredient);
        }
        return changed;
    }

    private boolean isRecipePageSelected(PlanNode node, RecipePage<?> page) {
        if (node == null) return false;
        if (node.recipe == page) return true;
        return node.children.stream().anyMatch(child -> isRecipePageSelected(child, page));
    }

    private boolean isRecipePageSelected(RecipePage<?> page) {
        return startingNodes.stream().anyMatch(root -> isRecipePageSelected(root, page));
    }

    private void openJei() {
        runtime.getRecipesGui().show(targetFocus);
    }

    private void openJei(ITypedIngredient<?> ingredient) {
        openJeiTyped(ingredient);
    }

    private <T> void openJeiTyped(ITypedIngredient<T> ingredient) {
        IFocus<T> focus = runtime.getJeiHelpers().getFocusFactory().createFocus(
                RecipeIngredientRole.OUTPUT,
                ingredient);
        runtime.getRecipesGui().show(focus);
    }

    private String portableItemKey(ItemStack stack) {
        var helper = runtime.getIngredientManager().getIngredientHelper(VanillaTypes.ITEM_STACK);
        String uniqueId = helper.getUniqueId(stack, UidContext.Ingredient);
        if (uniqueId == null || uniqueId.isBlank()) {
            throw new IllegalStateException("JEI returned no portable identity for "
                    + stack.getHoverName().getString());
        }
        return "item|" + uniqueId;
    }

    private void appendSharedSelection(
            JsonArray selections,
            RecipeTreeProgress.RecipeHistorySelection historySelection) {
        if (historySelection.recipeKey() == null || historySelection.recipeKey().isBlank()) return;
        JsonObject selection = new JsonObject();
        JsonArray jsonPath = new JsonArray();
        historySelection.path().forEach(jsonPath::add);
        selection.add("path", jsonPath);
        selection.addProperty("itemKey", historySelection.ingredientKey());
        JsonObject source = new JsonObject();
        source.addProperty("kind", "recipe");
        source.addProperty("recipeKey", historySelection.recipeKey());
        selection.add("source", source);
        selections.add(selection);
    }

    private String sharedTreeJson() {
        JsonObject share = new JsonObject();
        share.addProperty("format", SHARE_FORMAT);
        share.addProperty("version", SHARE_VERSION);
        share.addProperty("createdAt", Instant.now().toString());
        JsonObject pack = new JsonObject();
        pack.addProperty("minecraftVersion", SharedConstants.getCurrentVersion().getName());
        try {
            PackIdentity identity = PackIdentityResolver.resolve(FMLPaths.GAMEDIR.get());
            pack.addProperty("name", identity.name());
            if (identity.version() != null) pack.addProperty("version", identity.version());
        } catch (Exception error) {
            JeiExportMod.LOGGER.warn(
                    "Could not resolve the installed pack identity for a shared tree history",
                    error);
            pack.addProperty("name", "In-game recipe viewer");
        }
        share.add("pack", pack);
        share.addProperty("rootKey", portableItemKey(target));
        share.addProperty("direction", "inputs");
        RecipeTreeProgress.RecipeHistoryEntry historySnapshot = historyEntry();
        JsonObject productionPlan = new JsonObject();
        productionPlan.addProperty("amount", rootNode.quantity);
        productionPlan.addProperty("windowSeconds", 1);
        share.add("productionPlan", productionPlan);
        JsonArray selections = new JsonArray();
        historySnapshot.selections().stream()
                .filter(selection -> selection.rootIndex() == 0)
                .forEach(selection -> appendSharedSelection(selections, selection));
        share.add("selections", selections);
        JsonArray reusable = new JsonArray();
        historySnapshot.selections().stream().filter(selection -> selection.rootIndex() == 0 && selection.reusableInput())
                .forEach(selection -> {
                    JsonObject value = new JsonObject();
                    JsonArray path = new JsonArray();
                    selection.path().forEach(path::add);
                    value.add("path", path);
                    value.addProperty("itemKey", selection.ingredientKey());
                    reusable.add(value);
                });
        share.add("reusableInputs", reusable);
        return SHARE_GSON.toJson(share);
    }

    private void shareTree() {
        if (minecraft == null) return;
        try {
            String json = sharedTreeJson();
            minecraft.keyboardHandler.setClipboard(json);
            Path directory = RecipeTreeShareFiles.directory(FMLPaths.CONFIGDIR.get());
            Files.createDirectories(directory);
            Path output = directory.resolve("tree-" + java.util.UUID.randomUUID() + ".mrtree.json");
            Files.writeString(output, json, StandardCharsets.UTF_8, java.nio.file.StandardOpenOption.CREATE_NEW);
            minecraft.setScreen(new ShareInstructionsScreen(output.getFileName().toString()));
        } catch (Exception error) {
            JeiExportMod.LOGGER.error("Could not share the current recipe tree", error);
            status = "Tree share failed: " + error.getMessage();
        }
    }

    private ItemStack itemForPortableKey(String key) {
        var manager = runtime.getIngredientManager();
        for (ItemStack candidate : manager.getAllIngredients(VanillaTypes.ITEM_STACK)) {
            try {
                if (portableItemKey(candidate).equals(key)) return candidate.copyWithCount(1);
            } catch (RuntimeException ignored) {
                // One broken subtype must not prevent importing all other JEI items.
            }
        }
        return ItemStack.EMPTY;
    }

    private static String requiredString(JsonObject object, String key, int maximum) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive()) {
            throw new IllegalArgumentException("Missing " + key);
        }
        String text = value.getAsString();
        if (text.isBlank() || text.length() > maximum) {
            throw new IllegalArgumentException("Invalid " + key);
        }
        return text;
    }

    private PlanNode nodeAtImportedPath(List<Integer> path) {
        return nodeAtImportedPath(0, path);
    }

    private PlanNode nodeAtImportedPath(int rootIndex, List<Integer> path) {
        if (rootIndex < 0 || rootIndex >= startingNodes.size()) {
            throw new IllegalArgumentException("Shared tree references a missing starting node");
        }
        PlanNode node = startingNodes.get(rootIndex);
        for (int segment : path) {
            if (segment < 0 || segment >= node.children.size()) {
                throw new IllegalArgumentException("A shared branch does not match its parent recipe");
            }
            node = node.children.get(segment);
        }
        return node;
    }

    private void applySharedTree(JsonObject share) {
        JsonObject plan = share.has("productionPlan") && share.get("productionPlan").isJsonObject()
                ? share.getAsJsonObject("productionPlan") : null;
        if (plan != null && plan.has("amount")) {
            long amount = plan.get("amount").getAsLong();
            if (amount > 0) {
                long clamped = Math.min(amount, RecipeQuantityMath.MAX_REQUESTED_AMOUNT);
                if (clamped != amount) {
                    JeiExportMod.LOGGER.warn(
                            "Imported requested amount {} was clamped to {}",
                            amount,
                            clamped);
                }
                requestedAmount = Long.toString(clamped);
            }
        }
        startingNodes.clear();
        JsonArray sharedRoots = share.has("roots") && share.get("roots").isJsonArray()
                ? share.getAsJsonArray("roots") : null;
        if (sharedRoots != null && !sharedRoots.isEmpty()) {
            if (sharedRoots.size() > MAX_STARTING_NODES) {
                throw new IllegalArgumentException("Shared graph has too many starting nodes");
            }
            for (JsonElement element : sharedRoots) {
                if (!element.isJsonObject()) {
                    throw new IllegalArgumentException("Invalid shared starting node");
                }
                JsonObject sharedRoot = element.getAsJsonObject();
                ItemStack rootStack = itemForPortableKey(requiredString(sharedRoot, "rootKey", 512));
                if (rootStack.isEmpty()) {
                    throw new IllegalArgumentException("A shared starting item is unavailable");
                }
                long rootAmount = requestedQuantity();
                if (sharedRoot.has("productionPlan")
                        && sharedRoot.get("productionPlan").isJsonObject()
                        && sharedRoot.getAsJsonObject("productionPlan").has("amount")) {
                    rootAmount = Math.min(
                            RecipeQuantityMath.MAX_REQUESTED_AMOUNT,
                            Math.max(1, sharedRoot.getAsJsonObject("productionPlan")
                                    .get("amount").getAsLong()));
                }
                startingNodes.add(new PlanNode(rootStack, rootAmount, null, 0));
            }
        } else {
            startingNodes.add(new PlanNode(target, requestedQuantity(), null, 0));
        }
        rootNode = startingNodes.get(0);
        invalidateTreeLayout();
        previewNode = rootNode;
        int skipped = 0;
        if (sharedRoots != null && !sharedRoots.isEmpty()) {
            for (int rootIndex = 0; rootIndex < sharedRoots.size(); rootIndex++) {
                JsonObject sharedRoot = sharedRoots.get(rootIndex).getAsJsonObject();
                skipped += applySharedSelections(
                        sharedRoot.getAsJsonArray("selections"), rootIndex, rootIndex == 0);
            }
        } else {
            skipped = applySharedSelections(share.getAsJsonArray("selections"), 0, true);
        }
        treeNodes = List.of();
        recipeBoxes = List.of();
        treeViewInitialized = false;
        treeZoom = 1.0f;
        status = skipped == 0 ? "Shared tree imported" : "Shared tree imported; " + skipped
                + " non-recipe source(s) left collapsed";
    }

    private int applySharedSelections(JsonArray selections, int rootIndex, boolean primaryRoot) {
        if (selections == null || selections.size() > 2048) {
            throw new IllegalArgumentException("Invalid shared selection count");
        }
        int skipped = 0;
        for (JsonElement element : selections) {
            if (!element.isJsonObject()) throw new IllegalArgumentException("Invalid shared selection");
            JsonObject selection = element.getAsJsonObject();
            JsonArray jsonPath = selection.getAsJsonArray("path");
            if (jsonPath == null || jsonPath.size() > 12) {
                throw new IllegalArgumentException("Shared tree exceeds the in-game depth limit");
            }
            List<Integer> path = new ArrayList<>();
            jsonPath.forEach(segment -> path.add(segment.getAsInt()));
            PlanNode node = nodeAtImportedPath(rootIndex, path);
            selectPortableIngredient(node, requiredString(selection, "itemKey", 512));
            if (!ingredientKey(node.ingredient).equals(requiredString(selection, "itemKey", 512))) {
                throw new IllegalArgumentException("A shared ingredient does not match its recipe branch");
            }
            JsonObject source = selection.getAsJsonObject("source");
            if (source == null || !"recipe".equals(requiredString(source, "kind", 32))) {
                skipped++;
                continue;
            }
            String recipeKey = requiredString(source, "recipeKey", 1024);
            RecipePage<?> recipe = collectPagesFor(node.ingredient, RecipeIngredientRole.OUTPUT).stream()
                    .filter(page -> page.key.equals(recipeKey))
                    .findFirst()
                    .orElseThrow(() -> new IllegalArgumentException(
                            "Recipe " + recipeKey + " is not available in this modpack"));
            node.setRecipe(recipe);
            if (primaryRoot && path.isEmpty()) selectRecipe(recipeKey);
        }
        return skipped;
    }

    private void selectPortableIngredient(PlanNode node, String key) {
        if (ingredientKey(node.ingredient).equals(key)) return;
        for (int option = 0; option < node.ingredientOptions.size(); option++) {
            if (ingredientKey(node.ingredientOptions.get(option)).equals(key)) {
                node.selectIngredientOption(option, false);
                return;
            }
        }
    }

    private void clearImportedReusablePreferences(PlanNode node) {
        restoreReusable(node, false);
        node.children.forEach(this::clearImportedReusablePreferences);
    }

    private void importTree(Path importPath) {
        if (minecraft == null) return;
        try {
            Optional<Path> importFile = Optional.ofNullable(importPath);
            String raw = importPath == null ? minecraft.keyboardHandler.getClipboard()
                    : RecipeTreeTransfer.readBoundedUtf8(importPath);
            if (raw == null || raw.isBlank()) {
                throw new IllegalArgumentException(
                        "No .mrtree.json file is in config/recipe-tree-shares and the clipboard is empty");
            }
            if (raw.getBytes(StandardCharsets.UTF_8).length > MAX_SHARE_BYTES) {
                throw new IllegalArgumentException("Shared tree exceeds the 1 MiB limit");
            }
            JsonElement parsed = RecipeTreeTransfer.validate(raw);
            if (!parsed.isJsonObject()) throw new IllegalArgumentException("Shared tree must be JSON");
            JsonObject share = parsed.getAsJsonObject();
            if (!SHARE_FORMAT.equals(requiredString(share, "format", 64))
                    || !share.has("version") || share.get("version").getAsInt() != SHARE_VERSION) {
                throw new IllegalArgumentException("Unsupported recipe tree share version");
            }
            if (!"inputs".equals(requiredString(share, "direction", 16))) {
                throw new IllegalArgumentException("The in-game viewer currently imports ingredient trees only");
            }
            JsonObject pack = share.getAsJsonObject("pack");
            String shareMinecraft = pack == null ? "" : requiredString(pack, "minecraftVersion", 40);
            String currentMinecraft = SharedConstants.getCurrentVersion().getName();
            if (!currentMinecraft.equals(shareMinecraft)) {
                throw new IllegalArgumentException("Tree is for Minecraft " + shareMinecraft
                        + ", not " + currentMinecraft);
            }
            ItemStack importedTarget = itemForPortableKey(requiredString(share, "rootKey", 512));
            if (importedTarget.isEmpty()) {
                throw new IllegalArgumentException("Starting item is unavailable in this modpack");
            }
            RecipeTreeScreen imported = new RecipeTreeScreen(
                    importedTarget, runtime, List.of(importedTarget), compactMode,
                    null, history, false);
            imported.restoringHistory = true;
            try { imported.applySharedTree(share); }
            finally { imported.restoringHistory = false; }
            imported.startingNodes.forEach(imported::clearImportedReusablePreferences);
            if (share.has("reusableInputs")) {
                for (JsonElement element : share.getAsJsonArray("reusableInputs")) {
                    JsonObject value = element.getAsJsonObject();
                    List<Integer> path = new ArrayList<>();
                    value.getAsJsonArray("path").forEach(part -> path.add(part.getAsInt()));
                    PlanNode node = imported.nodeAtImportedPath(path);
                    imported.selectPortableIngredient(node, value.get("itemKey").getAsString());
                    if (!imported.ingredientKey(node.ingredient).equals(value.get("itemKey").getAsString()))
                        throw new IllegalArgumentException("Reusable input does not match its recipe branch");
                    imported.restoreReusable(node, true);
                }
            }
            imported.startingNodes.forEach(root -> root.updateQuantity(root.quantity));
            imported.invalidateTreeLayout();
            imported.invalidatePlanSummary();
            history.push(imported);
            imported.status += importFile
                    .map(path -> " from " + path.getFileName())
                    .orElse(" from clipboard");
            minecraft.setScreen(imported);
        } catch (Exception error) {
            JeiExportMod.LOGGER.error("Could not import the recipe tree", error);
            status = "Import failed: " + error.getMessage();
            if (minecraft.screen instanceof TransferScreen transfer) transfer.message = status;
        }
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
        if (delta != 0 && processSummaryArea != null
                && processSummaryArea.contains(mouseX, mouseY)) {
            processSummaryScroll = scrollSummary(
                    processSummaryScroll,
                    currentPlanSummary().processes.size(),
                    processSummaryArea,
                    delta);
            return true;
        }
        if (delta != 0 && materialSummaryArea != null
                && materialSummaryArea.contains(mouseX, mouseY)) {
            materialSummaryScroll = scrollSummary(
                    materialSummaryScroll,
                    currentPlanSummary().materials.size(),
                    materialSummaryArea,
                    delta);
            return true;
        }
        if (delta != 0 && byproductSummaryArea != null
                && byproductSummaryArea.contains(mouseX, mouseY)) {
            byproductSummaryScroll = compactMode
                    ? scrollSummaryGrid(
                            byproductSummaryScroll,
                            currentPlanSummary().byproducts.size(),
                            byproductSummaryArea,
                            delta)
                    : scrollSummary(
                            byproductSummaryScroll,
                            currentPlanSummary().byproducts.size(),
                            byproductSummaryArea,
                            delta);
            return true;
        }
        if (amountBox != null && amountBox.isMouseOver(mouseX, mouseY) && delta != 0) {
            try {
                long amount = RecipeQuantityMath.adjustRequestedAmount(parseLong(requestedAmount), delta);
                amountBox.setValue(Long.toString(amount));
                return true;
            } catch (IllegalArgumentException error) {
                JeiExportMod.LOGGER.warn(
                        "[jeiexport] Requested output scroll was ignored because the amount field is invalid: '{}'",
                        requestedAmount,
                        error);
                status = "Enter an output amount from 1 to 999 before scrolling";
                return true;
            }
        }
        if (insideTreeViewport(mouseX, mouseY) && delta != 0) {
            Optional<TreeNode> hoveredNode = treeNodes.stream()
                    .filter(node -> node.contains(mouseX, mouseY))
                    .findFirst();
            if (hoveredNode.isPresent()) {
                history.beginEdit(this);
                if (hoveredNode.get().node.cycleIngredientOption(delta > 0 ? 1 : -1)) {
                    history.finishEdit(this);
                    status = "";
                    return true;
                }
                history.cancelEdit(this);
            }
            double viewportCenterX = (treeViewportLeft + treeViewportRight) / 2.0;
            double viewportCenterY = (treeViewportTop + treeViewportBottom) / 2.0;
            double modelCenterX = toTreeX(viewportCenterX);
            double modelCenterY = toTreeY(viewportCenterY);
            float factor = delta > 0 ? 1.15f : (1.0f / 1.15f);
            treeZoom = Mth.clamp(treeZoom * factor, 0.35f, 2.5f);
            treePanX = viewportCenterX - treeViewportLeft - modelCenterX * treeZoom;
            treePanY = viewportCenterY - treeViewportTop - modelCenterY * treeZoom;
            invalidateTreeLayout();
            return true;
        }
        return super.mouseScrolled(mouseX, mouseY, delta);
    }

    private static int scrollSummary(
            int current,
            int entryCount,
            SummarySectionBounds bounds,
            double delta) {
        int visibleRows = Math.max(0, (bounds.height - 20) / SUMMARY_ROW_HEIGHT);
        int maximum = Math.max(0, entryCount - visibleRows);
        return Mth.clamp(current + (delta > 0 ? -1 : 1), 0, maximum);
    }

    private static int scrollSummaryGrid(
            int currentRow,
            int entryCount,
            SummarySectionBounds bounds,
            double delta) {
        int columns = summaryGridColumns(bounds);
        int totalRows = (entryCount + columns - 1) / columns;
        int maximum = Math.max(0, totalRows - summaryGridVisibleRows(bounds));
        return Mth.clamp(currentRow + (delta > 0 ? -1 : 1), 0, maximum);
    }

    private void savePlan() {
        RecipePage<?> page = currentPage().orElse(null);
        if (page == null) return;
        try {
            long amount = parseLong(requestedAmount);
            if (amount <= 0 || amount > RecipeQuantityMath.MAX_REQUESTED_AMOUNT) {
                throw new IllegalArgumentException("amount");
            }
            progress.savePlan(target, new RecipeTreeProgress.SavedPlan(amount, page.key));
            status = "Plan saved locally";
        } catch (IllegalArgumentException error) {
            status = "Enter an output amount from 1 to 999";
        }
    }

    private void saveSnapshot() {
        history.saveSnapshot(this);
        status = "Tree snapshot saved for comparison";
    }

    private void restorePlan() {
        RecipeTreeProgress.SavedPlan saved = progress.plan(target);
        if (saved == null) return;
        long restoredAmount = Math.min(
                RecipeQuantityMath.MAX_REQUESTED_AMOUNT,
                Math.max(1, saved.amount()));
        if (restoredAmount != saved.amount()) {
            JeiExportMod.LOGGER.warn(
                    "Saved requested amount {} for {} was clamped to {}",
                    saved.amount(),
                    target.getHoverName().getString(),
                    restoredAmount);
        }
        requestedAmount = Long.toString(restoredAmount);
        for (int index = 0; index < pages.size(); index++) {
            if (pages.get(index).key.equals(saved.recipeKey())) {
                pageIndex = index;
                break;
            }
        }
    }

    private boolean selectRecipe(String recipeKey) {
        if (recipeKey == null) return false;
        for (int index = 0; index < pages.size(); index++) {
            if (pages.get(index).key.equals(recipeKey)) {
                pageIndex = index;
                return true;
            }
        }
        return false;
    }

    private static long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException(error);
        }
    }

    private void updateButtons() {
        if (previousButton == null) return;
        previousButton.active = history.canMove(-1);
        nextButton.active = history.canMove(1);
        if (historyButton != null) historyButton.active = history.size() > 0;
        modeButton.setMessage(Component.literal(compactMode ? "Details" : "Compact"));
        if (useByproductsButton != null) {
            if (useByproductsButton != null) useByproductsButton.setMessage(Component.literal(
                    useByproducts ? "Byproducts: ON" : "Use byproducts"));
        }
        if (recipeBookButton != null) {
            recipeBookButton.setMessage(Component.literal(
                    recipeBookMode ? "Recipe book: ON" : "Recipe book"));
        }
    }

    private Optional<RecipePage<?>> currentPage() {
        if (pages.isEmpty()) return Optional.empty();
        pageIndex = Mth.clamp(pageIndex, 0, pages.size() - 1);
        return Optional.of(pages.get(pageIndex));
    }

    private void collectPages() {
        pages.addAll(collectPagesFor(target, RecipeIngredientRole.OUTPUT));
    }

    private List<RecipePage<?>> collectPagesFor(ItemStack stack, RecipeIngredientRole role) {
        return collectPagesFor(typedItem(stack), role);
    }

    private List<RecipePage<?>> collectPagesFor(
            ITypedIngredient<?> ingredient,
            RecipeIngredientRole role) {
        return recipeQueryCache.computeIfAbsent(role.name() + "|" + ingredientKey(ingredient),
                ignored -> List.copyOf(collectPagesForTyped(ingredient, role)));
    }

    private <V> List<RecipePage<?>> collectPagesForTyped(
            ITypedIngredient<V> ingredient,
            RecipeIngredientRole role) {
        IFocus<V> focus = runtime.getJeiHelpers().getFocusFactory().createFocus(role, ingredient);
        IFocusGroup focusGroup = runtime.getJeiHelpers().getFocusFactory().createFocusGroup(List.of(focus));
        List<RecipePage<?>> found = new ArrayList<>();
        runtime.getRecipeManager().createRecipeCategoryLookup()
                .limitFocus(List.of(focus))
                .get()
                .filter(category -> !RecipeExporter.isMetaCategory(category.getRecipeType().getUid()))
                .forEach(category -> collectCategoryPages(found, category, focus, focusGroup));
        if (role == RecipeIngredientRole.OUTPUT) {
            ingredient.getItemStack().flatMap(ProjectEPlanner::recipe).ifPresent(recipe -> {
                var category = new ProjectEPlanner.Category(runtime.getJeiHelpers().getGuiHelper());
                found.add(new RecipePage<>(category, recipe, focusGroup, recipeKey(category, recipe)));
            });
        }
        return found;
    }

    private <T> void collectCategoryPages(
            List<RecipePage<?>> found,
            IRecipeCategory<T> category,
            IFocus<?> focus,
            IFocusGroup focusGroup) {
        runtime.getRecipeManager().createRecipeLookup(category.getRecipeType())
                .limitFocus(List.of(focus))
                .get()
                .forEach(recipe -> found.add(new RecipePage<>(
                        category,
                        recipe,
                        focusGroup,
                        recipeKey(category, recipe))));
    }

    private List<ItemStack> displayedOutputs(RecipePage<?> page) {
        Optional<? extends IRecipeLayoutDrawable<?>> optionalLayout = page.layout();
        if (optionalLayout.isEmpty()) return List.of();
        List<ItemStack> outputs = new ArrayList<>();
        optionalLayout.get().getRecipeSlotsView().getSlotViews(RecipeIngredientRole.OUTPUT).stream()
                .map(IRecipeSlotView::getDisplayedItemStack)
                .flatMap(Optional::stream)
                .filter(stack -> !stack.isEmpty())
                .forEach(stack -> {
                    boolean duplicate = outputs.stream()
                            .anyMatch(existing -> ItemStack.isSameItemSameTags(existing, stack));
                    if (!duplicate) outputs.add(stack.copyWithCount(1));
                });
        return outputs;
    }

    private ITypedIngredient<?> typedItem(ItemStack stack) {
        return runtime.getIngredientManager()
                .createTypedIngredient(VanillaTypes.ITEM_STACK, stack.copyWithCount(1))
                .orElseThrow(() -> new IllegalArgumentException(
                        "JEI could not create an item ingredient for " + stack));
    }

    private ItemStack ingredientItemStack(ITypedIngredient<?> ingredient) {
        return ingredient.getItemStack()
                .filter(stack -> !stack.isEmpty())
                .map(stack -> stack.copyWithCount(1))
                .orElse(ItemStack.EMPTY);
    }

    private String ingredientKey(ITypedIngredient<?> ingredient) {
        return ingredientKeyTyped(ingredient);
    }

    private <T> String ingredientKeyTyped(ITypedIngredient<T> ingredient) {
        IIngredientHelper<T> helper = runtime.getIngredientManager()
                .getIngredientHelper(ingredient.getType());
        String uniqueId = helper.getUniqueId(ingredient.getIngredient(), UidContext.Ingredient);
        return IngredientKeys.typePrefix(ingredient.getType()) + "|" + uniqueId;
    }

    private boolean sameIngredient(ITypedIngredient<?> first, ITypedIngredient<?> second) {
        if (first.getType() != second.getType()) return false;
        try {
            return ingredientKey(first).equals(ingredientKey(second));
        } catch (RuntimeException error) {
            return first.getIngredient().equals(second.getIngredient());
        }
    }

    private long ingredientAmount(ITypedIngredient<?> ingredient) {
        return ingredientAmountTyped(ingredient);
    }

    private <T> long ingredientAmountTyped(ITypedIngredient<T> ingredient) {
        T value = ingredient.getIngredient();
        if (value instanceof ProjectEPlanner.Emc emc) return emc.amount();
        if (value instanceof ItemStack stack && !stack.isEmpty()) {
            return Math.max(1, stack.getCount());
        }
        if (value instanceof FluidStack stack && !stack.isEmpty()) {
            return Math.max(1, stack.getAmount());
        }
        for (String methodName : List.of("getAmount", "getCount")) {
            try {
                Object reflected = value.getClass().getMethod(methodName).invoke(value);
                if (reflected instanceof Number number && number.longValue() > 0) {
                    return number.longValue();
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next conventional amount accessor.
            }
        }
        try {
            IIngredientHelper<T> helper = runtime.getIngredientManager()
                    .getIngredientHelper(ingredient.getType());
            Method amountMethod = helper.getClass().getMethod("getAmount", Object.class);
            Object reflected = amountMethod.invoke(helper, value);
            if (reflected instanceof Number number && number.longValue() > 0) {
                return number.longValue();
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            String type = IngredientKeys.typePrefix(ingredient.getType());
            if (loggedAmountFallbackTypes.add(type)) {
                JeiExportMod.LOGGER.warn(
                        "JEI ingredient helper failed to provide an amount for type {}; defaulting to 1",
                        type,
                        error);
            }
            return 1;
        }
        String type = IngredientKeys.typePrefix(ingredient.getType());
        if (loggedAmountFallbackTypes.add(type)) {
            JeiExportMod.LOGGER.warn(
                    "JEI ingredient type {} has no positive amount; defaulting to 1",
                    type);
        }
        return 1;
    }

    private static String formatQuantity(PlanNode node, long quantity) {
        if (!node.stack.isEmpty()) return quantity + "x";
        if (node.ingredient.getIngredient() instanceof FluidStack) return quantity + " mB";
        return Long.toString(quantity);
    }

    private String ingredientDisplayName(ITypedIngredient<?> ingredient) {
        return ingredientDisplayNameTyped(ingredient);
    }

    private <T> String ingredientDisplayNameTyped(ITypedIngredient<T> ingredient) {
        try {
            return runtime.getIngredientManager().getIngredientHelper(ingredient.getType())
                    .getDisplayName(ingredient.getIngredient());
        } catch (RuntimeException error) {
            return ingredient.getIngredient().toString();
        }
    }

    private void renderIngredient(
            GuiGraphics graphics,
            ITypedIngredient<?> ingredient,
            int left,
            int top,
            int size) {
        renderIngredientTyped(graphics, ingredient, left, top, size);
    }

    private <T> void renderIngredientTyped(
            GuiGraphics graphics,
            ITypedIngredient<T> ingredient,
            int left,
            int top,
            int size) {
        Optional<ItemStack> itemStack = ingredient.getItemStack().filter(stack -> !stack.isEmpty());
        if (itemStack.isPresent()) {
            graphics.renderItem(itemStack.get(), left + (size - 16) / 2, top + (size - 16) / 2);
            return;
        }
        if (ingredient.getIngredient() instanceof FluidStack fluidStack
                && !fluidStack.isEmpty()
                && renderFullFluid(graphics, fluidStack, left, top, size)) {
            return;
        }
        IIngredientRenderer<T> renderer = runtime.getIngredientManager()
                .getIngredientRenderer(ingredient.getType());
        int rendererWidth = Math.max(1, renderer.getWidth());
        int rendererHeight = Math.max(1, renderer.getHeight());
        float scale = Math.min(1.0f, Math.min(
                (float) size / rendererWidth,
                (float) size / rendererHeight));
        float renderLeft = left + (size - rendererWidth * scale) / 2.0f;
        float renderTop = top + (size - rendererHeight * scale) / 2.0f;
        graphics.pose().pushPose();
        graphics.pose().translate(renderLeft, renderTop, 0);
        graphics.pose().scale(scale, scale, 1.0f);
        renderer.render(graphics, ingredient.getIngredient());
        graphics.pose().popPose();
    }

    private boolean renderFullFluid(
            GuiGraphics graphics,
            FluidStack fluidStack,
            int left,
            int top,
            int size) {
        ResourceLocation fluidId = BuiltInRegistries.FLUID.getKey(fluidStack.getFluid());
        try {
            IClientFluidTypeExtensions properties = IClientFluidTypeExtensions.of(fluidStack.getFluid());
            ResourceLocation texture = properties.getStillTexture(fluidStack);
            if (texture == null) {
                throw new IllegalStateException("Fluid has no still texture");
            }
            TextureAtlasSprite sprite = minecraft.getTextureAtlas(InventoryMenu.BLOCK_ATLAS).apply(texture);
            int tint = properties.getTintColor(fluidStack);
            float alpha = (float) ((tint >>> 24) & 0xFF) / 255.0f;
            float red = (float) ((tint >>> 16) & 0xFF) / 255.0f;
            float green = (float) ((tint >>> 8) & 0xFF) / 255.0f;
            float blue = (float) (tint & 0xFF) / 255.0f;
            RenderSystem.setShaderColor(red, green, blue, alpha);
            graphics.blit(left, top, 0, size, size, sprite);
            return true;
        } catch (RuntimeException error) {
            if (loggedFluidRenderFallbacks.add(fluidId)) {
                JeiExportMod.LOGGER.warn(
                        "Could not render full fluid node for {}; falling back to JEI's ingredient renderer",
                        fluidId,
                        error);
            }
            return false;
        } finally {
            RenderSystem.setShaderColor(1.0f, 1.0f, 1.0f, 1.0f);
        }
    }

    private List<Component> ingredientTooltip(ITypedIngredient<?> ingredient) {
        return ingredientTooltipTyped(ingredient);
    }

    private <T> List<Component> ingredientTooltipTyped(ITypedIngredient<T> ingredient) {
        try {
            return runtime.getIngredientManager().getIngredientRenderer(ingredient.getType())
                    .getTooltip(ingredient.getIngredient(), TooltipFlag.NORMAL);
        } catch (RuntimeException error) {
            return List.of(Component.literal(ingredientDisplayNameTyped(ingredient)));
        }
    }

    private static <T> String recipeKey(IRecipeCategory<T> category, T recipe) {
        var registryName = category.getRegistryName(recipe);
        return category.getRecipeType().getUid() + "|" + (registryName == null ? recipe.toString() : registryName);
    }

    private static boolean contains(int left, int top, int size, double mouseX, double mouseY) {
        return mouseX >= left && mouseX < left + size && mouseY >= top && mouseY < top + size;
    }

    private void attachPreviousRoot(PlanNode previousRoot) {
        List<PlanNode> children = new ArrayList<>(rootNode.children);
        for (int index = 0; index < children.size(); index++) {
            PlanNode expectedInput = children.get(index);
            if (!ItemStack.isSameItemSameTags(expectedInput.stack, previousRoot.stack)) continue;
            children.set(index, copyPlan(previousRoot, rootNode, expectedInput.quantity,
                    expectedInput.quantityPerParentCraft));
            rootNode.children = List.copyOf(children);
            invalidateTreeLayout();
            treeViewInitialized = false;
            return;
        }
    }

    private PlanNode copyPlan(
            PlanNode source,
            PlanNode parent,
            long quantity,
            long quantityPerParentCraft) {
        PlanNode copy = new PlanNode(
                source.ingredient, quantity, parent, quantityPerParentCraft, source.ingredientOptions);
        copy.recipe = source.recipe;
        copy.outputPerCraft = source.outputPerCraft;
        copy.children = source.children.stream()
                .map(child -> copyPlan(child, copy, child.quantity, child.quantityPerParentCraft))
                .toList();
        copy.updateQuantity(quantity);
        return copy;
    }

    private final class HistorySelectorScreen extends Screen {
        private static final int CARD_HEIGHT = 38;
        private static final int CARD_GAP = 6;
        private static final int MIN_CARD_WIDTH = 150;
        private static final int MAX_COLUMNS = 4;
        private static final int SCROLL_STEP = 38;

        private int panelLeft;
        private int panelTop;
        private int panelWidth;
        private int panelHeight;
        private int cardsLeft;
        private int cardsTop;
        private int cardsRight;
        private int cardsBottom;
        private int columns = 1;
        private int cardWidth = MIN_CARD_WIDTH;
        private int contentHeight;
        private double scrollOffset;
        private List<HistoryCardHitbox> hitboxes = List.of();
        private int nextLegacyDepthIndex;
        private final Set<Integer> comparisonEntries = new java.util.LinkedHashSet<>();
        private Button compareButton;
        private boolean comparisonMode;
        private String comparisonStatus = "";

        private HistorySelectorScreen() {
            super(Component.literal("Recipe tree history"));
        }

        @Override
        protected void init() {
            panelLeft = 2;
            panelTop = 2;
            panelWidth = Math.max(1, width - 4);
            panelHeight = Math.max(1, height - 4);
            cardsLeft = panelLeft + 8;
            cardsTop = panelTop + 34;
            cardsRight = panelLeft + panelWidth - 8;
            cardsBottom = panelTop + panelHeight - 30;
            int availableWidth = Math.max(1, cardsRight - cardsLeft);
            columns = Mth.clamp(
                    (availableWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP),
                    1,
                    MAX_COLUMNS);
            cardWidth = Math.max(1,
                    (availableWidth - (columns - 1) * CARD_GAP) / columns);
            int rows = (history.size() + columns - 1) / columns;
            contentHeight = Math.max(0, rows * (CARD_HEIGHT + CARD_GAP) - CARD_GAP);
            scrollOffset = Mth.clamp(scrollOffset, 0, maximumScroll());
            compareButton = addRenderableWidget(Button.builder(
                            Component.literal("Compare"),
                            button -> handleCompareButton())
                    .bounds(panelLeft + panelWidth - 168,
                            panelTop + panelHeight - 26,
                            92,
                            20)
                    .build());
            addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose())
                    .bounds(panelLeft + panelWidth - 68,
                            panelTop + panelHeight - 26,
                            58,
                            20)
                    .build());
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + panelHeight, 0xf0181a1b);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + 2, 0xff69a847);
            graphics.drawString(font, "\u23f2  Recipe tree history",
                    panelLeft + 10, panelTop + 13, 0xffffffff, false);
            String count = history.size() + (history.size() == 1 ? " tree" : " trees")
                    + " · " + history.snapshotCount() + " saved";
            graphics.drawString(font, count,
                    panelLeft + panelWidth - 10 - font.width(count),
                    panelTop + 13,
                    0xffaeb7aa,
                    false);

            List<HistoryCardHitbox> rendered = new ArrayList<>();
            graphics.enableScissor(cardsLeft, cardsTop, cardsRight, cardsBottom);
            for (int displayIndex = 0; displayIndex < history.size(); displayIndex++) {
                int entryIndex = history.size() - 1 - displayIndex;
                int column = displayIndex % columns;
                int row = displayIndex / columns;
                int left = cardsLeft + column * (cardWidth + CARD_GAP);
                int top = cardsTop + row * (CARD_HEIGHT + CARD_GAP)
                        - (int) Math.round(scrollOffset);
                if (top + CARD_HEIGHT <= cardsTop || top >= cardsBottom) continue;
                boolean hovered = mouseX >= left && mouseX < left + cardWidth
                        && mouseY >= top && mouseY < top + CARD_HEIGHT
                        && mouseY >= cardsTop && mouseY < cardsBottom;
                boolean selected = entryIndex == history.currentIndex();
                boolean comparisonSelected = comparisonEntries.contains(entryIndex);
                boolean savedSnapshot = history.descriptor(entryIndex).snapshot();
                int background = comparisonSelected
                        ? 0xff334b59
                        : savedSnapshot
                        ? 0xff3d3828
                        : selected
                        ? 0xff405239
                        : (hovered ? 0xff343b34 : 0xff252925);
                int border = comparisonSelected
                        ? 0xff7fc9ef
                        : savedSnapshot
                        ? 0xffd6b85f
                        : selected
                        ? 0xff9fcf7f
                        : (hovered ? 0xff74896d : 0xff394139);
                graphics.fill(left, top, left + cardWidth, top + CARD_HEIGHT, background);
                graphics.fill(left, top, left + cardWidth, top + 1, border);
                graphics.fill(left, top, left + 1, top + CARD_HEIGHT, border);
                graphics.fill(left + cardWidth - 1, top,
                        left + cardWidth, top + CARD_HEIGHT, border);
                graphics.fill(left, top + CARD_HEIGHT - 1,
                        left + cardWidth, top + CARD_HEIGHT, border);

                RecipeTreeProgress.RecipeHistoryEntry entry = history.descriptor(entryIndex);
                ItemStack item = history.item(entryIndex);
                if (!item.isEmpty()) graphics.renderItem(item, left + 8, top + 8);
                int textLeft = left + 32;
                int textWidth = Math.max(1, cardWidth - 40);
                String itemName = item.isEmpty()
                        ? entry.itemKey()
                        : item.getHoverName().getString();
                graphics.drawString(font,
                        font.plainSubstrByWidth(itemName, textWidth),
                        textLeft,
                        top + 6,
                        0xffffffff,
                        false);
                graphics.drawString(font,
                        "Depth " + (entry.treeDepth() > 0 ? entry.treeDepth() : "..."),
                        textLeft,
                        top + 20,
                        0xffc5d0c1,
                        false);
                rendered.add(new HistoryCardHitbox(
                        entryIndex, item, left, top, cardWidth, CARD_HEIGHT));
            }
            graphics.disableScissor();
            hitboxes = List.copyOf(rendered);

            String footer = !comparisonStatus.isBlank()
                    ? comparisonStatus
                    : comparisonMode
                    ? "Select two versions of the same output, then press Compare"
                    : maximumScroll() > 0
                    ? "Newest first - gold trees are saved snapshots; Compare selects versions"
                    : "Gold trees are saved snapshots; Compare selects tree versions";
            graphics.drawString(font, footer,
                    panelLeft + 10,
                    panelTop + panelHeight - 20,
                    0xffaeb7aa,
                    false);
            renderScrollBar(graphics);
            super.render(graphics, mouseX, mouseY, partialTick);
            hitboxes.stream()
                    .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                    .findFirst()
                    .filter(hitbox -> !hitbox.item.isEmpty())
                    .ifPresent(hitbox -> graphics.renderComponentTooltip(
                            font,
                            hitbox.item.getTooltipLines(
                                    minecraft.player,
                                    minecraft.options.advancedItemTooltips
                                            ? TooltipFlag.Default.ADVANCED
                                            : TooltipFlag.Default.NORMAL),
                            mouseX,
                            mouseY));
        }

        @Override
        public boolean mouseClicked(double mouseX, double mouseY, int button) {
            if (super.mouseClicked(mouseX, mouseY, button)) return true;
            if (button != 0 && button != 1) return false;
            Optional<HistoryCardHitbox> selected = hitboxes.stream()
                    .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                    .findFirst();
            if (selected.isEmpty()) return false;
            if (comparisonMode || button == 1) {
                comparisonMode = true;
                toggleComparisonEntry(selected.get().entryIndex);
                return true;
            }
            RecipeTreeScreen destination = history.select(selected.get().entryIndex);
            if (destination == null) {
                RecipeTreeScreen.this.status =
                        "Saved recipe history entry is unavailable in this modpack";
                minecraft.setScreen(RecipeTreeScreen.this);
            } else {
                minecraft.setScreen(destination);
            }
            return true;
        }

        private void handleCompareButton() {
            if (!comparisonMode) {
                comparisonMode = true;
                comparisonStatus = "Select two versions of the same output";
                updateCompareButton();
                return;
            }
            if (comparisonEntries.size() != 2) {
                comparisonStatus = "Select exactly two tree versions to compare";
                return;
            }
            List<Integer> entries = comparisonEntries.stream().sorted().toList();
            RecipeTreeScreen older = history.screenAt(entries.get(0));
            RecipeTreeScreen newer = history.screenAt(entries.get(1));
            if (older == null || newer == null) {
                comparisonStatus = "A selected tree is unavailable in this modpack";
                return;
            }
            minecraft.setScreen(new TreeComparisonScreen(
                    this,
                    entries.get(0),
                    entries.get(1),
                    older.comparisonData(),
                    newer.comparisonData()));
        }

        private void toggleComparisonEntry(int entryIndex) {
            comparisonStatus = "";
            if (comparisonEntries.remove(entryIndex)) {
                updateCompareButton();
                return;
            }
            if (!comparisonEntries.isEmpty()) {
                int existing = comparisonEntries.iterator().next();
                if (!history.descriptor(existing).itemKey()
                        .equals(history.descriptor(entryIndex).itemKey())) {
                    comparisonStatus = "Choose two versions of the same output";
                    return;
                }
            }
            if (comparisonEntries.size() >= 2) {
                comparisonStatus = "Two versions are already selected";
                return;
            }
            comparisonEntries.add(entryIndex);
            updateCompareButton();
        }

        private void updateCompareButton() {
            if (compareButton == null) return;
            compareButton.setMessage(Component.literal(comparisonMode
                    ? comparisonEntries.size() == 2
                    ? "Compare now"
                    : "Compare " + comparisonEntries.size() + "/2"
                    : "Compare"));
        }

        @Override
        public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
            if (delta == 0) return false;
            scrollOffset = Mth.clamp(
                    scrollOffset - delta * SCROLL_STEP,
                    0,
                    maximumScroll());
            hitboxes = List.of();
            return true;
        }

        @Override
        public void tick() {
            super.tick();
            while (nextLegacyDepthIndex < history.size()) {
                int entryIndex = history.size() - 1 - nextLegacyDepthIndex++;
                if (history.descriptor(entryIndex).treeDepth() > 0) continue;
                history.ensureDepth(entryIndex);
                break;
            }
        }

        private double maximumScroll() {
            return Math.max(0, contentHeight - Math.max(1, cardsBottom - cardsTop));
        }

        private void renderScrollBar(GuiGraphics graphics) {
            double maximum = maximumScroll();
            if (maximum <= 0) return;
            int trackHeight = Math.max(1, cardsBottom - cardsTop);
            int trackLeft = panelLeft + panelWidth - 6;
            graphics.fill(trackLeft, cardsTop, trackLeft + 2, cardsBottom, 0xff394139);
            int thumbHeight = Math.max(12, (int) Math.round(
                    (double) trackHeight * trackHeight / Math.max(trackHeight, contentHeight)));
            int travel = Math.max(0, trackHeight - thumbHeight);
            int thumbTop = cardsTop + (int) Math.round(travel * scrollOffset / maximum);
            graphics.fill(trackLeft, thumbTop,
                    trackLeft + 2, thumbTop + thumbHeight, 0xff9fcf7f);
        }

        @Override
        public void onClose() {
            minecraft.setScreen(RecipeTreeScreen.this);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }

    private final class TransferScreen extends Screen {
        private EditBox command;
        private List<Path> files = List.of();
        private int filePage;
        private String message = "Share the primary tree, or import clipboard JSON / a saved file.";
        private int left;
        private int top;
        private int panelWidth;

        private TransferScreen() { super(Component.literal("Import / Export")); }

        @Override protected void init() {
            panelWidth = Math.min(480, Math.max(200, width - 16));
            left = (width - panelWidth) / 2;
            top = Math.max(8, (height - 270) / 2);
            int column = (panelWidth - 30) / 2;
            addRenderableWidget(Button.builder(Component.literal("Export primary tree"), b -> shareTree())
                    .bounds(left + 10, top + 28, column, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Import clipboard JSON"), b -> importTree(null))
                    .bounds(left + 20 + column, top + 28, column, 20).build());
            addRenderableWidget(Button.builder(Component.literal("History / versions"), b -> openHistory())
                    .bounds(left + 10, top + 52, column, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Save snapshot version"), b -> {
                saveSnapshot(); message = "Snapshot baseline saved; edits now change its working version.";
            }).bounds(left + 20 + column, top + 52, column, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Open share folder"), b -> openShareFolder())
                    .bounds(left + 10, top + 76, column, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Refresh files"), b -> { filePage = 0; rebuildWidgets(); })
                    .bounds(left + 20 + column, top + 76, column, 20).build());
            try { files = RecipeTreeTransfer.listShareFiles(RecipeTreeShareFiles.directory(FMLPaths.CONFIGDIR.get())); }
            catch (IOException error) { JeiExportMod.LOGGER.error("Cannot list tree import files", error); message = error.getMessage(); }
            int visible = Math.max(1, Math.min(4, (height - top - 184) / 24));
            filePage = Mth.clamp(filePage, 0, Math.max(0, (files.size() - 1) / visible));
            for (int row = 0; row < visible && filePage * visible + row < files.size(); row++) {
                Path file = files.get(filePage * visible + row);
                addRenderableWidget(Button.builder(Component.literal(font.plainSubstrByWidth(file.getFileName().toString(), panelWidth - 44)), b -> importTree(file))
                        .bounds(left + 10, top + 104 + row * 24, panelWidth - 20, 20).build());
            }
            int bottom = top + 104 + visible * 24;
            if (files.size() > visible) {
                addRenderableWidget(Button.builder(Component.literal("< Files"), b -> { filePage--; rebuildWidgets(); })
                        .bounds(left + 10, bottom, 70, 20).build()).active = filePage > 0;
                addRenderableWidget(Button.builder(Component.literal("Files >"), b -> { filePage++; rebuildWidgets(); })
                        .bounds(left + 84, bottom, 70, 20).build()).active = (filePage + 1) * visible < files.size();
            }
            command = addRenderableWidget(new EditBox(font, left + 10, bottom + 26, panelWidth - 94, 20, Component.literal("Exporter command")));
            command.setMaxLength(80); command.setValue("/jeiexport all");
            addRenderableWidget(Button.builder(Component.literal("Run"), b -> runExportCommand())
                    .bounds(left + panelWidth - 78, bottom + 26, 68, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Done"), b -> onClose())
                    .bounds(left + panelWidth - 78, bottom + 50, 68, 20).build());
        }

        private void runExportCommand() {
            String text = command.getValue().trim();
            if (text.startsWith("/")) text = text.substring(1);
            try {
                var dispatcher = new com.mojang.brigadier.CommandDispatcher<net.minecraft.commands.CommandSourceStack>();
                ExportCommands.register(dispatcher);
                int result = dispatcher.execute(text, minecraft.player.createCommandSourceStack());
                message = result > 0 ? "Command completed. Export progress appears in chat." : "Command failed; see chat and the log.";
            } catch (Exception error) {
                JeiExportMod.LOGGER.warn("Recipe Tree export command failed: {}", text, error);
                message = "Command failed: " + error.getMessage();
            }
        }

        @Override public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            graphics.fill(left, top, left + panelWidth, height - 4, 0xf0181a1b);
            graphics.flush();
            graphics.pose().pushPose();
            graphics.pose().translate(0, 0, 10);
            graphics.drawString(font, title, left + 10, top + 9, 0xffffffff, false);
            super.render(graphics, mouseX, mouseY, partialTick);
            graphics.drawString(font, font.plainSubstrByWidth(message, panelWidth - 96), left + 10, height - 15, 0xffb8d7aa, false);
            graphics.pose().popPose();
        }
        @Override public void onClose() { minecraft.setScreen(RecipeTreeScreen.this); }
        @Override public boolean isPauseScreen() { return false; }
    }

    private void openShareFolder() {
        Path directory = RecipeTreeShareFiles.directory(FMLPaths.CONFIGDIR.get());
        try {
            Files.createDirectories(directory);
            Util.getPlatform().openFile(directory.toFile());
        } catch (Exception error) {
            JeiExportMod.LOGGER.error("Could not open Recipe Tree share folder {}", directory, error);
            status = "Could not open share folder; see log";
        }
    }

    private final class ShareInstructionsScreen extends Screen {
        private final String filename;
        private final String packLabel;

        private ShareInstructionsScreen(String filename) {
            super(Component.literal("Tree history copied"));
            this.filename = filename;
            String label;
            try {
                PackIdentity identity = PackIdentityResolver.resolve(FMLPaths.GAMEDIR.get());
                label = identity.version() == null
                        ? identity.name()
                        : identity.name() + " " + identity.version();
            } catch (Exception error) {
                JeiExportMod.LOGGER.warn("Could not identify pack for share instructions", error);
                label = "the matching exported pack version";
            }
            this.packLabel = label;
        }

        @Override
        protected void init() {
            int actionWidth = Math.min(120, Math.max(60, (width - 40) / 3));
            int start = (width - actionWidth * 3 - 12) / 2;
            int y = Math.min(height - 30, height / 2 + 50);
            addRenderableWidget(Button.builder(Component.literal("Copy JSON"), b -> {
                try { minecraft.keyboardHandler.setClipboard(RecipeTreeTransfer.readBoundedUtf8(
                        RecipeTreeShareFiles.directory(FMLPaths.CONFIGDIR.get()).resolve(filename))); }
                catch (IOException error) { JeiExportMod.LOGGER.error("Could not copy shared tree", error); }
            }).bounds(start, y, actionWidth, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Open folder"), b -> openShareFolder())
                    .bounds(start + actionWidth + 6, y, actionWidth, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Done"), b -> onClose())
                    .bounds(start + actionWidth * 2 + 12, y, actionWidth, 20).build());
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            int panelWidth = Math.min(430, Math.max(220, width - 24));
            int panelHeight = Math.min(230, Math.max(150, height - 24));
            int left = (width - panelWidth) / 2;
            int top = (height - panelHeight) / 2;
            graphics.fill(left, top, left + panelWidth, top + panelHeight, 0xf0181a1b);
            graphics.fill(left, top, left + panelWidth, top + 2, 0xff69a847);
            graphics.drawString(font, "Primary tree copied", left + 14, top + 14, 0xffffffff, false);
            graphics.drawWordWrap(font, Component.literal(
                    "The primary tree is on your clipboard and saved as " + filename
                    + ". Import it from Import / Export in the mod, or Share on the website. Use the matching pack: " + packLabel + "."),
                    left + 14, top + 36, panelWidth - 28, 0xffc5d0c1);
            super.render(graphics, mouseX, mouseY, partialTick);
        }

        @Override
        public void onClose() {
            minecraft.setScreen(RecipeTreeScreen.this);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }

    private List<TreeComparisonRow> compareTrees(
            TreeComparisonData older,
            TreeComparisonData newer) {
        List<TreeComparisonRow> rows = new ArrayList<>();
        Map<String, RecipeTreeProgress.RecipeHistorySelection> oldSelections = new LinkedHashMap<>();
        Map<String, RecipeTreeProgress.RecipeHistorySelection> newSelections = new LinkedHashMap<>();
        older.selections.forEach(selection -> oldSelections.put(
                selection.rootIndex() + ":" + selection.path(), selection));
        newer.selections.forEach(selection -> newSelections.put(
                selection.rootIndex() + ":" + selection.path(), selection));
        Set<String> selectionPaths = new java.util.LinkedHashSet<>(oldSelections.keySet());
        selectionPaths.addAll(newSelections.keySet());
        for (String path : selectionPaths) {
            RecipeTreeProgress.RecipeHistorySelection before = oldSelections.get(path);
            RecipeTreeProgress.RecipeHistorySelection after = newSelections.get(path);
            if (sameHistorySelection(before, after)) continue;
            String name = before == null
                    ? after.ingredientName()
                    : after == null
                    ? before.ingredientName()
                    : java.util.Objects.equals(before.ingredientKey(), after.ingredientKey())
                    ? after.ingredientName()
                    : before.ingredientName() + " → " + after.ingredientName();
            rows.add(new TreeComparisonRow(
                    "Recipe choices",
                    name,
                    recipeChoiceLabel(before),
                    recipeChoiceLabel(after)));
        }
        appendAmountComparisons(rows, "Materials", older.materials, newer.materials);
        appendAmountComparisons(rows, "Crafting types", older.processes, newer.processes);
        appendAmountComparisons(rows, "Byproducts", older.byproducts, newer.byproducts);
        return List.copyOf(rows);
    }

    private static boolean sameHistorySelection(
            RecipeTreeProgress.RecipeHistorySelection before,
            RecipeTreeProgress.RecipeHistorySelection after) {
        return before == after || before != null && after != null
                && java.util.Objects.equals(before.ingredientKey(), after.ingredientKey())
                && java.util.Objects.equals(before.recipeKey(), after.recipeKey())
                && before.reusableInput() == after.reusableInput();
    }

    private static String recipeChoiceLabel(
            RecipeTreeProgress.RecipeHistorySelection selection) {
        if (selection == null) return "Not in tree";
        if (selection.recipeKey() == null || selection.recipeKey().isBlank()) return selection.reusableInput() ? "Reusable input" : "No recipe";
        String type = selection.recipeType() == null || selection.recipeType().isBlank()
                ? "Recipe" : selection.recipeType();
        int separator = selection.recipeKey().indexOf('|');
        String identity = separator >= 0 && separator + 1 < selection.recipeKey().length()
                ? selection.recipeKey().substring(separator + 1)
                : selection.recipeKey();
        int namespace = identity.indexOf(':');
        if (namespace >= 0 && namespace + 1 < identity.length()) identity = identity.substring(namespace + 1);
        return type + " · " + identity + (selection.reusableInput() ? " (reusable)" : "");
    }

    private static void appendAmountComparisons(
            List<TreeComparisonRow> rows,
            String group,
            Map<String, ComparisonValue> older,
            Map<String, ComparisonValue> newer) {
        Set<String> keys = new java.util.LinkedHashSet<>(older.keySet());
        keys.addAll(newer.keySet());
        for (String key : keys) {
            ComparisonValue before = older.get(key);
            ComparisonValue after = newer.get(key);
            long oldAmount = before == null ? 0 : before.amount;
            long newAmount = after == null ? 0 : after.amount;
            if (oldAmount == newAmount) continue;
            rows.add(new TreeComparisonRow(
                    group,
                    after != null ? after.name : before.name,
                    oldAmount == 0 ? "—" : Long.toString(oldAmount),
                    newAmount == 0 ? "—" : Long.toString(newAmount)));
        }
    }

    private final class TreeComparisonScreen extends Screen {
        private static final int HEADER_HEIGHT = 70;
        private static final int FOOTER_HEIGHT = 30;
        private static final int GROUP_HEIGHT = 18;
        private static final int ROW_HEIGHT = 22;
        private static final int SCROLL_STEP = 36;

        private final Screen returnScreen;
        private final int olderIndex;
        private final int newerIndex;
        private final TreeComparisonData older;
        private final TreeComparisonData newer;
        private final List<TreeComparisonRow> rows;
        private int panelLeft;
        private int panelTop;
        private int panelWidth;
        private int panelHeight;
        private int listTop;
        private int listBottom;
        private int contentHeight;
        private double scrollOffset;

        private TreeComparisonScreen(
                Screen returnScreen,
                int olderIndex,
                int newerIndex,
                TreeComparisonData older,
                TreeComparisonData newer) {
            super(Component.literal("Compare recipe trees"));
            this.returnScreen = returnScreen;
            this.olderIndex = olderIndex;
            this.newerIndex = newerIndex;
            this.older = older;
            this.newer = newer;
            this.rows = compareTrees(older, newer);
        }

        @Override
        protected void init() {
            panelLeft = 2;
            panelTop = 2;
            panelWidth = Math.max(1, width - 4);
            panelHeight = Math.max(1, height - 4);
            listTop = panelTop + HEADER_HEIGHT;
            listBottom = panelTop + panelHeight - FOOTER_HEIGHT;
            contentHeight = comparisonContentHeight();
            scrollOffset = Mth.clamp(scrollOffset, 0, maximumScroll());
            int buttonTop = panelTop + panelHeight - 26;
            addRenderableWidget(Button.builder(Component.literal("Open older"), button -> open(olderIndex))
                    .bounds(panelLeft + 10, buttonTop, 82, 20)
                    .build());
            addRenderableWidget(Button.builder(Component.literal("Open newer"), button -> open(newerIndex))
                    .bounds(panelLeft + 98, buttonTop, 82, 20)
                    .build());
            addRenderableWidget(Button.builder(Component.literal("Back"), button -> onClose())
                    .bounds(panelLeft + panelWidth - 68, buttonTop, 58, 20)
                    .build());
        }

        private void open(int entryIndex) {
            RecipeTreeScreen destination = history.select(entryIndex);
            minecraft.setScreen(destination == null ? returnScreen : destination);
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + panelHeight, 0xf0181a1b);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + 2, 0xff69a847);
            graphics.drawString(font, "Compare recipe trees",
                    panelLeft + 10, panelTop + 10, 0xffffffff, false);
            String subtitle = older.itemName + "  ·  " + rows.size()
                    + (rows.size() == 1 ? " difference" : " differences");
            graphics.drawString(font,
                    font.plainSubstrByWidth(subtitle, Math.max(1, panelWidth - 20)),
                    panelLeft + 10, panelTop + 24, 0xffaeb7aa, false);
            int labelWidth = Math.max(90, (panelWidth - 20) * 46 / 100);
            int valueWidth = Math.max(1, (panelWidth - 20 - labelWidth) / 2);
            int oldLeft = panelLeft + 10 + labelWidth;
            int newLeft = oldLeft + valueWidth;
            graphics.drawString(font,
                    "Older · " + older.amount + "x · depth " + older.depth,
                    oldLeft + 4, panelTop + 48, 0xffc5d0c1, false);
            graphics.drawString(font,
                    "Newer · " + newer.amount + "x · depth " + newer.depth,
                    newLeft + 4, panelTop + 48, 0xffc5d0c1, false);

            graphics.enableScissor(panelLeft + 8, listTop,
                    panelLeft + panelWidth - 8, listBottom);
            int top = listTop - (int) Math.round(scrollOffset);
            String group = null;
            if (rows.isEmpty()) {
                graphics.drawCenteredString(font,
                        "These saved trees are identical",
                        panelLeft + panelWidth / 2,
                        listTop + 24,
                        0xffc5d0c1);
            }
            int rowIndex = 0;
            for (TreeComparisonRow row : rows) {
                if (!row.group.equals(group)) {
                    group = row.group;
                    graphics.fill(panelLeft + 8, top,
                            panelLeft + panelWidth - 8, top + GROUP_HEIGHT, 0xff31412f);
                    graphics.drawString(font, group,
                            panelLeft + 12, top + 5, 0xffd7e8d2, false);
                    top += GROUP_HEIGHT;
                }
                int background = rowIndex++ % 2 == 0 ? 0xff202420 : 0xff252a25;
                graphics.fill(panelLeft + 8, top,
                        panelLeft + panelWidth - 8, top + ROW_HEIGHT, background);
                graphics.drawString(font,
                        font.plainSubstrByWidth(row.name, Math.max(1, labelWidth - 12)),
                        panelLeft + 12, top + 7, 0xffffffff, false);
                graphics.drawString(font,
                        font.plainSubstrByWidth(row.before, Math.max(1, valueWidth - 8)),
                        oldLeft + 4, top + 7, 0xffd8c3ad, false);
                graphics.drawString(font,
                        font.plainSubstrByWidth(row.after, Math.max(1, valueWidth - 8)),
                        newLeft + 4, top + 7, 0xffbfe6b3, false);
                top += ROW_HEIGHT;
            }
            graphics.disableScissor();
            renderComparisonScrollBar(graphics);
            super.render(graphics, mouseX, mouseY, partialTick);
        }

        private int comparisonContentHeight() {
            int groups = 0;
            String previous = null;
            for (TreeComparisonRow row : rows) {
                if (!row.group.equals(previous)) {
                    groups++;
                    previous = row.group;
                }
            }
            return groups * GROUP_HEIGHT + rows.size() * ROW_HEIGHT;
        }

        private double maximumScroll() {
            return Math.max(0, contentHeight - Math.max(1, listBottom - listTop));
        }

        private void renderComparisonScrollBar(GuiGraphics graphics) {
            double maximum = maximumScroll();
            if (maximum <= 0) return;
            int trackHeight = Math.max(1, listBottom - listTop);
            int trackLeft = panelLeft + panelWidth - 6;
            graphics.fill(trackLeft, listTop, trackLeft + 2, listBottom, 0xff394139);
            int thumbHeight = Math.max(12, (int) Math.round(
                    (double) trackHeight * trackHeight / Math.max(trackHeight, contentHeight)));
            int travel = Math.max(0, trackHeight - thumbHeight);
            int thumbTop = listTop + (int) Math.round(travel * scrollOffset / maximum);
            graphics.fill(trackLeft, thumbTop,
                    trackLeft + 2, thumbTop + thumbHeight, 0xff9fcf7f);
        }

        @Override
        public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
            if (delta == 0) return false;
            scrollOffset = Mth.clamp(scrollOffset - delta * SCROLL_STEP, 0, maximumScroll());
            return true;
        }

        @Override
        public void onClose() {
            minecraft.setScreen(returnScreen);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }

    private final class OpenItemChoiceScreen extends Screen {
        private final ItemStack openedItem;
        private final String preferredRecipeKey;
        private final List<ItemStack> nextPath;
        private final PlanNode previousRoot;
        private final List<RecipePage<?>> previewRecipes;
        private List<OpenChoiceRecipeHitbox> previewHitboxes = List.of();
        private List<RecipePage<?>> visiblePreviewRecipes = List.of();
        private int panelLeft;
        private int panelTop;
        private int panelWidth;
        private int panelHeight;
        private int recipeAreaLeft;
        private int recipeAreaTop;
        private int recipeAreaRight;
        private int recipeAreaBottom;
        private int recipeContentHeight;
        private double recipeScroll;

        private OpenItemChoiceScreen(
                ItemStack openedItem,
                String preferredRecipeKey,
                List<ItemStack> nextPath,
                PlanNode previousRoot) {
            super(Component.literal("Open recipe tree item"));
            this.openedItem = openedItem.copyWithCount(1);
            this.preferredRecipeKey = preferredRecipeKey;
            this.nextPath = nextPath.stream().map(stack -> stack.copyWithCount(1)).toList();
            this.previousRoot = previousRoot;
            List<RecipePage<?>> previewChoices = collectPagesFor(
                    typedItem(this.openedItem), RecipeIngredientRole.OUTPUT);
            String savedRecipeKey = preferredRecipeKey == null
                    ? progress.favoriteRecipe(this.openedItem)
                    : preferredRecipeKey;
            RecipePage<?> selectedPreview = savedRecipeKey == null
                    ? null
                    : previewChoices.stream()
                            .filter(page -> page.key.equals(savedRecipeKey))
                            .filter(page -> page.layout().isPresent())
                            .findFirst()
                            .orElse(null);
            List<RecipePage<?>> validPreviews = new ArrayList<>();
            if (selectedPreview != null) validPreviews.add(selectedPreview);
            previewChoices.stream()
                    .filter(page -> page != selectedPreview)
                    .filter(page -> page.layout().isPresent())
                    .forEach(validPreviews::add);
            this.previewRecipes = List.copyOf(validPreviews);
        }

        @Override
        protected void init() {
            panelWidth = Math.max(1, width - 24);
            panelHeight = Math.max(1, height - 24);
            panelLeft = (width - panelWidth) / 2;
            panelTop = (height - panelHeight) / 2;
            recipeAreaLeft = panelLeft + 12;
            recipeAreaTop = panelTop + 78;
            recipeAreaRight = panelLeft + panelWidth - 12;
            recipeAreaBottom = panelTop + panelHeight - 60;
            int buttonGap = 8;
            int horizontalPadding = 12;
            int buttonWidth = Math.max(70,
                    (panelWidth - horizontalPadding * 2 - buttonGap) / 2);
            int buttonTop = panelTop + panelHeight - 52;
            Button addButton = addRenderableWidget(Button.builder(
                            Component.literal("Add to current tree"),
                            button -> addStartingNode(openedItem, preferredRecipeKey))
                    .bounds(panelLeft + horizontalPadding, buttonTop, buttonWidth, 20)
                    .build());
            addButton.active = startingNodes.size() < MAX_STARTING_NODES;
            addRenderableWidget(Button.builder(
                            Component.literal("Start new tree"),
                            button -> minecraft.setScreen(createNewTreeScreen(
                                    openedItem,
                                    preferredRecipeKey,
                                    nextPath,
                                    previousRoot)))
                    .bounds(panelLeft + horizontalPadding + buttonWidth + buttonGap,
                            buttonTop, buttonWidth, 20)
                    .build());
            addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose())
                    .bounds(panelLeft + panelWidth - 82, panelTop + panelHeight - 26, 70, 20)
                    .build());
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + panelHeight, 0xf0181a1b);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + 2, 0xff69a847);
            graphics.renderItem(openedItem, panelLeft + 12, panelTop + 13);
            String itemName = font.plainSubstrByWidth(
                    openedItem.getHoverName().getString(), Math.max(1, panelWidth - 52));
            graphics.drawString(font, itemName,
                    panelLeft + 36, panelTop + 18, 0xffffffff, false);
            String prompt = startingNodes.size() >= MAX_STARTING_NODES
                    ? "The current tree already has " + MAX_STARTING_NODES + " starting items."
                    : "This item is not a starting item in the current tree.";
            graphics.drawCenteredString(font, prompt,
                    panelLeft + panelWidth / 2, panelTop + 48, 0xffaeb7aa);
            graphics.drawCenteredString(font, "Add it here, or begin a separate tree?",
                    panelLeft + panelWidth / 2, panelTop + 62, 0xffd7e6ce);
            renderRecipes(graphics, mouseX, mouseY);
            super.render(graphics, mouseX, mouseY, partialTick);
            renderRecipeTooltip(graphics, mouseX, mouseY);
        }

        private void renderRecipes(GuiGraphics graphics, int mouseX, int mouseY) {
            int availableWidth = Math.max(1, recipeAreaRight - recipeAreaLeft);
            int availableHeight = Math.max(1, recipeAreaBottom - recipeAreaTop);
            if (previewRecipes.isEmpty()) {
                graphics.drawCenteredString(font, "No recipes",
                        panelLeft + panelWidth / 2,
                        recipeAreaTop + availableHeight / 2 - 4,
                        0xffb8bdc2);
                previewHitboxes = List.of();
                visiblePreviewRecipes = List.of();
                recipeContentHeight = 0;
                return;
            }
            final int gap = 8;
            int contentLeft = 0;
            int contentTop = 0;
            int rowHeight = 0;
            List<OpenChoiceRecipeHitbox> rendered = new ArrayList<>();
            List<RecipePage<?>> visible = new ArrayList<>();
            graphics.enableScissor(
                    recipeAreaLeft, recipeAreaTop, recipeAreaRight, recipeAreaBottom);
            for (RecipePage<?> page : previewRecipes) {
                IRecipeLayoutDrawable<?> recipeLayout = page.requireLayout();
                recipeLayout.setPosition(0, 0);
                Rect2i rect = recipeRectWithBorder(recipeLayout);
                double recipeScale = Math.min(
                        1.0, (double) availableWidth / Math.max(1, rect.getWidth()));
                recipeScale = Math.max(0.1, recipeScale);
                int screenWidth = Math.max(1, (int) Math.ceil(rect.getWidth() * recipeScale));
                int screenHeight = Math.max(1, (int) Math.ceil(rect.getHeight() * recipeScale));
                if (contentLeft > 0 && contentLeft + screenWidth > availableWidth) {
                    contentLeft = 0;
                    contentTop += rowHeight + gap;
                    rowHeight = 0;
                }
                int screenLeft = recipeAreaLeft + contentLeft;
                int screenTop = recipeAreaTop + contentTop - (int) Math.round(recipeScroll);
                double renderOriginX = screenLeft - rect.getX() * recipeScale;
                double renderOriginY = screenTop - rect.getY() * recipeScale;
                boolean isVisible = screenTop + screenHeight > recipeAreaTop
                        && screenTop < recipeAreaBottom;
                if (isVisible) {
                    double recipeMouseX = (mouseX - renderOriginX) / recipeScale;
                    double recipeMouseY = (mouseY - renderOriginY) / recipeScale;
                    graphics.pose().pushPose();
                    graphics.pose().translate(renderOriginX, renderOriginY, 0);
                    graphics.pose().scale((float) recipeScale, (float) recipeScale, 1.0f);
                    recipeLayout.drawRecipe(graphics, (int) recipeMouseX, (int) recipeMouseY);
                    graphics.pose().popPose();
                    rendered.add(new OpenChoiceRecipeHitbox(
                            page,
                            screenLeft,
                            screenTop,
                            screenWidth,
                            screenHeight,
                            renderOriginX,
                            renderOriginY,
                            recipeScale));
                    visible.add(page);
                }
                contentLeft += screenWidth + gap;
                rowHeight = Math.max(rowHeight, screenHeight);
            }
            graphics.disableScissor();
            recipeContentHeight = contentTop + rowHeight;
            recipeScroll = Mth.clamp(recipeScroll, 0, maximumRecipeScroll());
            previewHitboxes = List.copyOf(rendered);
            visiblePreviewRecipes = List.copyOf(visible);
            renderRecipeScrollBar(graphics);
        }

        private void renderRecipeTooltip(GuiGraphics graphics, int mouseX, int mouseY) {
            if (!insideRecipeArea(mouseX, mouseY)) return;
            previewHitboxes.stream()
                    .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                    .findFirst()
                    .flatMap(hitbox -> hitbox.page.requireLayout().getRecipeSlotUnderMouse(
                            hitbox.recipeMouseX(mouseX), hitbox.recipeMouseY(mouseY)))
                    .ifPresent(slot -> graphics.renderComponentTooltip(
                            font, slot.getTooltip(), mouseX, mouseY));
        }

        private void renderRecipeScrollBar(GuiGraphics graphics) {
            double maximum = maximumRecipeScroll();
            if (maximum <= 0) return;
            int trackHeight = Math.max(1, recipeAreaBottom - recipeAreaTop);
            int trackLeft = recipeAreaRight - 2;
            graphics.fill(trackLeft, recipeAreaTop, trackLeft + 1, recipeAreaBottom, 0xff394139);
            int thumbHeight = Math.max(10, (int) Math.round(
                    (double) trackHeight * trackHeight / Math.max(trackHeight, recipeContentHeight)));
            int travel = Math.max(0, trackHeight - thumbHeight);
            int thumbTop = recipeAreaTop
                    + (int) Math.round(travel * recipeScroll / maximum);
            graphics.fill(trackLeft, thumbTop, trackLeft + 1,
                    thumbTop + thumbHeight, 0xff9fcf7f);
        }

        private double maximumRecipeScroll() {
            return Math.max(0, recipeContentHeight - Math.max(1, recipeAreaBottom - recipeAreaTop));
        }

        private boolean insideRecipeArea(double mouseX, double mouseY) {
            return mouseX >= recipeAreaLeft && mouseX < recipeAreaRight
                    && mouseY >= recipeAreaTop && mouseY < recipeAreaBottom;
        }

        @Override
        public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
            if (delta != 0 && insideRecipeArea(mouseX, mouseY) && maximumRecipeScroll() > 0) {
                recipeScroll = Mth.clamp(
                        recipeScroll - delta * 30, 0, maximumRecipeScroll());
                return true;
            }
            return super.mouseScrolled(mouseX, mouseY, delta);
        }

        @Override
        public void tick() {
            super.tick();
            visiblePreviewRecipes.forEach(page ->
                    page.layout().ifPresent(RecipeTreeScreen.this::tickRecipeLayout));
        }

        @Override
        public void removed() {
            previewRecipes.forEach(RecipePage::releaseLayout);
            super.removed();
        }

        @Override
        public void onClose() {
            minecraft.setScreen(RecipeTreeScreen.this);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }

    private final class StartingNodePickerScreen extends Screen {
        private static final int CELL_SIZE = 30;
        private static final int CELL_GAP = 4;
        private static final int SCROLL_STEP_ROWS = 2;

        private final List<ItemStack> catalog;
        private List<ItemStack> filtered;
        private EditBox search;
        private int panelLeft;
        private int panelTop;
        private int panelWidth;
        private int panelHeight;
        private int gridLeft;
        private int gridTop;
        private int gridBottom;
        private int columns;
        private int scrollRow;

        private StartingNodePickerScreen() {
            super(Component.literal("Add starting node"));
            this.catalog = BuiltInRegistries.ITEM.stream()
                    .map(ItemStack::new)
                    .filter(stack -> !stack.isEmpty())
                    .sorted(java.util.Comparator.comparing(
                            stack -> stack.getHoverName().getString(),
                            String.CASE_INSENSITIVE_ORDER))
                    .toList();
            this.filtered = catalog;
        }

        @Override
        protected void init() {
            panelWidth = Math.min(620, Math.max(220, width - 24));
            panelHeight = Math.min(390, Math.max(160, height - 24));
            panelLeft = (width - panelWidth) / 2;
            panelTop = (height - panelHeight) / 2;
            search = new EditBox(
                    font,
                    panelLeft + 12,
                    panelTop + 30,
                    Math.max(80, panelWidth - 104),
                    20,
                    Component.literal("Search starting items"));
            search.setHint(Component.literal("Search items"));
            search.setResponder(this::filterCatalog);
            addRenderableWidget(search);
            addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose())
                    .bounds(panelLeft + panelWidth - 82, panelTop + 30, 70, 20)
                    .build());
            gridLeft = panelLeft + 12;
            gridTop = panelTop + 60;
            gridBottom = panelTop + panelHeight - 12;
            columns = Math.max(1, (panelWidth - 24 + CELL_GAP) / (CELL_SIZE + CELL_GAP));
            setInitialFocus(search);
        }

        private void filterCatalog(String query) {
            String normalized = query == null
                    ? ""
                    : query.strip().toLowerCase(java.util.Locale.ROOT);
            filtered = normalized.isEmpty()
                    ? catalog
                    : catalog.stream()
                            .filter(stack -> stack.getHoverName().getString()
                                    .toLowerCase(java.util.Locale.ROOT)
                                    .contains(normalized))
                            .toList();
            scrollRow = 0;
        }

        private int visibleRows() {
            return Math.max(1, (gridBottom - gridTop + CELL_GAP) / (CELL_SIZE + CELL_GAP));
        }

        private int maximumScrollRow() {
            int rows = (filtered.size() + columns - 1) / columns;
            return Math.max(0, rows - visibleRows());
        }

        private Optional<Integer> itemIndexAt(double mouseX, double mouseY) {
            if (mouseX < gridLeft || mouseY < gridTop || mouseY >= gridBottom) {
                return Optional.empty();
            }
            int step = CELL_SIZE + CELL_GAP;
            int column = (int) (mouseX - gridLeft) / step;
            int row = (int) (mouseY - gridTop) / step;
            if (column < 0 || column >= columns || row < 0 || row >= visibleRows()) {
                return Optional.empty();
            }
            int cellLeft = gridLeft + column * step;
            int cellTop = gridTop + row * step;
            if (mouseX >= cellLeft + CELL_SIZE || mouseY >= cellTop + CELL_SIZE) {
                return Optional.empty();
            }
            int index = (scrollRow + row) * columns + column;
            return index >= 0 && index < filtered.size() ? Optional.of(index) : Optional.empty();
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + panelHeight, 0xf0181a1b);
            graphics.fill(panelLeft, panelTop,
                    panelLeft + panelWidth, panelTop + 2, 0xff69a847);
            graphics.drawString(font,
                    "Add start · right-click extra starts to remove · "
                            + startingNodes.size() + "/" + MAX_STARTING_NODES,
                    panelLeft + 12, panelTop + 12, 0xffffffff, false);
            Optional<Integer> hovered = itemIndexAt(mouseX, mouseY);
            int firstIndex = scrollRow * columns;
            int lastIndex = Math.min(filtered.size(), firstIndex + visibleRows() * columns);
            int step = CELL_SIZE + CELL_GAP;
            graphics.enableScissor(gridLeft, gridTop, panelLeft + panelWidth - 12, gridBottom);
            for (int index = firstIndex; index < lastIndex; index++) {
                int visibleIndex = index - firstIndex;
                int left = gridLeft + (visibleIndex % columns) * step;
                int top = gridTop + (visibleIndex / columns) * step;
                ItemStack stack = filtered.get(index);
                boolean alreadyAdded = startingNodes.stream().anyMatch(node ->
                        !node.stack.isEmpty() && ItemStack.isSameItemSameTags(node.stack, stack));
                int background = hovered.orElse(-1) == index
                        ? 0xff4c5d46
                        : alreadyAdded ? 0xff3b3333 : 0xff293029;
                graphics.fill(left, top, left + CELL_SIZE, top + CELL_SIZE, background);
                graphics.renderItem(stack, left + 7, top + 7);
                if (alreadyAdded) {
                    graphics.fill(left, top, left + CELL_SIZE, top + 1, 0xff8f7777);
                }
            }
            graphics.disableScissor();
            super.render(graphics, mouseX, mouseY, partialTick);
            hovered.ifPresent(index -> graphics.renderTooltip(font, filtered.get(index), mouseX, mouseY));
        }

        @Override
        public boolean mouseClicked(double mouseX, double mouseY, int button) {
            Optional<Integer> selected = itemIndexAt(mouseX, mouseY);
            if (selected.isPresent()) {
                if (button == 0) {
                    addStartingNode(filtered.get(selected.get()));
                    return true;
                }
                if (button == 1) {
                    removeStartingNode(filtered.get(selected.get()));
                    return true;
                }
            }
            return super.mouseClicked(mouseX, mouseY, button);
        }

        @Override
        public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
            if (delta == 0) return false;
            scrollRow = Mth.clamp(
                    scrollRow + (delta > 0 ? -SCROLL_STEP_ROWS : SCROLL_STEP_ROWS),
                    0,
                    maximumScrollRow());
            return true;
        }

        @Override
        public void onClose() {
            minecraft.setScreen(RecipeTreeScreen.this);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }

    private final class RecipePickerScreen extends Screen {
        private static final int CARD_GAP = 6;
        private static final int GROUP_GAP = 8;
        private static final int GROUP_HEADER_HEIGHT = 16;
        private static final int SCROLL_STEP = 36;
        private static final int MAX_CACHED_PICKER_LAYOUTS = 64;
        private static final int INGREDIENT_GRID_CELL_SIZE = 32;
        private static final int INGREDIENT_GRID_GAP = 4;
        private static final int MAX_INGREDIENT_GRID_COLUMNS = 10;

        private final PickerKind kind;
        private ITypedIngredient<?> selectedIngredient;
        private final PlanNode selectedNode;
        private List<RecipeChoice> choices = List.of();
        private List<PickerGroup> groups = List.of();
        private final Map<String, ItemStack> groupMachines = new java.util.HashMap<>();
        private final LinkedHashMap<RecipePage<?>, Boolean> layoutLru =
                new LinkedHashMap<>(64, 0.75f, true);
        private List<ChoiceHitbox> hitboxes = List.of();
        private List<GroupHeaderHitbox> groupHeaderHitboxes = List.of();
        private int pickerLeft;
        private int pickerTop;
        private int pickerWidth;
        private int pickerHeight;
        private int recipesLeft;
        private int recipesTop;
        private int recipesRight;
        private int recipesBottom;
        private int contentHeight;
        private double scrollOffset;
        private List<PickerPlacement> placements = List.of();
        private List<PickerGroupHeader> groupHeaders = List.of();
        private Button noRecipeButton;
        private Button openJeiButton;
        private Button changeItemButton;
        private boolean ingredientGridOpen;
        private boolean ingredientGridScrollToSelection;
        private int ingredientGridScrollRow;
        private int ingredientGridColumns = 1;
        private int ingredientGridVisibleRows = 1;
        private int ingredientGridPanelLeft;
        private int ingredientGridPanelTop;
        private int ingredientGridPanelWidth;
        private int ingredientGridPanelHeight;
        private List<IngredientOptionHitbox> ingredientOptionHitboxes = List.of();

        private RecipePickerScreen(
                PickerKind kind,
                ITypedIngredient<?> selectedIngredient,
                PlanNode selectedNode,
                List<RecipeChoice> choices) {
            super(Component.literal(kind == PickerKind.INPUT_RECIPE
                    ? "Choose input recipe"
                    : "Choose output"));
            this.kind = kind;
            this.selectedIngredient = selectedIngredient;
            this.selectedNode = selectedNode;
            replaceChoices(choices);
            this.choices.stream()
                    .map(choice -> choice.page)
                    .filter(RecipePage::hasCachedLayout)
                    .forEach(this::rememberLayout);
            trimLayoutCache();
        }

        private void replaceChoices(List<RecipeChoice> choices) {
            List<RecipeChoice> orderedChoices = new ArrayList<>(choices);
            if (kind == PickerKind.INPUT_RECIPE) {
                orderedChoices.sort((left, right) -> Boolean.compare(isFavorite(right), isFavorite(left)));
            }
            this.choices = List.copyOf(orderedChoices);
            this.groups = groupChoices(this.choices);
        }

        private List<PickerGroup> groupChoices(List<RecipeChoice> orderedChoices) {
            Map<String, List<RecipeChoice>> grouped = new LinkedHashMap<>();
            Map<String, Component> titles = new LinkedHashMap<>();
            for (RecipeChoice choice : orderedChoices) {
                String key = choice.page.category.getRecipeType().getUid().toString();
                grouped.computeIfAbsent(key, ignored -> new ArrayList<>()).add(choice);
                titles.putIfAbsent(key, choice.page.category.getTitle());
                groupMachines.computeIfAbsent(key, ignored -> runtime.getRecipeManager()
                        .createRecipeCatalystLookup(choice.page.category.getRecipeType()).get()
                        .map(RecipeTreeScreen.this::ingredientItemStack).filter(stack -> !stack.isEmpty())
                        .findFirst().orElse(ItemStack.EMPTY));
            }
            return grouped.entrySet().stream()
                    .map(entry -> new PickerGroup(
                            entry.getKey(),
                            titles.get(entry.getKey()),
                            List.copyOf(entry.getValue())))
                    .toList();
        }

        @Override
        protected void init() {
            pickerWidth = Math.min(720, Math.max(1, width - 4));
            pickerHeight = Math.min(400, Math.max(1, height - 4));
            pickerLeft = (width - pickerWidth) / 2;
            pickerTop = (height - pickerHeight) / 2;
            recipesLeft = pickerLeft + 8;
            recipesTop = pickerTop + 34;
            recipesRight = pickerLeft + pickerWidth - 12;
            recipesBottom = pickerTop + pickerHeight - 30;
            layoutChoices();
            scrollOffset = Mth.clamp(scrollOffset, 0, maximumScroll());
            int bottom = pickerTop + pickerHeight - 26;
            addRenderableWidget(Button.builder(Component.literal("Done"), button -> onClose())
                    .bounds(pickerLeft + pickerWidth - 68, bottom, 58, 20).build());
            if (selectedNode != null && selectedNode.parent != null) {
                addRenderableWidget(Button.builder(Component.literal("Reusable: " + (selectedNode.manualReusableInput ? "ON" : "OFF")), button -> {
                    toggleReusable(selectedNode);
                    button.setMessage(Component.literal("Reusable: " + (selectedNode.manualReusableInput ? "ON" : "OFF")));
                }).bounds(pickerLeft + 10, bottom, 112, 20).build());
            }
            int headerButtonRight = pickerLeft + pickerWidth - 10;
            if (kind == PickerKind.INPUT_RECIPE) {
                noRecipeButton = addRenderableWidget(Button.builder(
                                Component.literal("No recipe"), button -> clearRecipeSelection())
                        .bounds(headerButtonRight - 76, pickerTop + 7, 76, 20).build());
                headerButtonRight = noRecipeButton.getX() - 6;
                if (selectedNode.hasIngredientOptions()) {
                    changeItemButton = addRenderableWidget(Button.builder(
                                    Component.empty(), button -> openIngredientGrid())
                            .bounds(headerButtonRight - 104, pickerTop + 7, 104, 20).build());
                    updateChangeItemButton();
                    headerButtonRight = changeItemButton.getX() - 6;
                }
            }
            openJeiButton = addRenderableWidget(Button.builder(
                            Component.translatable("button.jeiexport.open_jei"),
                            button -> openJei(selectedIngredient))
                    .bounds(headerButtonRight - 76, pickerTop + 7, 76, 20).build());
        }

        private void layoutChoices() {
            int availableWidth = Math.max(1, recipesRight - recipesLeft);
            List<PickerPlacement> laidOut = new ArrayList<>();
            List<PickerGroupHeader> laidOutHeaders = new ArrayList<>();
            int rowTop = 0;
            for (PickerGroup group : groups) {
                laidOutHeaders.add(new PickerGroupHeader(group, rowTop, GROUP_HEADER_HEIGHT));
                rowTop += GROUP_HEADER_HEIGHT + CARD_GAP;
                if (!progress.isRecipeTypeCollapsed(group.key)) {
                    rowTop = layoutPickerGroup(laidOut, group, rowTop, availableWidth);
                }
                rowTop += GROUP_GAP;
            }
            placements = List.copyOf(laidOut);
            groupHeaders = List.copyOf(laidOutHeaders);
            contentHeight = Math.max(0, rowTop - GROUP_GAP);
        }

        private int layoutPickerGroup(
                List<PickerPlacement> laidOut,
                PickerGroup group,
                int rowTop,
                int availableWidth) {
            List<PickerCard> row = new ArrayList<>();
            int rowWidth = 0;
            for (RecipeChoice choice : group.choices) {
                PickerCard card = new PickerCard(
                        choice,
                        choice.page.cardWidth(),
                        choice.page.cardHeight(),
                        -JEI_RECIPE_BORDER_PADDING,
                        -JEI_RECIPE_BORDER_PADDING);
                int nextWidth = row.isEmpty() ? card.width : rowWidth + CARD_GAP + card.width;
                if (!row.isEmpty() && nextWidth > availableWidth) {
                    rowTop = appendPickerRow(laidOut, row, rowWidth, rowTop, availableWidth);
                    row = new ArrayList<>();
                    rowWidth = 0;
                }
                if (!row.isEmpty()) rowWidth += CARD_GAP;
                row.add(card);
                rowWidth += card.width;
            }
            if (!row.isEmpty()) rowTop = appendPickerRow(laidOut, row, rowWidth, rowTop, availableWidth);
            return rowTop;
        }

        private int appendPickerRow(
                List<PickerPlacement> result,
                List<PickerCard> row,
                int rowWidth,
                int rowTop,
                int availableWidth) {
            int rowHeight = row.stream().mapToInt(card -> card.height).max().orElse(1);
            int left = Math.max(0, (availableWidth - rowWidth) / 2);
            for (PickerCard card : row) {
                result.add(new PickerPlacement(
                        card.choice,
                        left,
                        rowTop + (rowHeight - card.height) / 2,
                        card.width,
                        card.height,
                        card.borderOffsetX,
                        card.borderOffsetY));
                left += card.width + CARD_GAP;
            }
            return rowTop + rowHeight + CARD_GAP;
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            renderBackground(graphics);
            graphics.fill(pickerLeft, pickerTop, pickerLeft + pickerWidth, pickerTop + pickerHeight, 0xf0181a1b);
            graphics.fill(pickerLeft, pickerTop, pickerLeft + pickerWidth, pickerTop + 2, 0xff69a847);
            renderIngredient(graphics, selectedIngredient, pickerLeft + 10, pickerTop + 9, 16);
            String prompt = kind == PickerKind.INPUT_RECIPE ? "Input recipe for " : "Output using ";
            String choiceCount = choices.size() + (choices.size() == 1 ? " choice" : " choices");
            int countRight = openJeiButton.getX() - 8;
            int countLeft = countRight - font.width(choiceCount);
            int titleLeft = pickerLeft + 32;
            String title = font.plainSubstrByWidth(
                    prompt + ingredientDisplayName(selectedIngredient),
                    Math.max(1, countLeft - titleLeft - 8));
            graphics.drawString(font, title, pickerLeft + 32, pickerTop + 13, 0xffffffff, false);
            graphics.drawString(font, choiceCount, countLeft, pickerTop + 13, 0xffaeb7aa, false);

            List<ChoiceHitbox> rendered = new ArrayList<>();
            List<GroupHeaderHitbox> renderedHeaders = new ArrayList<>();
            RecipePage<?> hoveredPage = null;
            graphics.enableScissor(recipesLeft, recipesTop, recipesRight, recipesBottom);
            for (PickerPlacement placement : placements) {
                int cardTop = recipesTop + placement.top - (int) Math.round(scrollOffset);
                if (cardTop + placement.height <= recipesTop || cardTop >= recipesBottom) continue;
                RecipeChoice choice = placement.choice;
                int cardLeft = recipesLeft + placement.left;
                int recipeX = cardLeft - placement.borderOffsetX;
                int recipeY = cardTop - placement.borderOffsetY;
                Optional<? extends IRecipeLayoutDrawable<?>> optionalLayout = choice.page.layout();
                if (optionalLayout.isEmpty()) {
                    graphics.fill(cardLeft, cardTop,
                            cardLeft + placement.width, cardTop + placement.height, 0xff4a2525);
                    graphics.drawCenteredString(font, "Layout unavailable",
                            cardLeft + placement.width / 2,
                            cardTop + placement.height / 2 - 4,
                            0xffff8f8f);
                    continue;
                }
                IRecipeLayoutDrawable<?> recipeLayout = optionalLayout.get();
                rememberLayout(choice.page);
                recipeLayout.setPosition(recipeX, recipeY);
                Rect2i recipeRect = recipeRectWithBorder(recipeLayout);
                boolean hovered = insideRecipesViewport(mouseX, mouseY)
                        && mouseX >= recipeRect.getX()
                        && mouseX < recipeRect.getX() + recipeRect.getWidth()
                        && mouseY >= recipeRect.getY()
                        && mouseY < recipeRect.getY() + recipeRect.getHeight();
                if (hovered) {
                    graphics.fill(recipeRect.getX() - 2, recipeRect.getY() - 2,
                            recipeRect.getX() + recipeRect.getWidth() + 2,
                            recipeRect.getY() + recipeRect.getHeight() + 2, 0xff69a847);
                }
                recipeLayout.drawRecipe(graphics, mouseX, mouseY);
                if (isFavorite(choice)) {
                    graphics.drawString(font, "★", recipeRect.getX() + 2, recipeRect.getY() + 2,
                            0xffffd866, true);
                }
                rendered.add(new ChoiceHitbox(choice,
                        recipeRect.getX(), recipeRect.getY(), recipeRect.getWidth(), recipeRect.getHeight()));
                if (hovered) hoveredPage = choice.page;
            }
            trimLayoutCache();
            graphics.pose().pushPose();
            graphics.pose().translate(0, 0, 300);
            for (PickerGroupHeader header : groupHeaders) {
                int headerTop = recipesTop + header.top - (int) Math.round(scrollOffset);
                if (headerTop + header.height <= recipesTop || headerTop >= recipesBottom) continue;
                boolean hovered = insideRecipesViewport(mouseX, mouseY)
                        && mouseY >= headerTop && mouseY < headerTop + header.height;
                int color = hovered ? 0xff3c4b38 : 0xff293029;
                graphics.fill(recipesLeft, headerTop, recipesRight, headerTop + header.height, color);
                graphics.fill(recipesLeft, headerTop, recipesRight, headerTop + 1,
                        hovered ? 0xff9fcf7f : 0xff52624d);
                boolean collapsed = progress.isRecipeTypeCollapsed(header.group.key);
                graphics.drawString(font, collapsed ? ">" : "v",
                        recipesLeft + 4, headerTop + 4, 0xffd7e6ce, false);
                ItemStack machine = groupMachines.getOrDefault(header.group.key, ItemStack.EMPTY);
                int groupTitleLeft = recipesLeft + 14;
                if (!machine.isEmpty()) {
                    graphics.renderItem(machine, groupTitleLeft, headerTop);
                    groupTitleLeft += 20;
                }
                String count = Integer.toString(header.group.choices.size());
                String groupTitle = font.plainSubstrByWidth(
                        header.group.title.getString(),
                        Math.max(1, recipesRight - groupTitleLeft - font.width(count) - 12));
                graphics.drawString(font, groupTitle, groupTitleLeft, headerTop + 4, 0xffffffff, false);
                graphics.drawString(font, count, recipesRight - font.width(count) - 4,
                        headerTop + 4, 0xffaeb7aa, false);
                renderedHeaders.add(new GroupHeaderHitbox(
                        header.group, recipesLeft, headerTop,
                        Math.max(1, recipesRight - recipesLeft), header.height));
            }
            graphics.pose().popPose();
            graphics.disableScissor();
            hitboxes = List.copyOf(rendered);
            groupHeaderHitboxes = List.copyOf(renderedHeaders);

            String scrollStatus = maximumScroll() > 0 ? "Scroll to browse all recipes" : "All recipes shown";
            graphics.drawString(font, selectedNode != null && selectedNode.parent != null ? "" : scrollStatus, pickerLeft + 10,
                    pickerTop + pickerHeight - 20, 0xffaeb7aa, false);
            renderScrollBar(graphics);
            super.render(graphics, mouseX, mouseY, partialTick);
            if (ingredientGridOpen) {
                renderIngredientGrid(graphics, mouseX, mouseY);
            } else if (hoveredPage != null) {
                hoveredPage.layout().ifPresent(layout -> layout.drawOverlays(graphics, mouseX, mouseY));
            }
        }

        private void renderIngredientGrid(GuiGraphics graphics, int mouseX, int mouseY) {
            int optionCount = selectedNode.ingredientOptions.size();
            int cellStep = INGREDIENT_GRID_CELL_SIZE + INGREDIENT_GRID_GAP;
            int availableColumns = Math.max(1, (pickerWidth - 28) / cellStep);
            ingredientGridColumns = Math.max(1, Math.min(
                    Math.min(MAX_INGREDIENT_GRID_COLUMNS, availableColumns), optionCount));
            int totalRows = (optionCount + ingredientGridColumns - 1) / ingredientGridColumns;
            int maximumVisibleRows = Math.max(1, (pickerHeight - 72) / cellStep);
            ingredientGridVisibleRows = Math.max(1, Math.min(totalRows, maximumVisibleRows));
            if (ingredientGridScrollToSelection) {
                int selectedRow = selectedNode.ingredientOptionIndex / ingredientGridColumns;
                ingredientGridScrollRow = Mth.clamp(
                        selectedRow - ingredientGridVisibleRows / 2,
                        0,
                        maximumIngredientGridScrollRow());
                ingredientGridScrollToSelection = false;
            } else {
                ingredientGridScrollRow = Mth.clamp(
                        ingredientGridScrollRow, 0, maximumIngredientGridScrollRow());
            }

            int gridWidth = ingredientGridColumns * cellStep - INGREDIENT_GRID_GAP;
            int gridHeight = ingredientGridVisibleRows * cellStep - INGREDIENT_GRID_GAP;
            ingredientGridPanelWidth = Math.max(180, gridWidth + 20);
            ingredientGridPanelHeight = gridHeight + 50;
            ingredientGridPanelLeft = pickerLeft + (pickerWidth - ingredientGridPanelWidth) / 2;
            ingredientGridPanelTop = pickerTop + (pickerHeight - ingredientGridPanelHeight) / 2;
            int gridLeft = ingredientGridPanelLeft + (ingredientGridPanelWidth - gridWidth) / 2;
            int gridTop = ingredientGridPanelTop + 28;

            graphics.pose().pushPose();
            graphics.pose().translate(0, 0, 500);
            graphics.fill(pickerLeft, pickerTop, pickerLeft + pickerWidth, pickerTop + pickerHeight,
                    0xb0101213);
            graphics.fill(
                    ingredientGridPanelLeft,
                    ingredientGridPanelTop,
                    ingredientGridPanelLeft + ingredientGridPanelWidth,
                    ingredientGridPanelTop + ingredientGridPanelHeight,
                    0xff181a1b);
            graphics.fill(
                    ingredientGridPanelLeft,
                    ingredientGridPanelTop,
                    ingredientGridPanelLeft + ingredientGridPanelWidth,
                    ingredientGridPanelTop + 2,
                    0xff69a847);
            String title = "Choose item " + (selectedNode.ingredientOptionIndex + 1)
                    + " / " + optionCount;
            graphics.drawCenteredString(font, title,
                    ingredientGridPanelLeft + ingredientGridPanelWidth / 2,
                    ingredientGridPanelTop + 10,
                    0xffffffff);

            List<IngredientOptionHitbox> rendered = new ArrayList<>();
            int firstIndex = ingredientGridScrollRow * ingredientGridColumns;
            int lastIndex = Math.min(optionCount,
                    firstIndex + ingredientGridVisibleRows * ingredientGridColumns);
            for (int index = firstIndex; index < lastIndex; index++) {
                int visibleIndex = index - firstIndex;
                int column = visibleIndex % ingredientGridColumns;
                int row = visibleIndex / ingredientGridColumns;
                int left = gridLeft + column * cellStep;
                int top = gridTop + row * cellStep;
                boolean selected = index == selectedNode.ingredientOptionIndex;
                boolean hovered = contains(
                        left, top, INGREDIENT_GRID_CELL_SIZE, mouseX, mouseY);
                int background = selected
                        ? 0xff40583a
                        : (hovered ? 0xff3b433b : 0xff292d2a);
                int border = selected
                        ? 0xff75c653
                        : (hovered ? 0xff9fcf7f : 0xff596159);
                graphics.fill(left, top,
                        left + INGREDIENT_GRID_CELL_SIZE,
                        top + INGREDIENT_GRID_CELL_SIZE,
                        background);
                graphics.fill(left, top,
                        left + INGREDIENT_GRID_CELL_SIZE, top + 1, border);
                graphics.fill(left, top,
                        left + 1, top + INGREDIENT_GRID_CELL_SIZE, border);
                graphics.fill(left + INGREDIENT_GRID_CELL_SIZE - 1, top,
                        left + INGREDIENT_GRID_CELL_SIZE, top + INGREDIENT_GRID_CELL_SIZE, border);
                graphics.fill(left, top + INGREDIENT_GRID_CELL_SIZE - 1,
                        left + INGREDIENT_GRID_CELL_SIZE, top + INGREDIENT_GRID_CELL_SIZE, border);
                renderIngredient(graphics, selectedNode.ingredientOptions.get(index),
                        left + 6, top + 6, 20);
                rendered.add(new IngredientOptionHitbox(
                        index, left, top, INGREDIENT_GRID_CELL_SIZE, INGREDIENT_GRID_CELL_SIZE));
            }
            ingredientOptionHitboxes = List.copyOf(rendered);

            String footer = totalRows > ingredientGridVisibleRows
                    ? "Scroll to browse items"
                    : "Click an item to select it";
            graphics.drawCenteredString(font, footer,
                    ingredientGridPanelLeft + ingredientGridPanelWidth / 2,
                    ingredientGridPanelTop + ingredientGridPanelHeight - 14,
                    0xffaeb7aa);
            graphics.pose().popPose();

            ingredientOptionHitboxes.stream()
                    .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                    .findFirst()
                    .ifPresent(hitbox -> graphics.renderComponentTooltip(
                            font,
                            ingredientTooltip(selectedNode.ingredientOptions.get(hitbox.index)),
                            mouseX,
                            mouseY));
        }

        @Override
        public void tick() {
            super.tick();
            for (PickerPlacement placement : placements) {
                if (!isVisible(placement)) continue;
                RecipePage<?> page = placement.choice.page;
                page.layout().ifPresent(layout -> {
                    rememberLayout(page);
                    RecipeTreeScreen.this.tickRecipeLayout(layout);
                });
            }
            trimLayoutCache();
        }

        private void rememberLayout(RecipePage<?> page) {
            layoutLru.put(page, Boolean.TRUE);
        }

        private void trimLayoutCache() {
            if (layoutLru.size() <= MAX_CACHED_PICKER_LAYOUTS) return;
            var iterator = layoutLru.keySet().iterator();
            while (layoutLru.size() > MAX_CACHED_PICKER_LAYOUTS && iterator.hasNext()) {
                RecipePage<?> page = iterator.next();
                if (isRecipePageSelected(page)) continue;
                iterator.remove();
                page.releaseLayout();
            }
        }

        private void releaseUnselectedPickerLayouts() {
            for (RecipePage<?> page : layoutLru.keySet()) {
                if (!isRecipePageSelected(page)) page.releaseLayout();
            }
            layoutLru.clear();
        }

        @Override
        public boolean mouseClicked(double mouseX, double mouseY, int button) {
            if (ingredientGridOpen) {
                if (button != 0) return true;
                Optional<IngredientOptionHitbox> selectedOption = ingredientOptionHitboxes.stream()
                        .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                        .findFirst();
                if (selectedOption.isPresent()) {
                    selectIngredientOption(selectedOption.get().index);
                    return true;
                }
                if (!insideIngredientGridPanel(mouseX, mouseY)) closeIngredientGrid();
                return true;
            }
            if (super.mouseClicked(mouseX, mouseY, button)) return true;
            if ((button != 0 && button != 1) || !insideRecipesViewport(mouseX, mouseY)) return false;
            if (button == 0) {
                Optional<GroupHeaderHitbox> selectedHeader = groupHeaderHitboxes.stream()
                        .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                        .findFirst();
                if (selectedHeader.isPresent()) {
                    PickerGroup group = selectedHeader.get().group;
                    ItemStack machine = groupMachines.getOrDefault(group.key, ItemStack.EMPTY);
                    if (!machine.isEmpty() && mouseX >= recipesLeft + 14 && mouseX < recipesLeft + 30) {
                        openProcessMachine(machine);
                    } else toggleRecipeGroup(group);
                    return true;
                }
            }
            Optional<ChoiceHitbox> selected = hitboxes.stream()
                    .filter(hitbox -> hitbox.contains(mouseX, mouseY))
                    .findFirst();
            if (selected.isEmpty()) return false;
            if (button == 0) {
                applyChoice(selected.get().choice);
                return true;
            }
            return navigateFromRecipeIngredient(selected.get(), mouseX, mouseY);
        }

        private boolean navigateFromRecipeIngredient(
                ChoiceHitbox choice,
                double mouseX,
                double mouseY) {
            Optional<ITypedIngredient<?>> selected = choice.recipeSlotUnderMouse(mouseX, mouseY)
                    .flatMap(IRecipeSlotView::getDisplayedIngredient)
                    .filter(ingredient -> !ItemCatalog.isEmptyIngredient(ingredient));
            if (selected.isEmpty()) return false;
            ItemStack selectedItem = ingredientItemStack(selected.get());
            if (selectedItem.isEmpty()) return false;
            openOutputPicker(new PlanNode(selectedItem.copyWithCount(1), 1, null, 0));
            return true;
        }

        @Override
        public boolean mouseScrolled(double mouseX, double mouseY, double delta) {
            if (delta == 0) return false;
            if (ingredientGridOpen) {
                ingredientGridScrollRow = Mth.clamp(
                        ingredientGridScrollRow + (delta < 0 ? 1 : -1),
                        0,
                        maximumIngredientGridScrollRow());
                ingredientOptionHitboxes = List.of();
                return true;
            }
            scrollOffset = Mth.clamp(scrollOffset - delta * SCROLL_STEP, 0, maximumScroll());
            hitboxes = List.of();
            groupHeaderHitboxes = List.of();
            return true;
        }

        private void toggleRecipeGroup(PickerGroup group) {
            boolean collapsed = !progress.isRecipeTypeCollapsed(group.key);
            progress.setRecipeTypeCollapsed(group.key, collapsed);
            layoutChoices();
            scrollOffset = Mth.clamp(scrollOffset, 0, maximumScroll());
            hitboxes = List.of();
            groupHeaderHitboxes = List.of();
        }

        private void openIngredientGrid() {
            ingredientGridOpen = true;
            ingredientGridScrollToSelection = true;
            ingredientOptionHitboxes = List.of();
        }

        private void closeIngredientGrid() {
            ingredientGridOpen = false;
            ingredientOptionHitboxes = List.of();
        }

        private void selectIngredientOption(int index) {
            if (index == selectedNode.ingredientOptionIndex) {
                closeIngredientGrid();
                return;
            }
            history.beginEdit(RecipeTreeScreen.this);
            if (!selectedNode.selectIngredientOption(index, false)) {
                history.cancelEdit(RecipeTreeScreen.this);
                return;
            }
            history.finishEdit(RecipeTreeScreen.this);
            closeIngredientGrid();
            releaseUnselectedPickerLayouts();
            selectedIngredient = selectedNode.ingredient;
            List<RecipePage<?>> pagesForIngredient = collectPagesFor(
                    selectedIngredient,
                    RecipeIngredientRole.OUTPUT);
            replaceChoices(pagesForIngredient.stream()
                    .map(page -> new RecipeChoice(selectedIngredient, page, false))
                    .toList());
            scrollOffset = 0;
            hitboxes = List.of();
            groupHeaderHitboxes = List.of();
            layoutChoices();
            updateChangeItemButton();
        }

        private int maximumIngredientGridScrollRow() {
            int totalRows = (selectedNode.ingredientOptions.size()
                    + Math.max(1, ingredientGridColumns) - 1)
                    / Math.max(1, ingredientGridColumns);
            return Math.max(0, totalRows - Math.max(1, ingredientGridVisibleRows));
        }

        private boolean insideIngredientGridPanel(double mouseX, double mouseY) {
            return mouseX >= ingredientGridPanelLeft
                    && mouseX < ingredientGridPanelLeft + ingredientGridPanelWidth
                    && mouseY >= ingredientGridPanelTop
                    && mouseY < ingredientGridPanelTop + ingredientGridPanelHeight;
        }

        @Override
        public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
            if (ingredientGridOpen && keyCode == GLFW.GLFW_KEY_ESCAPE) {
                closeIngredientGrid();
                return true;
            }
            return super.keyPressed(keyCode, scanCode, modifiers);
        }

        private void updateChangeItemButton() {
            if (changeItemButton == null) return;
            changeItemButton.setMessage(Component.literal(
                    "Change item " + (selectedNode.ingredientOptionIndex + 1)
                            + "/" + selectedNode.ingredientOptions.size()));
        }

        private boolean isVisible(PickerPlacement placement) {
            double cardTop = recipesTop + placement.top - scrollOffset;
            return cardTop + placement.height > recipesTop && cardTop < recipesBottom;
        }

        private boolean insideRecipesViewport(double mouseX, double mouseY) {
            return mouseX >= recipesLeft && mouseX < recipesRight
                    && mouseY >= recipesTop && mouseY < recipesBottom;
        }

        private double maximumScroll() {
            return Math.max(0, contentHeight - Math.max(1, recipesBottom - recipesTop));
        }

        private void renderScrollBar(GuiGraphics graphics) {
            double maximum = maximumScroll();
            if (maximum <= 0) return;
            int trackTop = recipesTop;
            int trackHeight = Math.max(1, recipesBottom - recipesTop);
            int trackLeft = pickerLeft + pickerWidth - 8;
            graphics.fill(trackLeft, trackTop, trackLeft + 2, recipesBottom, 0xff394139);
            int thumbHeight = Math.max(12, (int) Math.round(
                    (double) trackHeight * trackHeight / Math.max(trackHeight, contentHeight)));
            int travel = Math.max(0, trackHeight - thumbHeight);
            int thumbTop = trackTop + (int) Math.round(travel * scrollOffset / maximum);
            graphics.fill(trackLeft, thumbTop, trackLeft + 2, thumbTop + thumbHeight, 0xff9fcf7f);
        }

        private void applyChoice(RecipeChoice choice) {
            if (kind == PickerKind.INPUT_RECIPE) {
                if (selectedNode.stack.isEmpty()) {
                    progress.saveFavoriteRecipe(
                            ingredientKey(selectedNode.ingredient),
                            choice.page.key);
                } else {
                    progress.saveFavoriteRecipe(selectedNode.stack, choice.page.key);
                }
                history.beginEdit(RecipeTreeScreen.this);
                favoriteExpansionAttemptsRemaining = MAX_AUTOMATIC_FAVORITE_EXPANSIONS;
                ITypedIngredient<?> favoriteIngredient = selectedNode.ingredient;
                int changed = applyFavoriteRecipeEverywhere(
                        favoriteIngredient, choice.page, selectedNode);
                startingNodes.forEach(RecipeTreeScreen.this::expandFavoriteIngredients);
                if (sameIngredient(rootNode.ingredient, favoriteIngredient)) {
                    selectRecipe(choice.page.key);
                }
                history.finishEdit(RecipeTreeScreen.this);
                treeNodes = List.of();
                recipeBoxes = List.of();
                status = changed == 0
                        ? "Favorite recipe is already used everywhere"
                        : changed == 1
                                ? "Favorite recipe changed for 1 node"
                                : "Favorite recipe changed for " + changed + " nodes";
                minecraft.setScreen(RecipeTreeScreen.this);
                return;
            }
            Optional<ITypedIngredient<?>> resolvedOutput = choiceIngredient(choice);
            ItemStack choiceItem = resolvedOutput
                    .map(RecipeTreeScreen.this::ingredientItemStack)
                    .orElse(ItemStack.EMPTY);
            if (choiceItem.isEmpty()) {
                JeiExportMod.LOGGER.error(
                        "Output navigation recipe {} did not expose an item output",
                        choice.page.key);
                status = "Cannot open a non-item recipe output as the tree root";
                minecraft.setScreen(RecipeTreeScreen.this);
                return;
            }
            List<ItemStack> nextPath;
            ItemStack selectedItem = ingredientItemStack(selectedIngredient);
            if (ItemStack.isSameItemSameTags(choiceItem, target)) {
                nextPath = new ArrayList<>(path);
            } else if (path.size() > 1
                    && ItemStack.isSameItemSameTags(selectedItem, target)
                    && ItemStack.isSameItemSameTags(choiceItem, path.get(path.size() - 2))) {
                nextPath = new ArrayList<>(path.subList(0, path.size() - 1));
            } else {
                nextPath = List.of(choiceItem.copyWithCount(1));
            }
            minecraft.setScreen(screenForOpenedItem(
                    choiceItem,
                    choice.page.key,
                    nextPath,
                    selectedNode == rootNode ? rootNode : null));
        }

        private void clearRecipeSelection() {
            if (kind != PickerKind.INPUT_RECIPE) return;
            if (selectedNode.stack.isEmpty()) {
                progress.clearFavoriteRecipe(ingredientKey(selectedNode.ingredient));
            } else {
                progress.clearFavoriteRecipe(selectedNode.stack);
            }
            history.beginEdit(RecipeTreeScreen.this);
            ITypedIngredient<?> favoriteIngredient = selectedNode.ingredient;
            int changed = clearFavoriteRecipeEverywhere(favoriteIngredient);
            history.finishEdit(RecipeTreeScreen.this);
            treeNodes = List.of();
            recipeBoxes = List.of();
            treeViewInitialized = false;
            status = changed == 0
                    ? "No matching recipe nodes were expanded"
                    : changed == 1
                            ? "No recipe selected for 1 matching node"
                            : "No recipe selected for " + changed + " matching nodes";
            minecraft.setScreen(RecipeTreeScreen.this);
        }

        private boolean isFavorite(RecipeChoice choice) {
            Optional<ITypedIngredient<?>> ingredient = choiceIngredient(choice);
            if (ingredient.isEmpty()) return false;
            ItemStack item = ingredientItemStack(ingredient.get());
            String favorite = item.isEmpty()
                    ? progress.favoriteRecipe(ingredientKey(ingredient.get()))
                    : progress.favoriteRecipe(item);
            return favorite != null && favorite.equals(choice.page.key);
        }

        private Optional<ITypedIngredient<?>> choiceIngredient(RecipeChoice choice) {
            if (!choice.resolveFirstItemOutput) return Optional.of(choice.ingredient);
            return displayedOutputs(choice.page).stream()
                    .findFirst()
                    .map(RecipeTreeScreen.this::typedItem);
        }

        @Override
        public void onClose() {
            minecraft.setScreen(RecipeTreeScreen.this);
        }

        @Override
        public void removed() {
            releaseUnselectedPickerLayouts();
            super.removed();
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }
    }

    @Override
    public void removed() {
        history.persist();
        super.removed();
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    private final class RecipePage<T> {
        private final IRecipeCategory<T> category;
        private final T recipe;
        private final IFocusGroup focusGroup;
        private final String key;
        private IRecipeLayoutDrawable<T> cachedLayout;
        private boolean layoutAttempted;

        private RecipePage(
                IRecipeCategory<T> category,
                T recipe,
                IFocusGroup focusGroup,
                String key) {
            this.category = category;
            this.recipe = recipe;
            this.focusGroup = focusGroup;
            this.key = key;
        }

        private Optional<IRecipeLayoutDrawable<T>> layout() {
            if (!layoutAttempted) {
                layoutAttempted = true;
                cachedLayout = runtime.getRecipeManager()
                        .createRecipeLayoutDrawable(category, recipe, focusGroup)
                        .orElse(null);
                if (cachedLayout == null) {
                    JeiExportMod.LOGGER.error(
                            "JEI could not create a recipe layout for {}; the recipe card is unavailable",
                            key);
                }
            }
            return Optional.ofNullable(cachedLayout);
        }

        private IRecipeLayoutDrawable<T> requireLayout() {
            return layout().orElseThrow(() -> new IllegalStateException(
                    "JEI recipe layout is unavailable for " + key));
        }

        private void releaseLayout() {
            if (cachedLayout == null) return;
            cachedLayout = null;
            layoutAttempted = false;
        }

        private boolean hasCachedLayout() {
            return cachedLayout != null;
        }

        private int cardWidth() {
            return Math.max(1, category.getWidth() + JEI_RECIPE_BORDER_PADDING * 2);
        }

        private int cardHeight() {
            return Math.max(1, category.getHeight() + JEI_RECIPE_BORDER_PADDING * 2);
        }
    }

    private record GroupedIngredient(
            ITypedIngredient<?> ingredient,
            long quantity,
            List<ITypedIngredient<?>> options) {
    }

    private record RecipeChoice(
            ITypedIngredient<?> ingredient,
            RecipePage<?> page,
            boolean resolveFirstItemOutput) {
    }

    private record PickerGroup(
            String key,
            Component title,
            List<RecipeChoice> choices) {
    }

    private record PickerGroupHeader(
            PickerGroup group,
            int top,
            int height) {
    }

    private record PickerCard(
            RecipeChoice choice,
            int width,
            int height,
            int borderOffsetX,
            int borderOffsetY) {
    }

    private record PickerPlacement(
            RecipeChoice choice,
            int left,
            int top,
            int width,
            int height,
            int borderOffsetX,
            int borderOffsetY) {
    }

    private enum PickerKind {
        INPUT_RECIPE,
        OUTPUT
    }

    private static final class OutputHistory {
        private static final int MAX_ENTRIES = 32;
        private final IJeiRuntime runtime;
        private final RecipeTreeProgress progress = RecipeTreeProgress.get();
        private final List<HistoryEntry> entries = new ArrayList<>();
        private int index = -1;
        private HistoryEntry pendingEditEntry;
        private int pendingEditIndex = -1;

        private OutputHistory(IJeiRuntime runtime) {
            this.runtime = runtime;
            progress.recipeHistory().stream()
                    .filter(entry -> entry != null
                            && entry.itemKey() != null
                            && !entry.itemKey().isBlank())
                    .map(HistoryEntry::new)
                    .forEach(entries::add);
            if (entries.size() > MAX_ENTRIES) {
                entries.subList(0, entries.size() - MAX_ENTRIES).clear();
            }
            index = entries.size() - 1;
            RecipeTreeProgress.RecipeHistoryEntry lastViewed = progress.lastViewedRecipeTree();
            if (lastViewed != null) {
                for (int candidate = entries.size() - 1; candidate >= 0; candidate--) {
                    if (entries.get(candidate).descriptor().equals(lastViewed)) {
                        index = candidate;
                        break;
                    }
                }
            }
        }

        private void push(RecipeTreeScreen screen) {
            if (index + 1 < entries.size()) {
                entries.subList(index + 1, entries.size()).clear();
            }
            RecipeTreeProgress.RecipeHistoryEntry descriptor = screen.historyEntry();
            if (index >= 0 && entries.get(index).descriptor().equals(descriptor)) {
                entries.set(index, new HistoryEntry(screen));
                persist();
                return;
            }
            entries.add(new HistoryEntry(screen));
            if (entries.size() > MAX_ENTRIES) {
                entries.remove(0);
            }
            index = entries.size() - 1;
            persist();
        }

        private void saveSnapshot(RecipeTreeScreen screen) {
            RecipeTreeProgress.RecipeHistoryEntry baseline = HistoryEntry.withSnapshot(screen.historyEntry(), true);
            if (index + 1 < entries.size()) entries.subList(index + 1, entries.size()).clear();
            if (index >= 0 && entries.get(index).screen == screen) entries.set(index, new HistoryEntry(baseline));
            else { entries.add(new HistoryEntry(baseline)); index = entries.size() - 1; }
            entries.add(new HistoryEntry(screen));
            index++;
            while (entries.size() > MAX_ENTRIES) { entries.remove(0); index--; }
            persist();
        }

        private void beginEdit(RecipeTreeScreen screen) {
            if (pendingEditEntry != null || index < 0 || index >= entries.size()) return;
            HistoryEntry current = entries.get(index);
            if (current.screen != screen) return;
            pendingEditEntry = current;
            pendingEditIndex = index;
            entries.set(index, new HistoryEntry(current.descriptor()));
        }

        private void finishEdit(RecipeTreeScreen screen) {
            if (pendingEditEntry == null || pendingEditEntry.screen != screen) {
                JeiExportMod.LOGGER.warn(
                        "Recipe tree history edit finished without a matching begin; "
                                + "updating the current entry");
                if (index >= 0
                        && index < entries.size()
                        && entries.get(index).screen == screen) {
                    entries.set(index, new HistoryEntry(screen));
                    persist();
                } else {
                    push(screen);
                }
                pendingEditEntry = null;
                pendingEditIndex = -1;
                return;
            }
            HistoryEntry editedEntry = new HistoryEntry(screen);
            index = RecipeHistoryEdits.commit(
                    entries,
                    pendingEditIndex,
                    editedEntry,
                    pendingEditEntry.savedSnapshot);
            pendingEditEntry = null;
            pendingEditIndex = -1;
            persist();
        }

        private void cancelEdit(RecipeTreeScreen screen) {
            if (pendingEditEntry == null || pendingEditEntry.screen != screen) return;
            if (pendingEditIndex >= 0 && pendingEditIndex < entries.size()) {
                entries.set(pendingEditIndex, pendingEditEntry);
            }
            pendingEditEntry = null;
            pendingEditIndex = -1;
        }

        private boolean canMove(int delta) {
            int destination = index + delta;
            return destination >= 0 && destination < entries.size();
        }

        private RecipeTreeScreen move(int delta) {
            if (!canMove(delta)) return null;
            return select(index + delta);
        }

        private RecipeTreeScreen current() {
            if (index < 0 || index >= entries.size()) return null;
            RecipeTreeScreen screen = entries.get(index).screen(this, runtime);
            if (screen != null) persist();
            return screen;
        }

        private RecipeTreeScreen select(int destination) {
            if (destination < 0 || destination >= entries.size()) return null;
            persist();
            RecipeTreeScreen screen = entries.get(destination).screen(this, runtime);
            if (screen == null) return null;
            index = destination;
            persist();
            return screen;
        }

        private int size() {
            return entries.size();
        }

        private long snapshotCount() {
            return entries.stream().filter(entry -> entry.savedSnapshot).count();
        }

        private int currentIndex() {
            return index;
        }

        private RecipeTreeProgress.RecipeHistoryEntry descriptor(int entryIndex) {
            return entries.get(entryIndex).descriptor();
        }

        private ItemStack item(int entryIndex) {
            return entries.get(entryIndex).item();
        }

        private RecipeTreeScreen screenAt(int entryIndex) {
            if (entryIndex < 0 || entryIndex >= entries.size()) return null;
            RecipeTreeScreen screen = entries.get(entryIndex).screen(this, runtime);
            if (screen != null) persist();
            return screen;
        }

        private void ensureDepth(int entryIndex) {
            if (entryIndex < 0 || entryIndex >= entries.size()) return;
            HistoryEntry entry = entries.get(entryIndex);
            if (entry.descriptor().treeDepth() > 0) return;
            if (entry.screen(this, runtime) != null) persist();
        }

        private void persist() {
            RecipeTreeProgress.RecipeHistoryEntry lastViewed =
                    index >= 0 && index < entries.size()
                            ? entries.get(index).descriptor()
                            : null;
            progress.replaceRecipeHistory(
                    entries.stream().map(HistoryEntry::descriptor).toList(),
                    lastViewed);
        }

        private static final class HistoryEntry {
            private RecipeTreeProgress.RecipeHistoryEntry descriptor;
            private RecipeTreeScreen screen;
            private boolean savedSnapshot;

            private HistoryEntry(RecipeTreeProgress.RecipeHistoryEntry descriptor) {
                this.descriptor = descriptor;
                this.savedSnapshot = descriptor.snapshot();
            }

            private HistoryEntry(RecipeTreeScreen screen) {
                this.screen = screen;
                this.descriptor = screen.historyEntry();
            }

            private RecipeTreeProgress.RecipeHistoryEntry descriptor() {
                if (screen != null) descriptor = withSnapshot(screen.historyEntry(), savedSnapshot);
                return descriptor;
            }

            private static RecipeTreeProgress.RecipeHistoryEntry withSnapshot(
                    RecipeTreeProgress.RecipeHistoryEntry entry,
                    boolean snapshot) {
                if (entry.snapshot() == snapshot) return entry;
                return new RecipeTreeProgress.RecipeHistoryEntry(
                        entry.itemKey(),
                        entry.recipeKey(),
                        entry.amount(),
                        entry.compactMode(),
                        entry.treeDepth(),
                        entry.roots(),
                        entry.selections(),
                        snapshot);
            }

            private ItemStack item() {
                ResourceLocation itemId = ResourceLocation.tryParse(descriptor.itemKey());
                return Optional.ofNullable(itemId)
                        .flatMap(BuiltInRegistries.ITEM::getOptional)
                        .map(ItemStack::new)
                        .filter(stack -> !stack.isEmpty())
                        .orElse(ItemStack.EMPTY);
            }

            private RecipeTreeScreen screen(OutputHistory history, IJeiRuntime runtime) {
                if (screen != null) return screen;
                RecipeTreeProgress.RecipeHistoryEntry saved = descriptor;
                ItemStack target = item();
                if (target.isEmpty()) {
                    JeiExportMod.LOGGER.warn(
                            "Cannot restore recipe history item {} because it is unavailable",
                            descriptor.itemKey());
                    return null;
                }
                screen = new RecipeTreeScreen(
                        target,
                        runtime,
                        List.of(target),
                        descriptor.compactMode(),
                        descriptor.recipeKey(),
                        history,
                        false);
                screen.restoringHistory = true;
                try {
                    screen.applyHistoryAmount(saved.amount());
                    screen.applyHistoryRoots(saved.roots());
                    screen.applyHistorySelections(saved.selections());
                } finally {
                    screen.restoringHistory = false;
                }
                return screen;
            }
        }
    }

    private final class PlanNode {
        private ITypedIngredient<?> ingredient;
        private ItemStack stack;
        private final PlanNode parent;
        private final long quantityPerParentCraft;
        private final List<ITypedIngredient<?>> ingredientOptions;
        private int ingredientOptionIndex;
        private long quantity;
        private Boolean reusableOverride;
        private boolean manualReusableInput;
        private long outputPerCraft = 1;
        private RecipePage<?> recipe;
        private List<PlanNode> children = List.of();

        private PlanNode(
                ItemStack stack,
                long quantity,
                PlanNode parent,
                long quantityPerParentCraft) {
            this(typedItem(stack), quantity, parent, quantityPerParentCraft, List.of());
        }

        private PlanNode(
                ITypedIngredient<?> ingredient,
                long quantity,
                PlanNode parent,
                long quantityPerParentCraft,
                List<ITypedIngredient<?>> ingredientOptions) {
            List<ITypedIngredient<?>> normalizedOptions = new ArrayList<>();
            ingredientOptions.stream()
                    .filter(option -> !ItemCatalog.isEmptyIngredient(option))
                    .forEach(option -> {
                        if (normalizedOptions.stream().noneMatch(existing ->
                                sameIngredient(existing, option))) {
                            normalizedOptions.add(option);
                        }
                    });
            if (normalizedOptions.stream().noneMatch(option ->
                    sameIngredient(option, ingredient))) {
                normalizedOptions.add(0, ingredient);
            }
            this.ingredientOptions = List.copyOf(normalizedOptions);
            this.ingredientOptionIndex = 0;
            for (int index = 0; index < this.ingredientOptions.size(); index++) {
                if (sameIngredient(this.ingredientOptions.get(index), ingredient)) {
                    this.ingredientOptionIndex = index;
                    break;
                }
            }
            this.ingredient = this.ingredientOptions.get(this.ingredientOptionIndex);
            this.stack = ingredientItemStack(this.ingredient);
            this.quantity = Math.max(1, quantity);
            this.parent = parent;
            this.quantityPerParentCraft = Math.max(0, quantityPerParentCraft);
            refreshReusable();
        }

        private void refreshReusable() {
            manualReusableInput = reusableOverride != null ? reusableOverride : parent != null && parent.recipe != null
                    && progress.isReusableInput(parent.recipe.key, ingredientKey(ingredient));
            if (manualReusableInput) quantity = 1;
        }

        private void setRecipe(RecipePage<?> recipe) {
            this.recipe = recipe;
            this.outputPerCraft = outputAmount(recipe, ingredient);
            if (depth() >= 12) {
                this.children = List.of();
                invalidateTreeLayout();
                invalidatePlanSummary();
                return;
            }
            long crafts = RecipeQuantityMath.craftsFor(quantity, outputPerCraft);
            this.children = groupedInputs(recipe).stream()
                    .limit(32)
                    .map(input -> new PlanNode(
                            input.ingredient,
                            RecipeQuantityMath.inputTotal(input.quantity, crafts),
                            this,
                            input.quantity,
                            input.options))
                    .toList();
            if (!restoringHistory) this.children.forEach(PlanNode::expandFavoriteRecipe);
            invalidateTreeLayout();
            invalidatePlanSummary();
        }

        private void clearRecipe() {
            recipe = null;
            outputPerCraft = 1;
            children = List.of();
            invalidateTreeLayout();
            invalidatePlanSummary();
        }

        private void expandFavoriteRecipe() {
            if (restoringHistory || recipe != null || depth() >= 12 || repeatsAncestorIngredient()) return;
            String favorite = stack.isEmpty()
                    ? progress.favoriteRecipe(ingredientKey(ingredient))
                    : progress.favoriteRecipe(stack);
            if (favorite == null || favoriteExpansionAttemptsRemaining <= 0) return;
            favoriteExpansionAttemptsRemaining--;
            List<RecipePage<?>> favoritePages = stack.isEmpty()
                    ? collectPagesFor(ingredient, RecipeIngredientRole.OUTPUT)
                    : collectPagesFor(stack, RecipeIngredientRole.OUTPUT);
            favoritePages.stream()
                    .filter(page -> page.key.equals(favorite))
                    .filter(page -> page.layout().isPresent())
                    .findFirst()
                    .ifPresent(this::setRecipe);
        }

        private boolean repeatsAncestorIngredient() {
            PlanNode cursor = parent;
            while (cursor != null) {
                if (sameIngredient(ingredient, cursor.ingredient)) return true;
                cursor = cursor.parent;
            }
            return false;
        }

        private void updateQuantity(long quantity) {
            refreshReusable();
            this.quantity = manualReusableInput ? 1 : Math.max(1, quantity);
            if (recipe != null) {
                long crafts = RecipeQuantityMath.craftsFor(this.quantity, outputPerCraft);
                children.forEach(child -> child.updateQuantity(
                        RecipeQuantityMath.inputTotal(child.quantityPerParentCraft, crafts)));
            }
            invalidateTreeLayout();
            invalidatePlanSummary();
        }

        private boolean hasIngredientOptions() {
            return ingredientOptions.size() > 1;
        }

        private boolean cycleIngredientOption(int direction) {
            return cycleIngredientOption(direction, true);
        }

        private boolean cycleIngredientOption(int direction, boolean expandFavorite) {
            if (!hasIngredientOptions() || direction == 0) return false;
            return selectIngredientOption(Math.floorMod(
                    ingredientOptionIndex + Integer.signum(direction), ingredientOptions.size()),
                    expandFavorite);
        }

        private boolean selectIngredientOption(int index, boolean expandFavorite) {
            if (index < 0 || index >= ingredientOptions.size() || index == ingredientOptionIndex) {
                return false;
            }
            ingredientOptionIndex = index;
            ingredient = ingredientOptions.get(ingredientOptionIndex);
            stack = ingredientItemStack(ingredient);
            recipe = null;
            outputPerCraft = 1;
            children = List.of();
            if (expandFavorite) expandFavoriteRecipe();
            invalidateTreeLayout();
            invalidatePlanSummary();
            return true;
        }

        private int depth() {
            int depth = 0;
            PlanNode cursor = parent;
            while (cursor != null) {
                depth++;
                cursor = cursor.parent;
            }
            return depth;
        }

        private PlanNode childFor(ITypedIngredient<?> selected) {
            return children.stream()
                    .filter(child -> sameIngredient(child.ingredient, selected)
                            || child.ingredientOptions.stream().anyMatch(option ->
                            sameIngredient(option, selected)))
                    .findFirst()
                    .orElse(null);
        }
    }

    private record IngredientSummary(
            ITypedIngredient<?> ingredient,
            long gross,
            long remaining,
            List<PlanNode> nodes) {
    }

    private record ComparisonValue(String name, long amount) {
    }

    private record TreeComparisonData(
            String itemName,
            long amount,
            int depth,
            List<RecipeTreeProgress.RecipeHistorySelection> selections,
            Map<String, ComparisonValue> materials,
            Map<String, ComparisonValue> byproducts,
            Map<String, ComparisonValue> processes) {
    }

    private record TreeComparisonRow(
            String group,
            String name,
            String before,
            String after) {
    }

    private static final class MutableIngredientSummary {
        private final ITypedIngredient<?> ingredient;
        private final List<PlanNode> nodes = new ArrayList<>();
        private long gross;
        private long remaining;

        private MutableIngredientSummary(ITypedIngredient<?> ingredient) {
            this.ingredient = ingredient;
        }

        private IngredientSummary freeze() {
            return new IngredientSummary(ingredient, gross, remaining, List.copyOf(nodes));
        }
    }

    private record ByproductCoverage(
            long amount,
            long request) {
    }

    private static final class MutableByproductSupply {
        private final PlanNode source;
        private long remaining;

        private MutableByproductSupply(PlanNode source, long remaining) {
            this.source = source;
            this.remaining = remaining;
        }
    }

    private record ByproductLink(
            PlanNode source,
            PlanNode target,
            long amount) {
    }

    private record ByproductEdgeKey(
            PlanNode source,
            PlanNode target) {
    }

    private record CurveEndpoints(
            double startX,
            double startY,
            double endX,
            double endY) {
    }

    private record ByproductConsumption(
            long amount,
            List<ByproductLink> links) {
    }

    private record PlanSummary(
            List<ProcessSummary> processes,
            List<IngredientSummary> materials,
            List<IngredientSummary> byproducts,
            Map<PlanNode, ByproductCoverage> coverage,
            List<ByproductLink> links) {
        private static PlanSummary empty() {
            return new PlanSummary(List.of(), List.of(), List.of(), Map.of(), List.of());
        }
    }

    private record ProcessSummary(
            String key,
            String title,
            int color,
            long crafts,
            ItemStack machine,
            List<PlanNode> nodes) {
    }

    private static final class MutableProcessSummary {
        private final String key;
        private final String title;
        private final int color;
        private final ItemStack machine;
        private final List<PlanNode> nodes = new ArrayList<>();
        private long crafts;

        private MutableProcessSummary(String key, String title, int color, ItemStack machine) {
            this.key = key;
            this.title = title;
            this.color = color;
            this.machine = machine;
        }

        private ProcessSummary freeze() {
            return new ProcessSummary(key, title, color, crafts, machine, List.copyOf(nodes));
        }
    }

    private enum SummaryKind {
        MATERIAL,
        BYPRODUCT
    }

    private enum InspectorTab {
        TYPES("Types"),
        MATERIALS("Materials"),
        BYPRODUCTS("Byproducts");

        private final String label;

        InspectorTab(String label) {
            this.label = label;
        }
    }

    private record InspectorTabHitbox(
            InspectorTab tab,
            int left,
            int top,
            int width,
            int height) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }
    }

    private record SummaryPanelBounds(
            int left,
            int top,
            int width,
            int height) {
    }

    private record ToolbarPlacement(
            int left,
            int top,
            int width) {
    }

    private static final class ToolbarFlow {
        private static final int HORIZONTAL_GAP = 4;
        private static final int ROW_STEP = 24;
        private final int startLeft;
        private final int right;
        private int nextLeft;
        private int top;
        private int row;

        private ToolbarFlow(int startLeft, int right, int top) {
            this.startLeft = startLeft;
            this.right = Math.max(startLeft + 1, right);
            this.nextLeft = startLeft;
            this.top = top;
        }

        private ToolbarPlacement place(int requestedWidth) {
            int width = Math.min(Math.max(1, requestedWidth), right - startLeft);
            if (nextLeft > startLeft && nextLeft + width > right) {
                row++;
                top += ROW_STEP;
                nextLeft = startLeft;
            }
            ToolbarPlacement placement = new ToolbarPlacement(nextLeft, top, width);
            nextLeft += width + HORIZONTAL_GAP;
            return placement;
        }

        private int maximumRow() {
            return row;
        }
    }

    private record SummarySectionBounds(
            int left,
            int top,
            int width,
            int height) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }
    }

    private record SummaryRowHitbox(
            IngredientSummary entry,
            SummaryKind kind,
            int left,
            int top,
            int width,
            int height) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }
    }

    private record ProcessRowHitbox(
            ProcessSummary entry,
            int left,
            int top,
            int width,
            int height) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }

        private boolean containsMachine(double mouseX, double mouseY) {
            return mouseX >= left + 2 && mouseX < left + 22
                    && mouseY >= top && mouseY < top + height;
        }
    }

    private record TreeNode(
            PlanNode node,
            int left,
            int top,
            int size) {
        boolean contains(double mouseX, double mouseY) {
            return RecipeTreeScreen.contains(left, top, size, mouseX, mouseY);
        }
    }

    private record StartingNodeRemoveHitbox(
            PlanNode node,
            int left,
            int top,
            int width,
            int height,
            int keepLeft,
            int keepTop,
            int keepWidth,
            int keepHeight) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }

        private boolean keepsVisible(double mouseX, double mouseY) {
            return mouseX >= keepLeft && mouseX < keepLeft + keepWidth
                    && mouseY >= keepTop && mouseY < keepTop + keepHeight;
        }
    }

    private record TreeLayoutNode(
            PlanNode node,
            int left,
            int top,
            int width,
            int height,
            int parentIndex) {
    }

    private record CompactTreeLayout(
            List<TreeLayoutNode> nodes,
            Map<PlanNode, TreeLayoutNode> nodesByPlan,
            int width,
            int height) {
    }

    private record RawTreeLayoutNode(
            PlanNode node,
            double left,
            int top,
            int width,
            int height,
            int parentIndex) {
    }

    private static final class LayoutDraft {
        private final PlanNode node;
        private final NodeSize size;
        private final List<LayoutDraft> children;
        private final List<Double> minimumContour;
        private final List<Double> maximumContour;
        private double offsetX;

        private LayoutDraft(
                PlanNode node,
                NodeSize size,
                List<LayoutDraft> children,
                List<Double> minimumContour,
                List<Double> maximumContour) {
            this.node = node;
            this.size = size;
            this.children = children;
            this.minimumContour = minimumContour;
            this.maximumContour = maximumContour;
        }
    }

    private record NodeSize(
            int width,
            int height) {
    }

    private record RecipeBoxHitbox(
            PlanNode node,
            RecipePage<?> page,
            int left,
            int top,
            int width,
            int height,
            double renderOriginX,
            double renderOriginY,
            double renderScale,
            int layoutLeft,
            int layoutTop) {
        boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width && mouseY >= top && mouseY < top + height;
        }

        Optional<IRecipeSlotDrawable> recipeSlotUnderMouse(double mouseX, double mouseY) {
            IRecipeLayoutDrawable<?> recipeLayout = page.requireLayout();
            recipeLayout.setPosition(layoutLeft, layoutTop);
            return recipeLayout.getRecipeSlotUnderMouse(
                    recipeMouseX(mouseX),
                    recipeMouseY(mouseY));
        }

        double recipeMouseX(double mouseX) {
            return (mouseX - renderOriginX) / renderScale;
        }

        double recipeMouseY(double mouseY) {
            return (mouseY - renderOriginY) / renderScale;
        }
    }

    private record HistoryCardHitbox(
            int entryIndex,
            ItemStack item,
            int left,
            int top,
            int width,
            int height) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }
    }

    private record ChoiceHitbox(RecipeChoice choice, int left, int top, int width, int height) {
        boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width && mouseY >= top && mouseY < top + height;
        }

        Optional<IRecipeSlotDrawable> recipeSlotUnderMouse(double mouseX, double mouseY) {
            return choice.page.layout()
                    .flatMap(layout -> layout.getRecipeSlotUnderMouse(mouseX, mouseY));
        }
    }

    private record OpenChoiceRecipeHitbox(
            RecipePage<?> page,
            int left,
            int top,
            int width,
            int height,
            double renderOriginX,
            double renderOriginY,
            double renderScale) {
        private boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width
                    && mouseY >= top && mouseY < top + height;
        }

        private double recipeMouseX(double mouseX) {
            return (mouseX - renderOriginX) / renderScale;
        }

        private double recipeMouseY(double mouseY) {
            return (mouseY - renderOriginY) / renderScale;
        }
    }

    private record GroupHeaderHitbox(PickerGroup group, int left, int top, int width, int height) {
        boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width && mouseY >= top && mouseY < top + height;
        }
    }

    private record IngredientOptionHitbox(int index, int left, int top, int width, int height) {
        boolean contains(double mouseX, double mouseY) {
            return mouseX >= left && mouseX < left + width && mouseY >= top && mouseY < top + height;
        }
    }
}
