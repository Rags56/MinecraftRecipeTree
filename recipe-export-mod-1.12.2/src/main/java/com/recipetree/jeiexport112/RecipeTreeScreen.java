package com.recipetree.jeiexport112;

import com.google.common.base.Predicate;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import mezz.jei.api.IJeiRuntime;
import mezz.jei.api.IRecipeRegistry;
import mezz.jei.api.gui.IRecipeLayoutDrawable;
import mezz.jei.api.recipe.IFocus;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiButton;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.GuiTextField;
import net.minecraft.client.gui.GuiYesNo;
import net.minecraft.client.gui.GuiYesNoCallback;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.gui.inventory.GuiInventory;
import net.minecraft.client.renderer.BufferBuilder;
import net.minecraft.client.renderer.GlStateManager;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.vertex.DefaultVertexFormats;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.fml.common.Loader;
import org.lwjgl.BufferUtils;
import org.lwjgl.input.Keyboard;
import org.lwjgl.input.Mouse;
import org.lwjgl.opengl.GL11;

import java.awt.Desktop;
import java.io.IOException;
import java.io.Writer;
import java.math.BigDecimal;
import java.nio.IntBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Live, lazy JEI/HEI recipe planner for Minecraft 1.12.2. */
public final class RecipeTreeScreen extends GuiScreen {
    // LWJGL 2's glGetInteger binding validates room for 16 integers even for
    // four-component values such as GL_SCISSOR_BOX.
    static final int OPENGL_INTEGER_QUERY_BUFFER_SIZE = 16;
    static final int MAX_AVAILABILITY_CHECKS_PER_FRAME = 16;
    static final int PAN_OVERVIEW_MARGIN = 6;
    static final int MAX_NATIVE_BUTTON_WIDTH = 200;
    private static final int SHARE_DIALOG_HORIZONTAL_PADDING = 28;
    private static final int SHARE_DIALOG_BUTTON_GAP = 6;
    private static final int SHARE_DIALOG_DONE_WIDTH = 70;
    private static final int PANEL_MARGIN = 8;
    private static final int TOOLBAR_BUTTON_HEIGHT = 20;
    private static final int TREE_NODE_GAP = 12;
    private static final int TREE_LEVEL_GAP = 38;
    private static final int TREE_ROOT_GAP = 42;
    private static final int NODE_COUNT_LABEL_HEIGHT = 14;
    private static final int SUMMARY_WIDTH = 206;
    private static final int PAN_OVERVIEW_WIDTH = 144;
    private static final int PAN_OVERVIEW_HEIGHT = 96;
    private static final int PAN_OVERVIEW_PADDING = 5;
    private static final int MAX_NO_RECIPE_CACHE = RecipeTreeModel.MAX_NODES;
    private static final int MAX_LAYOUT_NODES = 2048;
    private static final int GRAPH_CONNECTOR_COLOR = 0xFF718171;
    private static final int NEUTRAL_NODE_BORDER = 0xFF718171;
    private static final ResourceLocation PROJECTE_TRANSMUTATION_TEXTURE =
            new ResourceLocation("projecte", "textures/gui/transmute.png");
    private static final float MIN_ZOOM = 0.28F;
    private static final float MAX_ZOOM = 2.25F;
    private static final Gson SHARE_GSON = new GsonBuilder().setPrettyPrinting().create();

    private static final int BUTTON_PREVIOUS = 1;
    private static final int BUTTON_HISTORY = 2;
    private static final int BUTTON_NEXT = 3;
    private static final int BUTTON_OPEN_JEI = 4;
    private static final int BUTTON_MODE = 5;
    private static final int BUTTON_TRANSFER = 6;
    private static final int BUTTON_CENTER = 9;
    private static final int BUTTON_RECIPE_BOOK = 11;

    private static RecipeTreeScreen lastScreen;

    private final RecipeTreeViewerBridge bridge;
    private final RecipeTreeProgress progress;
    private RecipeTreeModel model;
    private RecipeTreeViewerBridge.Ingredient target;
    private final List<RecipeTreeProgress.RecipeHistoryEntry> history;
    private int historyIndex;

    private int panelLeft;
    private int panelTop;
    private int panelRight;
    private int panelBottom;
    private int treeLeft;
    private int treeTop;
    private int treeRight;
    private int treeBottom;
    private int summaryLeft;
    private boolean compactMode;
    private boolean useByproducts = true;
    private boolean recipeBookMode;
    private SummaryTab summaryTab = SummaryTab.TYPES;
    private final int[] summaryScrollRows = new int[SummaryTab.values().length];
    private int summaryMaximumScroll;
    private String selectedProcessKey;
    private String status = "";

    private GuiTextField amountField;
    private GuiButton previousButton;
    private GuiButton nextButton;
    private GuiButton modeButton;
    private GuiButton recipeBookButton;

    private float treeZoom = 1.0F;
    private double panX;
    private double panY;
    private boolean centered;
    private boolean panning;
    private int lastDragX;
    private int lastDragY;
    private RecipeTreeLayout.Result<RecipeTreeModel.Node> layout;
    private boolean layoutDirty = true;
    private int availabilityChecksRemaining;

    private final List<NodeHitbox> nodeHitboxes = new ArrayList<NodeHitbox>();
    private final List<RootRemoveHitbox> rootRemoveHitboxes = new ArrayList<RootRemoveHitbox>();
    private final List<TabHitbox> tabHitboxes = new ArrayList<TabHitbox>();
    private final List<ProcessHitbox> processHitboxes = new ArrayList<ProcessHitbox>();
    private final List<MachineHitbox> machineHitboxes = new ArrayList<MachineHitbox>();
    private final List<NativeRecipeRegion> nativeRecipeRegions =
            new ArrayList<NativeRecipeRegion>();
    private final List<LiveIngredientRegion> liveIngredientRegions =
            new ArrayList<LiveIngredientRegion>();
    private RecipeTreeModel.Node hoveredNode;
    private RootRemoveHitbox retainedRemoveButton;
    private ReusableToggleHitbox reusableToggleHitbox;
    private Hitbox byproductsToggleHitbox;
    private RecipeTreeViewerBridge.Recipe previewRecipe;
    private final LinkedHashMap<String, Boolean> noRecipeCache =
            new LinkedHashMap<String, Boolean>(128, 0.75F, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                    return size() > MAX_NO_RECIPE_CACHE;
                }
            };
    private final Set<String> loggedRenderFailures = new HashSet<String>();
    private final Set<String> nativeRecipeDrawFailures = new HashSet<String>();

    public RecipeTreeScreen(
            RecipeTreeViewerBridge bridge,
            RecipeTreeViewerBridge.Ingredient target) {
        if (bridge == null) throw new IllegalArgumentException("Recipe viewer bridge is required");
        if (target == null) throw new IllegalArgumentException("Recipe tree target is required");
        this.bridge = bridge;
        this.progress = RecipeTreeProgress.get();
        this.target = target;
        this.model = new RecipeTreeModel(bridge, progress, target, 1L);
        this.recipeBookMode = progress.recipeBookMode();
        this.history = new ArrayList<RecipeTreeProgress.RecipeHistoryEntry>(
                progress.recipeHistory());
        this.historyIndex = history.size();
        commitHistory(false);
        String preferred = progress.favoriteRecipe(target.getKey());
        if (preferred != null) {
            RecipeTreeViewerBridge.Recipe recipe = model.recipeByKey(target, preferred);
            if (recipe != null) model.setRecipe(model.getPrimaryRoot(), recipe, false);
        }
    }

    private RecipeTreeScreen(
            RecipeTreeViewerBridge bridge,
            RecipeTreeModel model,
            boolean compactMode,
            List<RecipeTreeProgress.RecipeHistoryEntry> history,
            int historyIndex) {
        this.bridge = bridge;
        this.progress = RecipeTreeProgress.get();
        this.model = model;
        this.target = model.getPrimaryRoot().getIngredient();
        this.compactMode = compactMode;
        this.recipeBookMode = progress.recipeBookMode();
        this.history = new ArrayList<RecipeTreeProgress.RecipeHistoryEntry>(history);
        this.historyIndex = historyIndex;
    }

    static RecipeTreeScreen restoreLastViewed(RecipeTreeViewerBridge bridge) {
        RecipeTreeProgress progress = RecipeTreeProgress.get();
        RecipeTreeProgress.RecipeHistoryEntry entry = progress.lastViewedRecipeTree();
        RecipeTreeModel restored = RecipeTreeModel.restore(bridge, progress, entry);
        if (restored == null) return null;
        List<RecipeTreeProgress.RecipeHistoryEntry> entries = progress.recipeHistory();
        int index = entries.indexOf(entry);
        if (index < 0) index = Math.max(0, entries.size() - 1);
        return new RecipeTreeScreen(
                bridge, restored, entry.isCompactMode(), entries, index);
    }

    GuiScreen initialInputRecipeScreen() {
        RecipeTreeModel.Node root = model.getPrimaryRoot();
        if (root == null) return this;
        List<RecipeTreeViewerBridge.RecipeGroup> groups =
                model.recipesFor(root.getIngredient(), IFocus.Mode.OUTPUT);
        return recipeCount(groups) == 0 ? this
                : new RecipePickerScreen(this, root, IFocus.Mode.OUTPUT, true);
    }

    GuiScreen screenForOpenedIngredient(RecipeTreeViewerBridge.Ingredient opened) {
        if (opened == null) return this;
        for (RecipeTreeModel.Node root : model.getRoots()) {
            if (root.getIngredient().getKey().equals(opened.getKey())) return this;
        }
        return new OpenItemChoiceScreen(this, opened);
    }

    static void releaseRuntimeLayouts() {
        if (lastScreen != null) {
            lastScreen.bridge.clearNativeLayouts();
            lastScreen = null;
        }
    }

    @Override
    public void initGui() {
        Keyboard.enableRepeatEvents(true);
        buttonList.clear();
        lastScreen = this;
        RecipeTreeClient.rememberTree(this);

        panelLeft = PANEL_MARGIN;
        panelTop = PANEL_MARGIN;
        panelRight = width - PANEL_MARGIN;
        panelBottom = height - PANEL_MARGIN;
        summaryLeft = panelRight - SUMMARY_WIDTH;

        int toolbarLeft = panelLeft + 12;
        int toolbarRight = panelRight - 12;
        ToolbarFlow flow = new ToolbarFlow(toolbarLeft, toolbarRight, panelTop + 30);
        previousButton = addFlowButton(flow, BUTTON_PREVIOUS, 22, "<");
        buttonList.add(new ClockButton(BUTTON_HISTORY, flow.take(22), flow.getRowY()));
        flow.advance(22);
        nextButton = addFlowButton(flow, BUTTON_NEXT, 22, ">");
        addFlowButton(flow, BUTTON_OPEN_JEI, 82, "Open in XEI");

        ToolbarPlacement amountPlacement = flow.place(92);
        amountField = new GuiTextField(40, fontRenderer,
                amountPlacement.left + 30, amountPlacement.top, 62, 20);
        amountField.setValidator(new Predicate<String>() {
            @Override
            public boolean apply(String value) {
                return value != null && (value.isEmpty() || value.matches("[0-9]{0,3}"));
            }
        });
        amountField.setMaxStringLength(3);
        amountField.setText(Long.toString(primaryAmount()));

        modeButton = addFlowButton(flow, BUTTON_MODE, 72, "");
        addFlowButton(flow, BUTTON_TRANSFER, 88, "Import/Export");
        addFlowButton(flow, BUTTON_CENTER, 54, "Center");
        recipeBookButton = addFlowButton(flow, BUTTON_RECIPE_BOOK, 96, "");
        updateButtonLabels();

        treeLeft = panelLeft + 10;
        treeTop = flow.getBottom() + 8;
        treeRight = summaryLeft - 6;
        treeBottom = panelBottom - 10;
        if (!centered) centerTree();
    }

    private GuiButton addFlowButton(ToolbarFlow flow, int id, int width, String label) {
        ToolbarPlacement placement = flow.place(width);
        GuiButton button = new GuiButton(id, placement.left, placement.top,
                placement.width, TOOLBAR_BUTTON_HEIGHT, label);
        buttonList.add(button);
        return button;
    }

    private void updateButtonLabels() {
        if (modeButton != null) modeButton.displayString = compactMode ? "Details" : "Compact";
        if (recipeBookButton != null) {
            recipeBookButton.displayString = "Recipe book" + (recipeBookMode ? " ON" : "");
        }
        if (previousButton != null) previousButton.enabled = historyIndex > 0;
        if (nextButton != null) nextButton.enabled = historyIndex + 1 < history.size();
    }

    @Override
    protected void actionPerformed(GuiButton button) throws IOException {
        switch (button.id) {
            case BUTTON_PREVIOUS:
                navigateHistory(-1);
                break;
            case BUTTON_HISTORY:
                mc.displayGuiScreen(new HistorySelectorScreen(this, this));
                break;
            case BUTTON_NEXT:
                navigateHistory(1);
                break;
            case BUTTON_OPEN_JEI:
                openJei(target, IFocus.Mode.OUTPUT);
                break;
            case BUTTON_MODE:
                compactMode = !compactMode;
                invalidateLayout();
                updateButtonLabels();
                commitHistory(false);
                break;
            case BUTTON_TRANSFER:
                mc.displayGuiScreen(new TreeTransferScreen(this));
                break;
            case BUTTON_CENTER:
                centerTree();
                break;
            case BUTTON_RECIPE_BOOK:
                recipeBookMode = !recipeBookMode;
                progress.setRecipeBookMode(recipeBookMode);
                invalidateLayout();
                updateButtonLabels();
                status = recipeBookMode
                        ? "Discovered branches collapsed"
                        : "All branches shown";
                break;
            default:
                break;
        }
    }

    @Override
    public void drawScreen(int mouseX, int mouseY, float partialTicks) {
        availabilityChecksRemaining = MAX_AVAILABILITY_CHECKS_PER_FRAME;
        nativeRecipeRegions.clear();
        liveIngredientRegions.clear();
        tabHitboxes.clear();
        processHitboxes.clear();
        machineHitboxes.clear();
        byproductsToggleHitbox = null;
        drawGradientRect(0, 0, width, height, 0x90000000, 0xB0000000);
        Gui.drawRect(panelLeft, panelTop, panelRight, panelBottom, 0xEA101617);
        Gui.drawRect(panelLeft, panelTop, panelRight, panelTop + 2, 0xFF55B947);

        safeRenderIngredient(target, panelLeft + 12, panelTop + 10, "screen-header");
        fontRenderer.drawString(target.getDisplayName(), panelLeft + 34, panelTop + 14,
                0xFFF3F3F3);
        fontRenderer.drawString("AMT", amountField.x - 28, amountField.y + 6, 0xFF9BAA9A);
        if (model.getPrimaryRoot() != null && model.getPrimaryRoot().getRecipe() != null) {
            String type = model.getPrimaryRoot().getRecipe().getCategoryTitle();
            fontRenderer.drawString(type, panelRight - 12 - fontRenderer.getStringWidth(type),
                    panelTop + 14, 0xFFD8E9D5);
        }

        drawTree(mouseX, mouseY);
        drawSummary(mouseX, mouseY);
        drawPanOverview();
        super.drawScreen(mouseX, mouseY, partialTicks);
        amountField.drawTextBox();
        if (!status.isEmpty()) {
            int statusWidth = fontRenderer.getStringWidth(status);
            fontRenderer.drawStringWithShadow(status, (width - statusWidth) / 2,
                    panelBottom - 16, 0xFF8FE871);
        }
        boolean nativeContentHovered = pointInsideViewport(mouseX, mouseY,
                treeLeft, treeTop, panelRight - 10, treeBottom)
                && drawNativeIngredientTooltip(mouseX, mouseY);
        if (!nativeContentHovered) {
            drawNodeTooltip(mouseX, mouseY);
        }
    }

    private void drawTree(int mouseX, int mouseY) {
        ensureLayout();
        nodeHitboxes.clear();
        rootRemoveHitboxes.clear();
        hoveredNode = null;
        previewRecipe = null;
        reusableToggleHitbox = null;

        enableScissor(treeLeft, treeTop, treeRight, treeBottom);
        try {
            drawEdges();
            for (RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed : layout.nodes) {
                drawPlacedNode(placed, mouseX, mouseY);
            }
        } finally {
            GL11.glDisable(GL11.GL_SCISSOR_TEST);
            GlStateManager.color(1F, 1F, 1F, 1F);
        }

        drawRootRemoveButtons(mouseX, mouseY);
    }

    private void drawPanOverview() {
        if (!panning || layout == null || layout.nodes.isEmpty()) return;
        int viewportWidth = Math.max(1, treeRight - treeLeft);
        int viewportHeight = Math.max(1, treeBottom - treeTop);
        int scaledTreeWidth = Math.max(1, Math.round(layout.width * treeZoom));
        int scaledTreeHeight = Math.max(1, Math.round(layout.height * treeZoom));
        if (!panOverviewRequired(
                scaledTreeWidth, scaledTreeHeight, viewportWidth, viewportHeight)) return;

        int overviewWidth = Math.min(PAN_OVERVIEW_WIDTH,
                Math.max(1, viewportWidth - PAN_OVERVIEW_MARGIN * 2));
        int overviewHeight = Math.min(PAN_OVERVIEW_HEIGHT,
                Math.max(1, viewportHeight - PAN_OVERVIEW_MARGIN * 2));
        if (overviewWidth < 36 || overviewHeight < 28) return;

        int originX = treeOriginX();
        int originY = treeOriginY();
        PanOverviewGeometry geometry = panOverviewGeometry(
                treeLeft + PAN_OVERVIEW_MARGIN,
                treeTop + PAN_OVERVIEW_MARGIN,
                overviewWidth,
                overviewHeight,
                layout.width,
                layout.height,
                (treeLeft - originX) / (double) treeZoom,
                (treeTop - originY) / (double) treeZoom,
                viewportWidth / (double) treeZoom,
                viewportHeight / (double) treeZoom,
                PAN_OVERVIEW_PADDING);

        Gui.drawRect(geometry.outerLeft + 2, geometry.outerTop + 2,
                geometry.outerRight + 2, geometry.outerBottom + 2, 0x77000000);
        Gui.drawRect(geometry.outerLeft, geometry.outerTop,
                geometry.outerRight, geometry.outerBottom, 0xE61C2721);
        drawOutline(geometry.outerLeft, geometry.outerTop,
                geometry.outerRight, geometry.outerBottom, 0xFF718171);
        drawPanOverviewTree(geometry);
        Gui.drawRect(geometry.viewportLeft, geometry.viewportTop,
                geometry.viewportRight, geometry.viewportBottom, 0x44FFFFFF);
        drawOutline(geometry.viewportLeft, geometry.viewportTop,
                geometry.viewportRight, geometry.viewportBottom, 0xFFFFFFFF);
    }

    private void drawPanOverviewTree(PanOverviewGeometry geometry) {
        Tessellator tessellator = Tessellator.getInstance();
        BufferBuilder buffer = tessellator.getBuffer();
        GlStateManager.disableTexture2D();
        try {
            buffer.begin(GL11.GL_LINES, DefaultVertexFormats.POSITION_COLOR);
            for (RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed : layout.nodes) {
                if (placed.parentIndex < 0 || placed.parentIndex >= layout.nodes.size()) continue;
                RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> parent =
                        layout.nodes.get(placed.parentIndex);
                overviewVertex(buffer,
                        geometry.mapX(parent.left + parent.width / 2.0),
                        geometry.mapY(parent.top + parent.height / 2.0),
                        0xFF718171);
                overviewVertex(buffer,
                        geometry.mapX(placed.left + placed.width / 2.0),
                        geometry.mapY(placed.top + placed.height / 2.0),
                        0xFF718171);
            }
            tessellator.draw();

            buffer.begin(GL11.GL_QUADS, DefaultVertexFormats.POSITION_COLOR);
            for (RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed : layout.nodes) {
                int left = geometry.mapX(placed.left);
                int top = geometry.mapY(placed.top);
                int right = Math.max(left + 1, geometry.mapX(placed.left + placed.width));
                int bottom = Math.max(top + 1, geometry.mapY(placed.top + placed.height));
                int color = placed.parentIndex < 0 ? 0xFF8FE871 : 0xFFD8E9D5;
                overviewQuad(buffer, left, top, right, bottom, color);
            }
            tessellator.draw();
        } finally {
            GlStateManager.enableTexture2D();
            GlStateManager.color(1F, 1F, 1F, 1F);
        }
    }

    private static void overviewVertex(BufferBuilder buffer, int x, int y, int color) {
        buffer.pos(x, y, 0).color(
                color >> 16 & 255,
                color >> 8 & 255,
                color & 255,
                color >>> 24).endVertex();
    }

    private static void overviewQuad(
            BufferBuilder buffer, int left, int top, int right, int bottom, int color) {
        overviewVertex(buffer, left, bottom, color);
        overviewVertex(buffer, right, bottom, color);
        overviewVertex(buffer, right, top, color);
        overviewVertex(buffer, left, top, color);
    }

    private void drawEdges() {
        if (layout == null) return;
        int size = layout.nodes.size();
        int[] minimumChildX = new int[size];
        int[] maximumChildX = new int[size];
        int[] childTop = new int[size];
        int[] busY = new int[size];
        boolean[] hasChildren = new boolean[size];
        for (int index = 0; index < size; index++) {
            minimumChildX[index] = Integer.MAX_VALUE;
            maximumChildX[index] = Integer.MIN_VALUE;
        }
        for (RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed : layout.nodes) {
            if (placed.parentIndex < 0 || placed.parentIndex >= size) continue;
            ScreenRect child = screenRect(placed);
            int childX = child.left + child.width / 2;
            int parentIndex = placed.parentIndex;
            minimumChildX[parentIndex] = Math.min(minimumChildX[parentIndex], childX);
            maximumChildX[parentIndex] = Math.max(maximumChildX[parentIndex], childX);
            childTop[parentIndex] = child.top;
            hasChildren[parentIndex] = true;
        }
        for (int parentIndex = 0; parentIndex < size; parentIndex++) {
            if (!hasChildren[parentIndex]) continue;
            ScreenRect parent = screenRect(layout.nodes.get(parentIndex));
            int parentX = parent.left + parent.width / 2;
            int parentBottom = parent.top + parent.height + nodeCountLabelHeight();
            int middle = parentBottom + (childTop[parentIndex] - parentBottom) / 2;
            busY[parentIndex] = middle;
            Gui.drawRect(parentX, parentBottom, parentX + 1, middle + 1,
                    GRAPH_CONNECTOR_COLOR);
            Gui.drawRect(minimumChildX[parentIndex], middle,
                    maximumChildX[parentIndex] + 1, middle + 1, GRAPH_CONNECTOR_COLOR);
        }
        for (RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed : layout.nodes) {
            if (placed.parentIndex < 0 || placed.parentIndex >= size) continue;
            ScreenRect child = screenRect(placed);
            int childX = child.left + child.width / 2;
            Gui.drawRect(childX, busY[placed.parentIndex], childX + 1, child.top + 1,
                    GRAPH_CONNECTOR_COLOR);
        }
    }

    private void drawPlacedNode(
            RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed,
            int mouseX,
            int mouseY) {
        RecipeTreeModel.Node node = placed.node;
        ScreenRect rect = screenRect(placed);
        if (!intersectsViewport(rect.left, rect.top, rect.width,
                rect.height + nodeCountLabelHeight(),
                treeLeft, treeTop, treeRight, treeBottom)) {
            return;
        }
        NodeHitbox hitbox = new NodeHitbox(node, rect.left, rect.top, rect.width, rect.height);
        nodeHitboxes.add(hitbox);
        boolean hovered = pointInsideViewport(mouseX, mouseY,
                treeLeft, treeTop, treeRight, treeBottom) && hitbox.contains(mouseX, mouseY);
        if (hovered) {
            hoveredNode = node;
            previewRecipe = node.getRecipe();
        }

        boolean selectedType = selectedProcessKey != null && node.getRecipe() != null
                && selectedProcessKey.equals(node.getRecipe().getCategoryUid());
        int border = selectedType ? processColor(node) : NEUTRAL_NODE_BORDER;
        if (!compactMode && node.getRecipe() != null) {
            drawRecipeNode(node, rect, mouseX, mouseY, border, selectedType);
        } else {
            drawIngredientNode(node, rect, border, hovered, selectedType);
        }
    }

    private void drawIngredientNode(
            RecipeTreeModel.Node node,
            ScreenRect rect,
            int border,
            boolean hovered,
            boolean selectedType) {
        int background = nodeBackground(node, hovered);
        if (selectedType) background = mixColor(background, border, 1, 4);
        int cardBottom = rect.top + rect.height;
        Gui.drawRect(rect.left, rect.top, rect.left + rect.width, cardBottom,
                background);
        if (selectedType) {
            drawOutline(rect.left - 1, rect.top - 1,
                    rect.left + rect.width + 1, cardBottom + 1, border);
        } else {
            Gui.drawRect(rect.left, rect.top, rect.left + rect.width, rect.top + 1, border);
        }
        float scale = nodeVisualScale(treeZoom);
        int iconX = rect.left + (rect.width - Math.round(16 * scale)) / 2;
        int iconY = rect.top + (cardBottom - rect.top - Math.round(16 * scale)) / 2;
        GlStateManager.pushMatrix();
        try {
            GlStateManager.translate(iconX, iconY, 0);
            GlStateManager.scale(scale, scale, 1F);
            safeRenderIngredient(node.getIngredient(), 0, 0, "tree-node");
        } catch (RuntimeException error) {
            logRenderFailure("ingredient:" + node.getIngredient().getKey(), error);
            fontRenderer.drawString("!", 0, 0, 0xFFFF5555);
        } finally {
            GlStateManager.popMatrix();
            GlStateManager.color(1F, 1F, 1F, 1F);
        }
        drawNodeCount(node, rect);
    }

    private void drawRecipeNode(
            RecipeTreeModel.Node node,
            ScreenRect rect,
            int mouseX,
            int mouseY,
            int border,
            boolean selectedType) {
        RecipeTreeViewerBridge.Recipe recipe = node.getRecipe();
        int cardBottom = rect.top + rect.height;
        int nativeWidth = recipe.getWidth();
        int nativeHeight = recipe.getHeight();
        float scale = Math.min(rect.width / (float) nativeWidth,
                rect.height / (float) nativeHeight);
        scale = Math.max(0.15F, scale);
        int drawX = rect.left + (rect.width - Math.round(nativeWidth * scale)) / 2;
        int drawY = rect.top + (rect.height - Math.round(nativeHeight * scale)) / 2;
        drawNativeRecipe(recipe, drawX, drawY, scale,
                (int) ((mouseX - drawX) / scale), (int) ((mouseY - drawY) / scale));
        if (selectedType) {
            // Tint the rendered recipe itself. Drawing this before the native recipe hid the
            // shading and left only a fixed three-pixel halo whose relative size changed on zoom.
            Gui.drawRect(rect.left, rect.top,
                    rect.left + rect.width, cardBottom,
                    selectedRecipeTintColor(border));
        }
        drawNodeCount(node, rect);
    }

    static int selectedRecipeTintColor(int recipeTypeColor) {
        return (recipeTypeColor & 0x00FFFFFF) | 0x44000000;
    }

    private void drawNodeCount(RecipeTreeModel.Node node, ScreenRect rect) {
        String amount = RecipeTreeModel.formatAmount(node.getDemand()) + "x";
        float textScale = nodeVisualScale(treeZoom);
        int textWidth = Math.round(fontRenderer.getStringWidth(amount) * textScale);
        GlStateManager.pushMatrix();
        try {
            GlStateManager.translate(rect.left + (rect.width - textWidth) / 2,
                    nodeCountTop(rect.top + rect.height, textScale), 0);
            GlStateManager.scale(textScale, textScale, 1F);
            fontRenderer.drawStringWithShadow(amount, 0, 0, 0xFFF2F2F2);
        } finally {
            GlStateManager.popMatrix();
            GlStateManager.color(1F, 1F, 1F, 1F);
        }
    }

    private void drawRootRemoveButtons(int mouseX, int mouseY) {
        boolean retainedWasDrawn = false;
        for (RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed : layout.nodes) {
            RecipeTreeModel.Node node = placed.node;
            if (node.getParent() != null || model.getRoots().size() <= 1) continue;
            ScreenRect rect = screenRect(placed);
            if (!intersectsViewport(rect.left, rect.top, rect.width, rect.height,
                    treeLeft, treeTop, treeRight, treeBottom)) continue;
            RootRemoveHitbox drawn = drawRootRemoveButton(
                    node,
                    rect,
                    mouseX,
                    mouseY);
            if (drawn != null && retainedRemoveButton != null
                    && retainedRemoveButton.node == drawn.node) {
                retainedWasDrawn = true;
            }
        }
        if (!retainedWasDrawn && retainedRemoveButton != null
                && !retainedRemoveButton.keepsVisible(mouseX, mouseY)) {
            retainedRemoveButton = null;
        }
    }

    private RootRemoveHitbox drawRootRemoveButton(
            RecipeTreeModel.Node node,
            ScreenRect rect,
            int mouseX,
            int mouseY) {
        if (node.getParent() != null || model.getRoots().size() <= 1) return null;
        boolean keepVisible = retainedRemoveButton != null
                && retainedRemoveButton.node == node
                && retainedRemoveButton.keepsVisible(mouseX, mouseY);
        boolean nodeHovered = mouseX >= rect.left && mouseX < rect.left + rect.width
                && mouseY >= rect.top && mouseY < rect.top + rect.height;
        if (!keepVisible && !nodeHovered) return null;
        int size = 11;
        int left = rect.left + rect.width - size;
        int top = rect.top - size - 3;
        if (top < treeTop + 2) {
            top = Math.max(treeTop + 2, Math.min(treeBottom - size - 2, rect.top));
            left = rect.left + rect.width + 3;
            if (left + size > treeRight - 2) left = rect.left - size - 3;
        }
        if (left < treeLeft + 2 || left + size > treeRight - 2
                || top < treeTop + 2 || top + size > treeBottom - 2) {
            return null;
        }
        int keepLeft = Math.min(rect.left, left);
        int keepTop = Math.min(rect.top, top);
        int keepRight = Math.max(rect.left + rect.width, left + size);
        int keepBottom = Math.max(rect.top + rect.height, top + size);
        RootRemoveHitbox button = new RootRemoveHitbox(
                node, left, top, size, size,
                keepLeft, keepTop, keepRight - keepLeft, keepBottom - keepTop);
        retainedRemoveButton = button;
        rootRemoveHitboxes.add(button);
        Gui.drawRect(left + 1, top + 2, left + size + 1, top + size + 1, 0x99000000);
        Gui.drawRect(left, top, left + size, top + size,
                button.contains(mouseX, mouseY) ? 0xFFC85353 : 0xFF793939);
        fontRenderer.drawString("x", left + 3, top + 1, 0xFFFFFFFF);
        return button;
    }

    private void drawSummary(int mouseX, int mouseY) {
        Gui.drawRect(summaryLeft, treeTop, panelRight - 10, treeBottom, 0xCC1C2721);
        tabHitboxes.clear();
        processHitboxes.clear();
        machineHitboxes.clear();
        int tabWidth = (panelRight - 10 - summaryLeft) / 3;
        SummaryTab[] tabs = SummaryTab.values();
        for (int index = 0; index < tabs.length; index++) {
            int left = summaryLeft + index * tabWidth;
            int right = index == tabs.length - 1 ? panelRight - 10 : left + tabWidth;
            TabHitbox hitbox = new TabHitbox(tabs[index], left, treeTop, right - left, 22);
            tabHitboxes.add(hitbox);
            Gui.drawRect(left, treeTop, right, treeTop + 22,
                    summaryTab == tabs[index] ? 0xFF486541 : 0xFF26312B);
            String label = tabs[index].label;
            fontRenderer.drawString(label,
                    left + (right - left - fontRenderer.getStringWidth(label)) / 2,
                    treeTop + 7, 0xFFE4E8E2);
        }

        int top = treeTop + 32;
        if (hoveredNode != null) {
            top = Math.max(top, drawSummaryPreview(mouseX, mouseY) + 6);
        }
        if (summaryTab == SummaryTab.BYPRODUCTS) {
            int buttonLeft = summaryLeft + 7;
            int buttonRight = panelRight - 17;
            boolean hovered = contains(buttonLeft, top, buttonRight - buttonLeft, 20,
                    mouseX, mouseY);
            Gui.drawRect(buttonLeft + 1, top + 1, buttonRight + 1, top + 21,
                    0x99000000);
            Gui.drawRect(buttonLeft, top, buttonRight, top + 20,
                    hovered ? 0xFF61745F : 0xFF4A584A);
            String label = "Use byproducts: " + (useByproducts ? "ON" : "OFF");
            fontRenderer.drawString(label,
                    buttonLeft + (buttonRight - buttonLeft
                            - fontRenderer.getStringWidth(label)) / 2,
                    top + 6, 0xFFF1F1F1);
            byproductsToggleHitbox = new Hitbox(
                    buttonLeft, top, buttonRight - buttonLeft, 20);
            top += 28;
        }
        RecipeTreeModel.Summary summary = model.summarize(useByproducts);
        int rowHeight = summaryTab == SummaryTab.TYPES ? 24
                : summaryTab == SummaryTab.MATERIALS ? 22 : 30;
        int rowCount = summaryTab == SummaryTab.TYPES ? summary.processes.size()
                : summaryTab == SummaryTab.MATERIALS ? summary.materials.size()
                : (summary.byproducts.size() + byproductColumns() - 1) / byproductColumns();
        int visibleRows = Math.max(0, (treeBottom - top) / rowHeight);
        summaryMaximumScroll = summaryMaximumScroll(rowCount, visibleRows);
        int tabIndex = summaryTab.ordinal();
        summaryScrollRows[tabIndex] = clamp(summaryScrollRows[tabIndex], 0, summaryMaximumScroll);
        if (summaryTab == SummaryTab.TYPES) drawProcesses(summary.processes, top, mouseX, mouseY);
        else if (summaryTab == SummaryTab.MATERIALS) {
            drawSummaryList(summary.materials, top, mouseX, mouseY, false);
        } else {
            drawByproductGrid(summary.byproducts, top, mouseX, mouseY);
        }
        if (visibleRows > 0) {
            drawScrollbar(panelRight - 14, top, top + visibleRows * rowHeight,
                    summaryScrollRows[tabIndex] * rowHeight, rowCount * rowHeight);
        }
    }

    static int summaryMaximumScroll(int rowCount, int visibleRows) {
        return Math.max(0, rowCount - Math.max(1, visibleRows));
    }

    static int scrollSummaryRows(int current, int wheel, int maximum) {
        return clamp(current + (wheel < 0 ? 3 : wheel > 0 ? -3 : 0), 0, maximum);
    }

    private static int byproductColumns() {
        return Math.max(1, (SUMMARY_WIDTH - 16) / 30);
    }

    private int drawSummaryPreview(int mouseX, int mouseY) {
        int left = summaryLeft + 6;
        int top = treeTop + 28;
        int right = panelRight - 16;
        int cursor = top;
        if (previewRecipe != null) {
            float scale = Math.min((right - left) / (float) previewRecipe.getWidth(),
                    90F / previewRecipe.getHeight());
            scale = Math.min(1F, Math.max(0.2F, scale));
            int recipeWidth = Math.round(previewRecipe.getWidth() * scale);
            int recipeLeft = left + Math.max(0, (right - left - recipeWidth) / 2);
            drawNativeRecipe(previewRecipe, recipeLeft, cursor, scale,
                    (int) ((mouseX - recipeLeft) / scale),
                    (int) ((mouseY - cursor) / scale));
            cursor += Math.round(previewRecipe.getHeight() * scale) + 6;
        }
        List<String> lines = nodePanelActionLines(
                RecipeTreeModel.formatAmount(hoveredNode.getDemand()),
                progress.hasDiscovered(hoveredNode.getIngredient().getKey()),
                hoveredNode.getAlternativeIndex(),
                hoveredNode.getAlternatives().size(),
                hasRecipes(hoveredNode.getIngredient()));
        for (String line : lines) {
            fontRenderer.drawString(line, left + 4, cursor, 0xFFCAD5C8);
            cursor += 10;
        }
        if (hoveredNode.getParent() != null) {
            int buttonLeft = left + 4;
            int buttonRight = right - 4;
            boolean hovered = contains(buttonLeft, cursor + 2,
                    buttonRight - buttonLeft, 18, mouseX, mouseY);
            Gui.drawRect(buttonLeft + 1, cursor + 3, buttonRight + 1, cursor + 21,
                    0x99000000);
            Gui.drawRect(buttonLeft, cursor + 2, buttonRight, cursor + 20,
                    hovered ? 0xFF61745F : 0xFF4A584A);
            String label = reusableToggleLabel(hoveredNode.isManualReusableInput());
            fontRenderer.drawString(label,
                    buttonLeft + (buttonRight - buttonLeft
                            - fontRenderer.getStringWidth(label)) / 2,
                    cursor + 7, 0xFFF1F1F1);
            reusableToggleHitbox = new ReusableToggleHitbox(
                    hoveredNode, buttonLeft, cursor + 2, buttonRight - buttonLeft, 18);
            cursor += 24;
        }
        return cursor;
    }

    static List<String> nodePanelActionLines(
            String required,
            boolean discovered,
            int alternativeIndex,
            int alternativeCount,
            boolean hasInputRecipes) {
        List<String> lines = new ArrayList<String>();
        lines.add("Required: " + required);
        if (discovered) lines.add("Discovered");
        if (alternativeCount > 1) {
            lines.add("Scroll to change item " + (alternativeIndex + 1)
                    + " / " + alternativeCount);
            lines.add("Middle click: choose from a grid");
        }
        lines.add(hasInputRecipes ? "Left click: select input recipe" : "No recipes");
        lines.add("Right click: view recipes using this item");
        return lines;
    }

    static String reusableToggleLabel(boolean reusable) {
        return reusable ? "Reusable input: ON (R)" : "Reusable input: OFF (R)";
    }

    static String pickerReusableLabel(boolean reusable) {
        return reusable ? "Reusable: ON" : "Reusable: OFF";
    }

    private void drawProcesses(
            List<RecipeTreeModel.ProcessSummary> processes,
            int top,
            int mouseX,
            int mouseY) {
        int y = top;
        for (int index = summaryScrollRows[SummaryTab.TYPES.ordinal()];
             index < processes.size(); index++) {
            if (y + 24 > treeBottom) break;
            RecipeTreeModel.ProcessSummary process = processes.get(index);
            boolean hovered = mouseX >= summaryLeft + 5 && mouseX < panelRight - 15
                    && mouseY >= y && mouseY < y + 22;
            boolean selected = process.key.equals(selectedProcessKey);
            Gui.drawRect(summaryLeft + 5, y, panelRight - 15, y + 22,
                    selected ? 0xFF496D45 : hovered ? 0xFF35473B : 0x552B382F);
            Gui.drawRect(summaryLeft + 5, y, summaryLeft + 8, y + 22,
                    processColor(process.key));
            if (process.machine != null) {
                safeRenderIngredient(process.machine, summaryLeft + 11, y + 3,
                        "type-machine");
                machineHitboxes.add(new MachineHitbox(
                        process.machine, summaryLeft + 9, y + 1, 20, 20));
            }
            int nameX = summaryLeft + (process.machine == null ? 12 : 31);
            String title = trim(process.title, panelRight - 58 - nameX);
            fontRenderer.drawString(title, nameX, y + 7, 0xFFE3E6E1);
            String usage = RecipeTreeModel.formatAmount(process.crafts) + "x";
            fontRenderer.drawString(usage, panelRight - 18 - fontRenderer.getStringWidth(usage),
                    y + 7, 0xFFB8C6B4);
            processHitboxes.add(new ProcessHitbox(process, summaryLeft + 5, y,
                    panelRight - summaryLeft - 20, 22));
            y += 24;
        }
    }

    private void drawSummaryList(
            List<RecipeTreeModel.SummaryEntry> entries,
            int top,
            int mouseX,
            int mouseY,
            boolean byproduct) {
        int y = top;
        for (int index = summaryScrollRows[SummaryTab.MATERIALS.ordinal()];
             index < entries.size(); index++) {
            if (y + 22 > treeBottom) break;
            RecipeTreeModel.SummaryEntry entry = entries.get(index);
            safeRenderIngredient(entry.ingredient, summaryLeft + 9, y + 3,
                    byproduct ? "byproduct-list" : "material-list");
            String name = trim(entry.ingredient.getDisplayName(), SUMMARY_WIDTH - 72);
            fontRenderer.drawString(name, summaryLeft + 30, y + 7, 0xFFE1E5DF);
            String amount = RecipeTreeModel.formatAmount(entry.remaining) + "x";
            fontRenderer.drawString(amount,
                    panelRight - 18 - fontRenderer.getStringWidth(amount), y + 7, 0xFFF2F2F2);
            y += 22;
        }
    }

    private void drawByproductGrid(
            List<RecipeTreeModel.SummaryEntry> entries,
            int top,
            int mouseX,
            int mouseY) {
        int cell = 30;
        int columns = byproductColumns();
        int firstRow = summaryScrollRows[SummaryTab.BYPRODUCTS.ordinal()];
        for (int index = firstRow * columns; index < entries.size(); index++) {
            int column = index % columns;
            int row = index / columns;
            int left = summaryLeft + 7 + column * cell;
            int y = top + (row - firstRow) * cell;
            if (y + cell > treeBottom) break;
            RecipeTreeModel.SummaryEntry entry = entries.get(index);
            Gui.drawRect(left, y, left + cell - 3, y + cell - 3, 0x66324635);
            safeRenderIngredient(entry.ingredient, left + 5, y + 4, "byproduct-grid");
            String amount = RecipeTreeModel.formatAmount(entry.remaining);
            fontRenderer.drawStringWithShadow(amount,
                    left + cell - 5 - fontRenderer.getStringWidth(amount), y + 17,
                    0xFFFFFFFF);
        }
    }

    private void drawNodeTooltip(int mouseX, int mouseY) {
        if (hoveredNode == null) return;
        if (hoveredNode.getRecipe() != null
                && hoveredNode.getRecipe().isEmcTransmutation()) return;
        List<String> tooltip = new ArrayList<String>(
                safeTooltip(hoveredNode.getIngredient(), "tree-node-tooltip"));
        drawHoveringText(tooltip, mouseX, mouseY);
    }

    @Override
    protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
        amountField.mouseClicked(mouseX, mouseY, mouseButton);
        super.mouseClicked(mouseX, mouseY, mouseButton);
        if (mc.currentScreen != this) return;
        if (overAnyButton(mouseX, mouseY) || amountField.isFocused()) return;

        if (mouseButton == 0 && reusableToggleHitbox != null
                && reusableToggleHitbox.contains(mouseX, mouseY)) {
            toggleReusableNode(reusableToggleHitbox.node);
            return;
        }
        if (mouseButton == 0 && byproductsToggleHitbox != null
                && byproductsToggleHitbox.contains(mouseX, mouseY)) {
            useByproducts = !useByproducts;
            status = useByproducts
                    ? "Byproducts reduce required materials"
                    : "Byproducts shown without reducing materials";
            return;
        }
        if (mouseButton == 1 && pointInsideViewport(mouseX, mouseY,
                treeLeft, treeTop, panelRight - 10, treeBottom)
                && openNativeIngredientAt(mouseX, mouseY)) return;
        for (RootRemoveHitbox remove : rootRemoveHitboxes) {
            if (pointInsideViewport(mouseX, mouseY,
                    treeLeft, treeTop, treeRight, treeBottom)
                    && remove.contains(mouseX, mouseY)) {
                model.removeRoot(remove.node);
                retainedRemoveButton = null;
                invalidateLayout();
                commitHistory(false);
                return;
            }
        }
        for (TabHitbox tab : tabHitboxes) {
            if (tab.contains(mouseX, mouseY)) {
                summaryTab = tab.tab;
                return;
            }
        }
        for (MachineHitbox machine : machineHitboxes) {
            if (mouseButton == 0 && machine.contains(mouseX, mouseY)) {
                mc.displayGuiScreen(screenForOpenedIngredient(machine.ingredient));
                return;
            }
        }
        for (ProcessHitbox process : processHitboxes) {
            if (!process.contains(mouseX, mouseY)) continue;
            if (mouseButton == 0) {
                selectedProcessKey = process.process.key.equals(selectedProcessKey)
                        ? null : process.process.key;
            }
            return;
        }
        for (NodeHitbox hitbox : nodeHitboxes) {
            if (!pointInsideViewport(mouseX, mouseY,
                    treeLeft, treeTop, treeRight, treeBottom)) break;
            if (!hitbox.contains(mouseX, mouseY)) continue;
            NodeClickAction action = nodeClickAction(
                    mouseButton,
                    resolveHasRecipes(hitbox.node.getIngredient()),
                    hitbox.node.getAlternatives().size() > 1);
            if (action == NodeClickAction.SELECT_RECIPE) {
                mc.displayGuiScreen(new RecipePickerScreen(
                        this, hitbox.node, IFocus.Mode.OUTPUT, false));
            } else if (action == NodeClickAction.VIEW_USES) {
                mc.displayGuiScreen(new RecipePickerScreen(
                        this, hitbox.node, IFocus.Mode.INPUT, false));
            } else if (action == NodeClickAction.SELECT_ALTERNATIVE) {
                mc.displayGuiScreen(new AlternativePickerScreen(this, hitbox.node));
            }
            return;
        }
        if (mouseButton == 0 && contains(treeLeft, treeTop,
                treeRight - treeLeft, treeBottom - treeTop, mouseX, mouseY)) {
            panning = true;
            lastDragX = mouseX;
            lastDragY = mouseY;
        }
    }

    @Override
    protected void mouseClickMove(
            int mouseX,
            int mouseY,
            int clickedMouseButton,
            long timeSinceLastClick) {
        if (!panning || clickedMouseButton != 0) return;
        panX += mouseX - lastDragX;
        panY += mouseY - lastDragY;
        lastDragX = mouseX;
        lastDragY = mouseY;
    }

    @Override
    protected void mouseReleased(int mouseX, int mouseY, int state) {
        panning = false;
        super.mouseReleased(mouseX, mouseY, state);
    }

    @Override
    public void handleMouseInput() throws IOException {
        super.handleMouseInput();
        int wheel = Mouse.getEventDWheel();
        if (wheel == 0) return;
        int mouseX = Mouse.getEventX() * width / mc.displayWidth;
        int mouseY = height - Mouse.getEventY() * height / mc.displayHeight - 1;
        if (contains(summaryLeft, treeTop, panelRight - 10 - summaryLeft,
                treeBottom - treeTop, mouseX, mouseY)) {
            int tabIndex = summaryTab.ordinal();
            summaryScrollRows[tabIndex] = scrollSummaryRows(
                    summaryScrollRows[tabIndex], wheel, summaryMaximumScroll);
            return;
        }
        if (amountField != null && contains(
                amountField.x, amountField.y, amountField.width, amountField.height,
                mouseX, mouseY)) {
            adjustAmountFromWheel(wheel);
            return;
        }
        for (NodeHitbox hitbox : nodeHitboxes) {
            if (hitbox.contains(mouseX, mouseY) && hitbox.node.getAlternatives().size() > 1) {
                if (model.cycleAlternative(hitbox.node, wheel < 0 ? 1 : -1)) {
                    invalidateLayout();
                    commitHistory(false);
                }
                return;
            }
        }
        if (!contains(treeLeft, treeTop, treeRight - treeLeft, treeBottom - treeTop,
                mouseX, mouseY)) return;
        float oldZoom = treeZoom;
        treeZoom = clamp(treeZoom * (wheel > 0 ? 1.12F : 0.89F), MIN_ZOOM, MAX_ZOOM);
        double centerX = treeLeft + (treeRight - treeLeft) / 2.0;
        double centerY = treeTop + (treeBottom - treeTop) / 2.0;
        panX = (panX + centerX - mouseX) * treeZoom / oldZoom - (centerX - mouseX);
        panY = (panY + centerY - mouseY) * treeZoom / oldZoom - (centerY - mouseY);
    }

    @Override
    protected void keyTyped(char typedChar, int keyCode) throws IOException {
        if (openInventoryIfPressed(keyCode)) return;
        if (amountField.textboxKeyTyped(typedChar, keyCode)) {
            applyAmountField();
            return;
        }
        if (keyCode == Keyboard.KEY_R && hoveredNode != null
                && hoveredNode.getParent() != null) {
            toggleReusableNode(hoveredNode);
            return;
        }
        super.keyTyped(typedChar, keyCode);
    }

    private boolean openInventoryIfPressed(int keyCode) {
        Minecraft client = Minecraft.getMinecraft();
        if (client == null || client.gameSettings == null
                || !matchesConfiguredInventoryKey(
                        keyCode, client.gameSettings.keyBindInventory.getKeyCode())) {
            return false;
        }
        if (client.player == null) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Inventory key was pressed in Recipe Tree, but no client player was available");
            return true;
        }
        client.getTutorial().openInventory();
        client.displayGuiScreen(new GuiInventory(client.player));
        return true;
    }

    static boolean matchesConfiguredInventoryKey(int eventKeyCode, int configuredKeyCode) {
        return eventKeyCode != Keyboard.KEY_NONE && eventKeyCode == configuredKeyCode;
    }

    private void toggleReusableNode(RecipeTreeModel.Node node) {
        boolean reusable = model.toggleReusableInput(node);
        status = reusable ? "Input marked reusable" : "Input counted as consumed";
        invalidateLayout();
        commitHistory(false);
    }

    @Override
    public void updateScreen() {
        if (amountField != null) amountField.updateCursorCounter();
    }

    @Override
    public void onGuiClosed() {
        Keyboard.enableRepeatEvents(false);
        bridge.clearNativeLayouts();
    }

    @Override
    public boolean doesGuiPauseGame() {
        return false;
    }

    private void applyAmountField() {
        String text = amountField.getText();
        if (text.isEmpty()) return;
        try {
            long amount = Math.max(1L, Math.min(RecipeQuantityMath.MAX_REQUESTED_AMOUNT,
                    Long.parseLong(text)));
            model.setPrimaryAmount(amount);
            invalidateLayout();
            commitHistory(false);
        } catch (NumberFormatException error) {
            JeiExportMod.LOGGER.warn("[jeiexport] Ignoring invalid recipe-tree amount {}", text,
                    error);
        }
    }

    private void adjustAmountFromWheel(int wheel) {
        long current = primaryAmount();
        long adjusted = RecipeQuantityMath.adjustRequestedAmount(current, wheel);
        amountField.setText(Long.toString(adjusted));
        if (adjusted == current) return;
        model.setPrimaryAmount(adjusted);
        invalidateLayout();
        commitHistory(false);
    }

    private void ensureLayout() {
        if (!layoutDirty && layout != null) return;
        final Map<RecipeTreeModel.Node, List<RecipeTreeModel.Node>> boundedChildren =
                boundedLayoutChildren();
        final RecipeTreeLayout.Adapter<RecipeTreeModel.Node> adapter =
                new RecipeTreeLayout.Adapter<RecipeTreeModel.Node>() {
                    @Override
                    public RecipeTreeLayout.Size size(RecipeTreeModel.Node node) {
                        if (!compactMode && node.getRecipe() != null) {
                            return detailedRecipeNodeSize(
                                    node.getRecipe().getWidth(),
                                    node.getRecipe().getHeight());
                        }
                        return new RecipeTreeLayout.Size(40, 34);
                    }

                    @Override
                    public List<RecipeTreeModel.Node> children(RecipeTreeModel.Node node) {
                        List<RecipeTreeModel.Node> children = boundedChildren.get(node);
                        return children == null
                                ? Collections.<RecipeTreeModel.Node>emptyList() : children;
                    }
                };
        try {
            layout = RecipeTreeLayout.layout(
                    model.getRoots(), adapter, TREE_NODE_GAP, TREE_LEVEL_GAP, TREE_ROOT_GAP,
                    new RecipeTreeLayout.Limits(
                            RecipeTreeModel.MAX_DEPTH,
                            RecipeTreeModel.MAX_CHILDREN,
                            MAX_LAYOUT_NODES));
        } catch (RuntimeException error) {
            logRenderFailure("tree-layout", error);
            status = "Tree layout failed; showing starting items only (see the log)";
            layout = RecipeTreeLayout.layout(
                    model.getRoots(),
                    new RecipeTreeLayout.Adapter<RecipeTreeModel.Node>() {
                        @Override
                        public RecipeTreeLayout.Size size(RecipeTreeModel.Node node) {
                            return new RecipeTreeLayout.Size(40, 34);
                        }

                        @Override
                        public List<RecipeTreeModel.Node> children(RecipeTreeModel.Node node) {
                            return Collections.emptyList();
                        }
                    },
                    TREE_NODE_GAP, TREE_LEVEL_GAP, TREE_ROOT_GAP,
                    new RecipeTreeLayout.Limits(1, RecipeTreeModel.MAX_ROOTS,
                            RecipeTreeModel.MAX_ROOTS));
        }
        layoutDirty = false;
    }

    private Map<RecipeTreeModel.Node, List<RecipeTreeModel.Node>> boundedLayoutChildren() {
        Map<RecipeTreeModel.Node, List<RecipeTreeModel.Node>> result =
                new IdentityHashMap<RecipeTreeModel.Node, List<RecipeTreeModel.Node>>();
        Set<RecipeTreeModel.Node> seen =
                Collections.newSetFromMap(
                        new IdentityHashMap<RecipeTreeModel.Node, Boolean>());
        int[] count = {0};
        boolean[] truncated = {false};
        for (RecipeTreeModel.Node root : model.getRoots()) {
            collectBoundedLayoutChildren(root, result, seen, count, truncated);
        }
        if (truncated[0]) {
            String key = "tree-layout-node-cap";
            if (loggedRenderFailures.add(key)) {
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Recipe Tree display reached its {}-node safety cap; "
                                + "the visible graph is truncated but model totals remain intact",
                        MAX_LAYOUT_NODES);
            }
            status = "Visible tree limited to " + MAX_LAYOUT_NODES
                    + " nodes; totals still use the full model";
        }
        return result;
    }

    private void collectBoundedLayoutChildren(
            RecipeTreeModel.Node node,
            Map<RecipeTreeModel.Node, List<RecipeTreeModel.Node>> destination,
            Set<RecipeTreeModel.Node> seen,
            int[] count,
            boolean[] truncated) {
        if (!seen.add(node)) return;
        if (count[0] >= MAX_LAYOUT_NODES) {
            truncated[0] = true;
            return;
        }
        count[0]++;
        List<RecipeTreeModel.Node> visible = new ArrayList<RecipeTreeModel.Node>();
        destination.put(node, visible);
        if (recipeBookMode && node.getParent() != null
                && progress.hasDiscovered(node.getIngredient().getKey())) return;
        for (RecipeTreeModel.Node child : node.getChildren()) {
            if (!shouldDisplayOperationalInput(
                    RecipeTreeModel.isOperationalOnly(child),
                    child.isManualReusableInput())) continue;
            if (count[0] >= MAX_LAYOUT_NODES) {
                truncated[0] = true;
                break;
            }
            visible.add(child);
            collectBoundedLayoutChildren(child, destination, seen, count, truncated);
        }
    }

    static boolean shouldDisplayOperationalInput(
            boolean operationalOnly,
            boolean manuallyReusable) {
        return !operationalOnly || manuallyReusable;
    }

    private void invalidateLayout() {
        layoutDirty = true;
        layout = null;
    }

    private ScreenRect screenRect(RecipeTreeLayout.PlacedNode<RecipeTreeModel.Node> placed) {
        int originX = treeOriginX();
        int originY = treeOriginY();
        return new ScreenRect(
                originX + Math.round(placed.left * treeZoom),
                originY + Math.round(placed.top * treeZoom),
                Math.max(1, Math.round(placed.width * treeZoom)),
                Math.max(1, Math.round(placed.height * treeZoom)));
    }

    private int treeOriginX() {
        int viewportWidth = treeRight - treeLeft;
        return treeLeft + Math.round((viewportWidth - layout.width * treeZoom) / 2F
                + (float) panX);
    }

    private int treeOriginY() {
        // Reserve enough space for a root's non-overlapping remove control.
        return treeTop + 22 + Math.round((float) panY);
    }

    private void centerTree() {
        ensureLayout();
        int availableWidth = Math.max(1, treeRight - treeLeft - 16);
        int availableHeight = Math.max(1, treeBottom - treeTop - 16);
        float fit = Math.min(1F, Math.min(availableWidth / (float) Math.max(1, layout.width),
                availableHeight / (float) Math.max(
                        1, layout.height + NODE_COUNT_LABEL_HEIGHT)));
        treeZoom = clamp(fit, MIN_ZOOM, 1F);
        panX = 0;
        panY = 0;
        centered = true;
    }

    private void commitHistory(boolean snapshot) {
        RecipeTreeProgress.RecipeHistoryEntry entry = model.historyEntry(compactMode, snapshot);
        boolean preserve = historyIndex >= 0 && historyIndex < history.size()
                && history.get(historyIndex).isSnapshot();
        historyIndex = RecipeHistoryEdits.commit(history, historyIndex, entry,
                preserve && !snapshot);
        while (history.size() > RecipeTreeProgress.MAX_HISTORY) {
            history.remove(0);
            historyIndex--;
        }
        if (historyIndex < 0 && !history.isEmpty()) historyIndex = 0;
        progress.replaceRecipeHistory(history, entry);
        updateButtonLabels();
    }

    private void navigateHistory(int direction) {
        int next = historyIndex + direction;
        if (next < 0 || next >= history.size()) return;
        openHistoryEntry(next);
    }

    private void deleteHistoryEntry(int index) {
        if (index < 0 || index >= history.size()) return;
        historyIndex = RecipeHistoryEdits.delete(history, historyIndex, index);
        RecipeTreeProgress.RecipeHistoryEntry lastViewed = historyIndex >= 0
                && historyIndex < history.size()
                ? history.get(historyIndex)
                : history.isEmpty() ? null : history.get(history.size() - 1);
        progress.replaceRecipeHistory(history, lastViewed);
        updateButtonLabels();
        status = "Deleted history item";
    }

    private void openHistoryEntry(int index) {
        RecipeTreeProgress.RecipeHistoryEntry entry = history.get(index);
        RecipeTreeModel restored = RecipeTreeModel.restore(bridge, progress, entry);
        if (restored == null) {
            status = "That history tree is unavailable in this pack";
            return;
        }
        RecipeTreeScreen replacement = new RecipeTreeScreen(
                bridge, restored, entry.isCompactMode(), history, index);
        progress.replaceRecipeHistory(history, entry);
        mc.displayGuiScreen(replacement);
    }

    private Path shareDirectory() {
        return Loader.instance().getConfigDir().toPath().resolve("recipe-tree-shares");
    }

    private String currentPortableShareJson() {
        return portableShareJson(model.primaryHistoryEntry(compactMode, true), new Date());
    }

    private void shareCurrentTree(GuiScreen returnScreen) {
        Path directory = shareDirectory();
        String timestamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
        RecipeTreeProgress.RecipeHistoryEntry exported =
                model.primaryHistoryEntry(compactMode, true);
        String rootName = exported.getRoots().isEmpty()
                ? exported.getItemIdentity()
                : exported.getRoots().get(0).getIngredientName();
        Path destination = directory.resolve(
                safeShareFileStem(rootName) + "-" + timestamp + ".mrtree.json");
        try {
            String json = portableShareJson(exported, new Date());
            Files.createDirectories(directory);
            try (Writer writer = Files.newBufferedWriter(destination, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                writer.write(json);
            }
            setClipboardString(json);
            mc.displayGuiScreen(new ShareInstructionsScreen(returnScreen, destination, json));
        } catch (IOException error) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Could not create the requested recipe-tree history share file {}",
                    destination, error);
            status = "Could not create share file; see the log";
        }
    }

    static String safeShareFileStem(String value) {
        String normalized = value == null ? "recipe-tree" : value.toLowerCase(Locale.ROOT);
        StringBuilder result = new StringBuilder();
        boolean separator = false;
        for (int index = 0; index < normalized.length() && result.length() < 48; index++) {
            char character = normalized.charAt(index);
            if ((character >= 'a' && character <= 'z')
                    || (character >= '0' && character <= '9')) {
                result.append(character);
                separator = false;
            } else if (!separator && result.length() > 0) {
                result.append('-');
                separator = true;
            }
        }
        while (result.length() > 0 && result.charAt(result.length() - 1) == '-') {
            result.deleteCharAt(result.length() - 1);
        }
        return result.length() == 0 ? "recipe-tree" : result.toString();
    }

    static int shareDialogActionWidth(int dialogWidth) {
        int available = dialogWidth - SHARE_DIALOG_HORIZONTAL_PADDING
                - SHARE_DIALOG_DONE_WIDTH - SHARE_DIALOG_BUTTON_GAP * 2;
        return Math.min(MAX_NATIVE_BUTTON_WIDTH, Math.max(104, available / 2));
    }

    static String portableShareJson(
            RecipeTreeProgress.RecipeHistoryEntry entry,
            Date createdAt) {
        if (entry == null || entry.getItemIdentity() == null) {
            throw new IllegalArgumentException("A main starting node is required to share a tree");
        }
        List<PortableShareSelection> selections = new ArrayList<PortableShareSelection>();
        for (RecipeTreeProgress.RecipeHistorySelection selection : entry.getSelections()) {
            if (selection.getRootIndex() != 0 || selection.getRecipeIdentity() == null
                    || selection.getRecipeIdentity().isEmpty()) continue;
            selections.add(new PortableShareSelection(
                    selection.getPath(),
                    selection.getIngredientIdentity(),
                    new PortableShareSource("recipe", selection.getRecipeIdentity())));
        }
        PortableShareEnvelope envelope = new PortableShareEnvelope(
                "minecraft-recipe-tree",
                1,
                new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.ROOT)
                        .format(createdAt == null ? new Date() : createdAt),
                new PortableSharePack("1.12.2"),
                entry.getItemIdentity(),
                "inputs",
                new PortableShareProductionPlan(entry.getAmount(), 1),
                selections);
        return SHARE_GSON.toJson(envelope);
    }

    private void openShareFolder(Path file) {
        Path folder = file == null ? null : file.toAbsolutePath().getParent();
        openFolder(folder);
    }

    private void openFolder(Path folder) {
        if (folder == null) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Cannot open the recipe-tree share folder because its path is null");
            status = "Could not locate the share folder; see the log";
            return;
        }
        if (!Desktop.isDesktopSupported()
                || !Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] This desktop does not support opening the recipe-tree share "
                            + "folder {} from Minecraft",
                    folder);
            status = "This desktop cannot open folders from Minecraft";
            return;
        }
        try {
            Desktop.getDesktop().open(folder.toFile());
        } catch (IOException | RuntimeException error) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Could not open the recipe-tree share folder {}",
                    folder, error);
            status = "Could not open the share folder; see the log";
        }
    }

    private void openShareDirectory() {
        Path directory = shareDirectory();
        try {
            Files.createDirectories(directory);
            openFolder(directory);
        } catch (IOException error) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Could not prepare the recipe-tree import/export folder {}",
                    directory, error);
            status = "Could not prepare the import/export folder; see the log";
        }
    }

    private void openImportedTree(
            RecipeTreeProgress.RecipeHistoryEntry entry,
            String source) {
        RecipeTreeModel restored = RecipeTreeModel.restore(bridge, progress, entry);
        if (restored == null) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Imported recipe tree from {} could not be restored in the "
                            + "current JEI/HEI runtime",
                    source);
            status = "Imported tree is unavailable in this pack; see the log";
            return;
        }
        history.add(entry);
        while (history.size() > RecipeTreeProgress.MAX_HISTORY) history.remove(0);
        historyIndex = history.size() - 1;
        progress.replaceRecipeHistory(history, entry);
        RecipeTreeScreen replacement = new RecipeTreeScreen(
                bridge, restored, entry.isCompactMode(), history, historyIndex);
        replacement.status = "Imported tree from " + source;
        mc.displayGuiScreen(replacement);
    }

    private long primaryAmount() {
        RecipeTreeModel.Node root = model.getPrimaryRoot();
        if (root == null) return 1L;
        try {
            return Math.max(1L, root.getDemand().longValueExact());
        } catch (ArithmeticException ignored) {
            return Math.max(1L, root.getDemand().longValue());
        }
    }

    private void openJei(RecipeTreeViewerBridge.Ingredient ingredient, IFocus.Mode mode) {
        IJeiRuntime runtime = JeiExportPlugin.getRuntime();
        if (runtime == null) {
            status = "JEI/HEI is still loading";
            JeiExportMod.LOGGER.warn(
                    "[jeiexport] Could not open JEI/HEI because its runtime is unavailable");
            return;
        }
        try {
            IRecipeRegistry registry = runtime.getRecipeRegistry();
            runtime.getRecipesGui().show(registry.createFocus(mode, ingredient.getValue()));
        } catch (RuntimeException error) {
            logRenderFailure("open-jei:" + ingredient.getKey(), error);
            status = "JEI/HEI could not open that ingredient; see the log";
        }
    }

    private boolean hasRecipes(RecipeTreeViewerBridge.Ingredient ingredient) {
        Boolean cached = noRecipeCache.get(ingredient.getKey());
        if (cached == null) {
            if (availabilityChecksRemaining <= 0) {
                // Availability is resolved incrementally across frames. Treat an unresolved node
                // as actionable until checked so it does not briefly look like a terminal item.
                return true;
            }
            availabilityChecksRemaining--;
            return resolveHasRecipes(ingredient);
        }
        return cached;
    }

    private boolean resolveHasRecipes(RecipeTreeViewerBridge.Ingredient ingredient) {
        Boolean cached = noRecipeCache.get(ingredient.getKey());
        if (cached == null) {
            try {
                cached = bridge.hasRecipes(ingredient, IFocus.Mode.OUTPUT);
                noRecipeCache.put(ingredient.getKey(), cached);
            } catch (RuntimeException error) {
                logRenderFailure("recipe-query:" + ingredient.getKey(), error);
                status = "Recipe query failed for " + ingredient.getDisplayName()
                        + "; see the log";
                return false;
            }
        }
        return cached;
    }

    private int nodeBackground(RecipeTreeModel.Node node, boolean hovered) {
        int color;
        if (node.isManualReusableInput()) color = 0xFF4B4630;
        else if (node.getRecipe() == null && !hasRecipes(node.getIngredient())) color = 0xFF3D4143;
        else if (node.getAlternatives().size() > 1) color = 0xFF264653;
        else if (progress.hasDiscovered(node.getIngredient().getKey())) color = 0xFF24533A;
        else color = 0xFF27372C;
        return hovered ? lighten(color, 28) : color;
    }

    private int processColor(RecipeTreeModel.Node node) {
        return node.getRecipe() == null ? 0xFF718171
                : processColor(node.getRecipe().getCategoryUid());
    }

    private static int processColor(String key) {
        int[] colors = {0xFF66C2A5, 0xFFFC8D62, 0xFF8DA0CB, 0xFFE78AC3,
                0xFFA6D854, 0xFFFFD92F, 0xFFE5C494, 0xFF80B1D3};
        return colors[Math.floorMod(key == null ? 0 : key.hashCode(), colors.length)];
    }

    private void drawNativeRecipe(
            RecipeTreeViewerBridge.Recipe recipe,
            int left,
            int top,
            float scale,
            int localMouseX,
            int localMouseY) {
        Minecraft client = ensureLiveRenderContext("recipe:" + recipe.getKey());
        if (client == null) return;
        if (recipe.isEmcTransmutation()) {
            drawEmcTransmutationRecipe(recipe, left, top, scale);
            return;
        }
        if (recipe.isSelectedAspectSource()) {
            drawSelectedAspectSourceRecipe(recipe, left, top, scale);
            return;
        }
        if (nativeRecipeDrawFailures.contains(recipe.getKey())) {
            drawSemanticRecipeFallback(recipe, left, top, scale);
            return;
        }
        IRecipeLayoutDrawable drawable = bridge.nativeLayout(recipe);
        if (drawable == null) {
            logSemanticFallback(recipe, "JEI/HEI returned no native layout");
            drawSemanticRecipeFallback(recipe, left, top, scale);
            return;
        }
        boolean rendered = false;
        ScissorState scissorState = ScissorState.capture();
        JerMobRenderCompat.ScopeToken jerScope =
                JerMobRenderCompat.begin(recipe.getCategoryUid(), left, top, scale);
        RecipeTreeViewerBridge.NativeRenderScope nativeRenderScope = null;
        ModularMachineryPreviewScope structurePreviewScope = null;
        GlStateManager.pushMatrix();
        try {
            nativeRenderScope = bridge.beginNativeRender(recipe, client);
            structurePreviewScope = bridge.beginStructurePreview(recipe, client, left, top, scale);
            GlStateManager.translate(left, top, 0);
            GlStateManager.scale(scale, scale, 1F);
            drawable.setPosition(0, 0);
            // JEI 4's draw() also invokes drawOverlays(). Rendering only the recipe prevents
            // tooltips from being scaled, clipped, and layered underneath later planner widgets.
            drawable.drawRecipe(client, localMouseX, localMouseY);
            rendered = true;
        } catch (RuntimeException error) {
            logRenderFailure("recipe:" + recipe.getKey(), error);
            nativeRecipeDrawFailures.add(recipe.getKey());
        } finally {
            if (structurePreviewScope != null) structurePreviewScope.close();
            if (nativeRenderScope != null) {
                nativeRenderScope.close();
            }
            jerScope.close();
            GlStateManager.popMatrix();
            restoreGuiRenderState();
            scissorState.restore();
        }
        if (!rendered) {
            logSemanticFallback(recipe, "native recipe drawing failed");
            drawSemanticRecipeFallback(recipe, left, top, scale);
            return;
        }
        nativeRecipeRegions.add(new NativeRecipeRegion(
                recipe, drawable, left, top, scale,
                Math.max(1, Math.round(recipe.getWidth() * scale)),
                Math.max(1, Math.round(recipe.getHeight() * scale))));
    }

    private void drawSelectedAspectSourceRecipe(
            RecipeTreeViewerBridge.Recipe recipe,
            int left,
            int top,
            float scale) {
        RecipeTreeViewerBridge.Ingredient input = firstIngredient(recipe.getInputs());
        RecipeTreeViewerBridge.Ingredient output = firstIngredient(recipe.getOutputs());
        if (input == null || output == null) {
            IllegalStateException failure = new IllegalStateException(
                    "selected ThaumicJEI aspect source is missing its input or output");
            logRenderFailure("thaumic-aspect-source:" + recipe.getKey(), failure);
            drawSemanticRecipeFallback(recipe, left, top, scale);
            return;
        }
        GlStateManager.pushMatrix();
        try {
            GlStateManager.translate(left, top, 0);
            GlStateManager.scale(scale, scale, 1F);
            Gui.drawRect(0, 0, recipe.getWidth(), recipe.getHeight(), 0xFFD2D2D2);
            Gui.drawRect(5, 5, 25, 25, 0xFF777777);
            Gui.drawRect(6, 6, 24, 24, 0xFFAAAAAA);
            Gui.drawRect(53, 5, 73, 25, 0xFF777777);
            Gui.drawRect(54, 6, 72, 24, 0xFFAAAAAA);
            safeRenderIngredient(input, 7, 7, "thaumic-aspect-source-input");
            safeRenderIngredient(output, 55, 7, "thaumic-aspect-source-output");
            fontRenderer.drawString(">", 36, 10, 0xFF777777);
            String amount = RecipeTreeModel.formatAmount(output.getAmount());
            fontRenderer.drawString(amount, 15 - fontRenderer.getStringWidth(amount) / 2,
                    27, 0xFF4A4A4A);
        } finally {
            GlStateManager.popMatrix();
            restoreGuiRenderState();
        }
        liveIngredientRegions.add(new LiveIngredientRegion(input,
                left + Math.round(7F * scale), top + Math.round(7F * scale),
                Math.max(1, Math.round(16F * scale)), Math.max(1, Math.round(16F * scale))));
        liveIngredientRegions.add(new LiveIngredientRegion(output,
                left + Math.round(55F * scale), top + Math.round(7F * scale),
                Math.max(1, Math.round(16F * scale)), Math.max(1, Math.round(16F * scale))));
    }

    private void drawEmcTransmutationRecipe(
            RecipeTreeViewerBridge.Recipe recipe,
            int left,
            int top,
            float scale) {
        Minecraft client = ensureLiveRenderContext("projecte-emc:" + recipe.getKey());
        if (client == null) return;
        boolean rendered = false;
        GlStateManager.pushMatrix();
        try {
            GlStateManager.translate(left, top, 0);
            GlStateManager.scale(scale, scale, 1F);
            GlStateManager.color(1F, 1F, 1F, 1F);
            client.getTextureManager().bindTexture(PROJECTE_TRANSMUTATION_TEXTURE);
            // ProjectE's full texture includes the second orbit, learned-item grid, fuel controls,
            // and inventory. Recipe Tree only needs the recognizable matter orbit itself.
            drawModalRectWithCustomSizedTexture(0, 0, 8F, 16F,
                    RecipeTreeViewerBridge.EMC_RECIPE_WIDTH,
                    RecipeTreeViewerBridge.EMC_RECIPE_HEIGHT,
                    256F, 256F);

            RecipeTreeViewerBridge.Ingredient emc = firstIngredient(recipe.getInputs());
            RecipeTreeViewerBridge.Ingredient output = firstIngredient(recipe.getOutputs());
            if (emc == null || output == null) {
                throw new IllegalStateException(
                        "ProjectE EMC recipe is missing its semantic input or output");
            }
            int itemLeft = emcOutputItemLeft();
            int itemTop = 24;
            safeRenderIngredient(output, itemLeft, itemTop, "projecte-emc-output");
            liveIngredientRegions.add(new LiveIngredientRegion(
                    output,
                    left + Math.round(itemLeft * scale),
                    top + Math.round(itemTop * scale),
                    Math.max(1, Math.round(16F * scale)),
                    Math.max(1, Math.round(16F * scale))));
            String emcAmount = RecipeTreeModel.formatAmount(emc.getAmount()) + " EMC";
            fontRenderer.drawStringWithShadow(emcAmount,
                    RecipeTreeViewerBridge.EMC_RECIPE_WIDTH / 2
                            - fontRenderer.getStringWidth(emcAmount) / 2,
                    47, 0xFF5A176B);
            rendered = true;
        } catch (RuntimeException error) {
            logRenderFailure("projecte-emc-recipe:" + recipe.getKey(), error);
        } finally {
            GlStateManager.popMatrix();
            restoreGuiRenderState();
        }
        if (!rendered) {
            logSemanticFallback(recipe, "ProjectE Transmutation Table drawing failed");
            drawSemanticRecipeFallback(recipe, left, top, scale);
        }
    }

    static int emcOutputItemLeft() {
        return RecipeTreeViewerBridge.EMC_RECIPE_WIDTH / 2 - 8;
    }

    private static RecipeTreeViewerBridge.Ingredient firstIngredient(
            List<RecipeTreeViewerBridge.Slot> slots) {
        return slots == null || slots.isEmpty() ? null : firstAlternative(slots.get(0));
    }

    private static boolean selectedAspectSourceMatches(
            RecipeTreeViewerBridge.Recipe recipe,
            RecipeTreeViewerBridge.Ingredient source) {
        if (recipe == null || source == null || !recipe.isSelectedAspectSource()) return false;
        RecipeTreeViewerBridge.Ingredient selected = firstIngredient(recipe.getInputs());
        RecipeTreeViewerBridge.Ingredient output = firstIngredient(recipe.getOutputs());
        return selected != null && selected.getKey().equals(source.getKey())
                && output != null && output.getAmount().compareTo(source.getAmount()) == 0;
    }

    private static final int ASPECT_CORNER_SIZE = 16;

    private void drawAspectSourceCorner(int left, int top, int width, int height) {
        int right = left + width;
        int bottom = top + height;
        for (int row = 0; row < ASPECT_CORNER_SIZE; row++) {
            Gui.drawRect(right - row - 1, bottom - ASPECT_CORNER_SIZE + row,
                    right, bottom - ASPECT_CORNER_SIZE + row + 1, 0xFF14231F);
        }
        fontRenderer.drawString("+", right - 7, bottom - 9, 0xFFF2F7EF);
    }

    private void drawAspectSourceByproductTooltip(
            AspectSourceHitbox source, int mouseX, int mouseY,
            int screenWidth, int screenHeight) {
        int cellWidth = 24;
        List<RecipeTreeViewerBridge.Ingredient> aspects =
                source.page.getAspectSourceOutputs(source.ingredient);
        int rowWidth = aspects.size() * cellWidth + 8;
        float scale = Math.min(1F, (screenWidth - 8F) / rowWidth);
        int tooltipWidth = (int) Math.ceil(rowWidth * scale);
        int tooltipHeight = (int) Math.ceil(24 * scale);
        int x = mouseX + 12;
        if (x + tooltipWidth > screenWidth - 4) x = mouseX - tooltipWidth - 12;
        x = Math.max(4, Math.min(x, screenWidth - tooltipWidth - 4));
        int y = Math.max(4, Math.min(mouseY - 12, screenHeight - tooltipHeight - 4));
        GlStateManager.pushMatrix();
        try {
            GlStateManager.translate(x, y, 300F);
            GlStateManager.scale(scale, scale, 1F);
            GlStateManager.disableDepth();
            Gui.drawRect(0, 0, rowWidth, 24, 0xFF62547A);
            Gui.drawRect(1, 1, rowWidth - 1, 23, 0xF0100010);
            for (int index = 0; index < aspects.size(); index++) {
                RecipeTreeViewerBridge.Ingredient aspect = aspects.get(index);
                int center = 4 + index * cellWidth + cellWidth / 2;
                safeRenderIngredient(aspect, center - 8, 4,
                        "thaumic-aspect-grid-byproduct");
                GlStateManager.disableDepth();
            }
        } finally {
            GlStateManager.popMatrix();
            restoreGuiRenderState();
        }
    }

    static boolean pickerRecipeMatchesSearch(
            RecipeTreeViewerBridge.Recipe recipe,
            String normalizedQuery) {
        if (recipe == null || normalizedQuery == null || normalizedQuery.isEmpty()) return true;
        if (searchMatches(recipe.getCategoryTitle(), normalizedQuery)
                || pickerIngredientMatchesSearch(
                        recipe.getCatalystMachine(), normalizedQuery)) {
            return true;
        }
        return slotsMatchSearch(recipe.getInputs(), normalizedQuery)
                || slotsMatchSearch(recipe.getOutputs(), normalizedQuery);
    }

    static boolean pickerIngredientMatchesSearch(
            RecipeTreeViewerBridge.Ingredient ingredient,
            String normalizedQuery) {
        if (ingredient == null) return false;
        if (normalizedQuery == null || normalizedQuery.isEmpty()) return true;
        return searchMatches(ingredient.getDisplayName(), normalizedQuery)
                || searchMatches(ingredient.getKey(), normalizedQuery);
    }

    private static boolean slotsMatchSearch(
            List<RecipeTreeViewerBridge.Slot> slots,
            String normalizedQuery) {
        if (slots == null) return false;
        for (RecipeTreeViewerBridge.Slot slot : slots) {
            if (slot == null) continue;
            for (RecipeTreeViewerBridge.Ingredient alternative : slot.getAlternatives()) {
                if (pickerIngredientMatchesSearch(alternative, normalizedQuery)) return true;
            }
        }
        return false;
    }

    private static boolean searchMatches(String value, String normalizedQuery) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(normalizedQuery);
    }

    private void drawSemanticRecipeFallback(
            RecipeTreeViewerBridge.Recipe recipe,
            int left,
            int top,
            float scale) {
        int nativeWidth = Math.max(1, recipe.getWidth());
        int nativeHeight = Math.max(1, recipe.getHeight());
        GlStateManager.pushMatrix();
        try {
            GlStateManager.translate(left, top, 0);
            GlStateManager.scale(scale, scale, 1F);
            Gui.drawRect(0, 0, nativeWidth, nativeHeight, 0xFFD2D2D2);

            List<RecipeTreeViewerBridge.Slot> inputs = recipe.getInputs();
            int inputCount = Math.min(9, inputs.size());
            int gridTop = Math.max(3, (nativeHeight - 54) / 2);
            for (int index = 0; index < inputCount; index++) {
                RecipeTreeViewerBridge.Ingredient ingredient = firstAlternative(inputs.get(index));
                if (ingredient == null) continue;
                int x = 3 + (index % 3) * 18;
                int y = gridTop + (index / 3) * 18;
                safeRenderIngredient(ingredient, x, y, "semantic-recipe-input");
                drawSemanticAmount(ingredient, x, y);
            }

            int arrowX = Math.max(58, nativeWidth - 43);
            fontRenderer.drawString(">", arrowX, Math.max(4, nativeHeight / 2 - 4),
                    0xFF777777);
            int outputX = Math.max(3, nativeWidth - 20);
            int outputY = Math.max(3, nativeHeight / 2 - 8);
            int outputIndex = 0;
            for (RecipeTreeViewerBridge.Slot slot : recipe.getOutputs()) {
                RecipeTreeViewerBridge.Ingredient ingredient = firstAlternative(slot);
                if (ingredient == null) continue;
                int y = Math.min(nativeHeight - 17, outputY + outputIndex * 18);
                safeRenderIngredient(ingredient, outputX, y, "semantic-recipe-output");
                drawSemanticAmount(ingredient, outputX, y);
                if (++outputIndex >= 3) break;
            }
            if (inputs.size() > inputCount) {
                fontRenderer.drawString("+" + (inputs.size() - inputCount), 3,
                        Math.max(2, nativeHeight - 9), 0xFF555555);
            }
        } finally {
            GlStateManager.popMatrix();
            restoreGuiRenderState();
        }
    }

    private void drawSemanticAmount(
            RecipeTreeViewerBridge.Ingredient ingredient,
            int x,
            int y) {
        if (ingredient.getAmount().compareTo(BigDecimal.ONE) == 0) return;
        String amount = RecipeTreeModel.formatAmount(ingredient.getAmount());
        fontRenderer.drawStringWithShadow(amount,
                x + 17 - fontRenderer.getStringWidth(amount), y + 9, 0xFFFFFFFF);
    }

    private static RecipeTreeViewerBridge.Ingredient firstAlternative(
            RecipeTreeViewerBridge.Slot slot) {
        return slot == null || slot.getAlternatives().isEmpty()
                ? null : slot.getAlternatives().get(0);
    }

    private void logSemanticFallback(RecipeTreeViewerBridge.Recipe recipe, String reason) {
        String key = "semantic-fallback:" + recipe.getKey();
        if (loggedRenderFailures.add(key)) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Recipe Tree is using its semantic recipe-card fallback for {} "
                            + "in {} because {}; ingredients remain visible",
                    recipe.getKey(), recipe.getCategoryUid(), reason);
        }
    }

    private void restoreGuiRenderState() {
        GlStateManager.color(1F, 1F, 1F, 1F);
        GlStateManager.disableLighting();
        GlStateManager.enableAlpha();
        GlStateManager.disableBlend();
        GlStateManager.enableDepth();
        GlStateManager.enableTexture2D();
    }

    private void logRenderFailure(String key, RuntimeException error) {
        if (loggedRenderFailures.add(key)) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Recipe Tree runtime operation failed for {}; the screen will "
                            + "use its explicit safe fallback where available",
                    key, error);
        }
    }

    private void safeRenderIngredient(
            RecipeTreeViewerBridge.Ingredient ingredient,
            int x,
            int y,
            String context) {
        if (ingredient == null) return;
        Minecraft client = ensureLiveRenderContext("ingredient:" + context);
        if (client == null) return;
        try {
            bridge.renderIngredient(ingredient, client, x, y);
        } catch (RuntimeException error) {
            logRenderFailure("ingredient:" + context + ":" + ingredient.getKey(), error);
            Gui.drawRect(x + 2, y + 2, x + 14, y + 14, 0xFF5B2626);
            fontRenderer.drawStringWithShadow("!", x + 5, y + 4, 0xFFFFFFFF);
            restoreGuiRenderState();
        }
    }

    private List<String> safeTooltip(
            RecipeTreeViewerBridge.Ingredient ingredient,
            String context) {
        Minecraft client = ensureLiveRenderContext("tooltip:" + context);
        if (client == null) {
            List<String> fallback = new ArrayList<String>();
            fallback.add(ingredient.getDisplayName());
            fallback.add("Tooltip unavailable; see the log");
            return fallback;
        }
        try {
            return bridge.getTooltip(ingredient, client);
        } catch (RuntimeException error) {
            logRenderFailure("tooltip:" + context + ":" + ingredient.getKey(), error);
            List<String> fallback = new ArrayList<String>();
            fallback.add(ingredient.getDisplayName());
            fallback.add("Tooltip unavailable; see the log");
            return fallback;
        }
    }

    private Minecraft ensureLiveRenderContext(String context) {
        Minecraft client = preferLiveRenderContext(Minecraft.getMinecraft(), mc);
        if (client != null) {
            mc = client;
            fontRenderer = preferLiveRenderContext(client.fontRenderer, fontRenderer);
        }
        if (client == null || fontRenderer == null) {
            logRenderFailure("render-context:" + context, new IllegalStateException(
                    "The active Minecraft render context is unavailable"));
            return null;
        }
        return client;
    }

    static <T> T preferLiveRenderContext(T liveContext, T screenContext) {
        return liveContext != null ? liveContext : screenContext;
    }

    private RecipeTreeViewerBridge.Ingredient nativeIngredientAt(int mouseX, int mouseY) {
        NativeIngredientHit hit = nativeIngredientHitAt(mouseX, mouseY);
        return hit == null ? null : hit.ingredient;
    }

    private NativeIngredientHit nativeIngredientHitAt(int mouseX, int mouseY) {
        for (int index = liveIngredientRegions.size() - 1; index >= 0; index--) {
            LiveIngredientRegion region = liveIngredientRegions.get(index);
            if (region.contains(mouseX, mouseY)) {
                return new NativeIngredientHit(region.ingredient);
            }
        }
        for (int index = nativeRecipeRegions.size() - 1; index >= 0; index--) {
            NativeRecipeRegion region = nativeRecipeRegions.get(index);
            if (!region.contains(mouseX, mouseY)) continue;
            try {
                region.layout.setPosition(0, 0);
                int localX = (int) ((mouseX - region.left) / region.scale);
                int localY = (int) ((mouseY - region.top) / region.scale);
                Object raw = region.layout.getIngredientUnderMouse(localX, localY);
                if (raw != null) {
                    RecipeTreeViewerBridge.Ingredient ingredient = bridge.ingredient(raw);
                    if (ingredient != null) return new NativeIngredientHit(ingredient);
                }
            } catch (RuntimeException error) {
                logRenderFailure("native-hit:" + region.recipe.getKey(), error);
                return null;
            }
        }
        return null;
    }

    private boolean openNativeIngredientAt(int mouseX, int mouseY) {
        RecipeTreeViewerBridge.Ingredient ingredient = nativeIngredientAt(mouseX, mouseY);
        if (ingredient == null) return false;
        mc.displayGuiScreen(screenForOpenedIngredient(ingredient));
        return true;
    }

    private boolean drawNativeIngredientTooltip(int mouseX, int mouseY) {
        NativeIngredientHit hit = nativeIngredientHitAt(mouseX, mouseY);
        if (hit == null) return false;
        List<String> tooltip = new ArrayList<String>(
                safeTooltip(hit.ingredient, "native-recipe-ingredient"));
        tooltip.add("Right click: open in Recipe Tree");
        drawHoveringText(tooltip, mouseX, mouseY);
        return true;
    }

    private boolean overAnyButton(int mouseX, int mouseY) {
        for (GuiButton button : buttonList) {
            if (button.visible && mouseX >= button.x && mouseX < button.x + button.width
                    && mouseY >= button.y && mouseY < button.y + button.height) return true;
        }
        return false;
    }

    private static int recipeCount(List<RecipeTreeViewerBridge.RecipeGroup> groups) {
        int count = 0;
        for (RecipeTreeViewerBridge.RecipeGroup group : groups) {
            for (RecipeTreeViewerBridge.Recipe recipe : group.getRecipes()) {
                count += recipe.isAspectSourcePage()
                        ? recipe.getSelectableAspectSources().size() : 1;
            }
        }
        return count;
    }

    private static boolean contains(
            int left, int top, int width, int height, int mouseX, int mouseY) {
        return mouseX >= left && mouseX < left + width && mouseY >= top && mouseY < top + height;
    }

    static boolean pointInsideViewport(
            int x, int y, int left, int top, int right, int bottom) {
        return x >= left && x < right && y >= top && y < bottom;
    }

    static boolean intersectsViewport(
            int left,
            int top,
            int width,
            int height,
            int viewportLeft,
            int viewportTop,
            int viewportRight,
            int viewportBottom) {
        return width > 0 && height > 0
                && left < viewportRight && left + width > viewportLeft
                && top < viewportBottom && top + height > viewportTop;
    }

    private int nodeCountLabelHeight() {
        float textScale = nodeVisualScale(treeZoom);
        return Math.max(1, nodeCountTop(0, textScale)
                + Math.round(fontRenderer.FONT_HEIGHT * textScale));
    }

    static int nodeCountTop(int cardBottom, float visualScale) {
        return cardBottom + Math.max(2, (int) Math.ceil(4F * visualScale));
    }

    static float nodeVisualScale(float zoom) {
        return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    }

    static boolean panOverviewRequired(
            int scaledTreeWidth,
            int scaledTreeHeight,
            int viewportWidth,
            int viewportHeight) {
        return scaledTreeWidth > viewportWidth || scaledTreeHeight > viewportHeight;
    }

    static PanOverviewGeometry panOverviewGeometry(
            int outerLeft,
            int outerTop,
            int outerWidth,
            int outerHeight,
            int treeWidth,
            int treeHeight,
            double viewportTreeLeft,
            double viewportTreeTop,
            double viewportTreeWidth,
            double viewportTreeHeight,
            int padding) {
        if (outerWidth <= padding * 2 || outerHeight <= padding * 2
                || treeWidth <= 0 || treeHeight <= 0
                || viewportTreeWidth <= 0 || viewportTreeHeight <= 0) {
            throw new IllegalArgumentException("Pan overview dimensions must be positive");
        }
        int availableWidth = outerWidth - padding * 2;
        int availableHeight = outerHeight - padding * 2;
        double scale = Math.min(
                availableWidth / (double) treeWidth,
                availableHeight / (double) treeHeight);
        int mapWidth = Math.max(1, (int) Math.round(treeWidth * scale));
        int mapHeight = Math.max(1, (int) Math.round(treeHeight * scale));
        int mapLeft = outerLeft + (outerWidth - mapWidth) / 2;
        int mapTop = outerTop + (outerHeight - mapHeight) / 2;
        int[] horizontal = overviewViewportAxis(
                mapLeft, mapWidth, treeWidth, viewportTreeLeft, viewportTreeWidth);
        int[] vertical = overviewViewportAxis(
                mapTop, mapHeight, treeHeight, viewportTreeTop, viewportTreeHeight);
        return new PanOverviewGeometry(
                outerLeft,
                outerTop,
                outerLeft + outerWidth,
                outerTop + outerHeight,
                mapLeft,
                mapTop,
                mapWidth,
                mapHeight,
                scale,
                horizontal[0],
                vertical[0],
                horizontal[1],
                vertical[1]);
    }

    private static int[] overviewViewportAxis(
            int mapStart,
            int mapLength,
            int treeLength,
            double viewportStart,
            double viewportLength) {
        double scale = mapLength / (double) treeLength;
        double rawStart = mapStart + viewportStart * scale;
        double rawEnd = mapStart + (viewportStart + viewportLength) * scale;
        int mapEnd = mapStart + mapLength;
        int start = clamp((int) Math.round(rawStart), mapStart, mapEnd);
        int end = clamp((int) Math.round(rawEnd), mapStart, mapEnd);
        int minimum = Math.min(2, mapLength);
        if (end - start < minimum) {
            if (rawEnd <= mapStart) {
                start = mapStart;
                end = mapStart + minimum;
            } else if (rawStart >= mapEnd) {
                end = mapEnd;
                start = mapEnd - minimum;
            } else {
                int center = clamp((int) Math.round((rawStart + rawEnd) / 2.0),
                        mapStart, mapEnd);
                start = clamp(center - minimum / 2, mapStart, mapEnd - minimum);
                end = start + minimum;
            }
        }
        return new int[]{start, end};
    }

    private static final class ScissorState {
        final boolean enabled;
        final int x;
        final int y;
        final int width;
        final int height;

        private ScissorState(boolean enabled, int x, int y, int width, int height) {
            this.enabled = enabled;
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }

        static ScissorState capture() {
            boolean enabled = GL11.glIsEnabled(GL11.GL_SCISSOR_TEST);
            if (!enabled) return new ScissorState(false, 0, 0, 0, 0);
            IntBuffer box = BufferUtils.createIntBuffer(OPENGL_INTEGER_QUERY_BUFFER_SIZE);
            GL11.glGetInteger(GL11.GL_SCISSOR_BOX, box);
            return new ScissorState(true, box.get(0), box.get(1), box.get(2), box.get(3));
        }

        void restore() {
            if (enabled) {
                GL11.glEnable(GL11.GL_SCISSOR_TEST);
                GL11.glScissor(x, y, width, height);
            } else {
                GL11.glDisable(GL11.GL_SCISSOR_TEST);
            }
        }
    }

    static NodeClickAction nodeClickAction(
            int mouseButton,
            boolean hasInputRecipes,
            boolean hasAlternatives) {
        if (mouseButton == 0) {
            return hasInputRecipes ? NodeClickAction.SELECT_RECIPE : NodeClickAction.NONE;
        }
        if (mouseButton == 1) return NodeClickAction.VIEW_USES;
        if (mouseButton == 2 && hasAlternatives) return NodeClickAction.SELECT_ALTERNATIVE;
        return NodeClickAction.NONE;
    }

    private static void drawOutline(int left, int top, int right, int bottom, int color) {
        Gui.drawRect(left, top, right, top + 1, color);
        Gui.drawRect(left, bottom - 1, right, bottom, color);
        Gui.drawRect(left, top + 1, left + 1, bottom - 1, color);
        Gui.drawRect(right - 1, top + 1, right, bottom - 1, color);
    }

    static RecipeTreeLayout.Size detailedRecipeNodeSize(int nativeWidth, int nativeHeight) {
        return new RecipeTreeLayout.Size(nativeWidth, nativeHeight);
    }

    static RecipeTreeLayout.Size pickerRecipeCardSize(
            int nativeWidth,
            int nativeHeight,
            float scale) {
        return new RecipeTreeLayout.Size(
                Math.max(1, Math.round(nativeWidth * scale)),
                Math.max(1, Math.round(nativeHeight * scale)));
    }

    static int clampScroll(int scroll, int contentHeight, int viewportHeight) {
        int maximum = Math.max(0, contentHeight - Math.max(1, viewportHeight));
        return Math.max(0, Math.min(maximum, scroll));
    }

    static int scrollAfterWheel(
            int scroll,
            int wheel,
            int contentHeight,
            int viewportHeight) {
        if (wheel == 0) return clampScroll(scroll, contentHeight, viewportHeight);
        return clampScroll(scroll + (wheel < 0 ? 34 : -34), contentHeight, viewportHeight);
    }

    static int centeredRowLeft(
            int regionLeft,
            int regionWidth,
            int cellWidth,
            int gap,
            int itemCount) {
        int count = Math.max(1, itemCount);
        int rowWidth = count * cellWidth + Math.max(0, count - 1) * gap;
        return regionLeft + Math.max(0, (regionWidth - rowWidth) / 2);
    }

    private void drawScrollbar(
            int left,
            int top,
            int bottom,
            int scroll,
            int contentHeight) {
        int viewport = Math.max(1, bottom - top);
        if (contentHeight <= viewport) return;
        int trackHeight = viewport;
        int thumbHeight = Math.max(8, Math.round(trackHeight * viewport / (float) contentHeight));
        int maximumScroll = Math.max(1, contentHeight - viewport);
        int thumbTravel = Math.max(0, trackHeight - thumbHeight);
        int thumbTop = top + Math.round(thumbTravel * scroll / (float) maximumScroll);
        Gui.drawRect(left, top, left + 3, bottom, 0x553F5146);
        Gui.drawRect(left, thumbTop, left + 3, thumbTop + thumbHeight, 0xFF7CA372);
    }

    private static float clamp(float value, float minimum, float maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static int lighten(int color, int amount) {
        int alpha = color & 0xFF000000;
        int red = Math.min(255, ((color >> 16) & 255) + amount);
        int green = Math.min(255, ((color >> 8) & 255) + amount);
        int blue = Math.min(255, (color & 255) + amount);
        return alpha | red << 16 | green << 8 | blue;
    }

    static int mixColor(int base, int tint, int tintParts, int totalParts) {
        if (tintParts < 0 || totalParts <= 0 || tintParts > totalParts) {
            throw new IllegalArgumentException("Invalid color mix ratio");
        }
        int baseParts = totalParts - tintParts;
        int alpha = base & 0xFF000000;
        int red = (((base >> 16) & 255) * baseParts
                + ((tint >> 16) & 255) * tintParts) / totalParts;
        int green = (((base >> 8) & 255) * baseParts
                + ((tint >> 8) & 255) * tintParts) / totalParts;
        int blue = ((base & 255) * baseParts + (tint & 255) * tintParts) / totalParts;
        return alpha | red << 16 | green << 8 | blue;
    }

    private String trim(String value, int maximumWidth) {
        if (value == null) return "";
        if (fontRenderer.getStringWidth(value) <= maximumWidth) return value;
        String suffix = "...";
        int available = Math.max(0, maximumWidth - fontRenderer.getStringWidth(suffix));
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < value.length(); index++) {
            if (fontRenderer.getStringWidth(result.toString() + value.charAt(index)) > available) {
                break;
            }
            result.append(value.charAt(index));
        }
        return result.append(suffix).toString();
    }

    private void enableScissor(int left, int top, int right, int bottom) {
        Minecraft client = ensureLiveRenderContext("scissor");
        if (client == null) return;
        ScaledResolution scaled = new ScaledResolution(client);
        int factor = scaled.getScaleFactor();
        GL11.glEnable(GL11.GL_SCISSOR_TEST);
        GL11.glScissor(left * factor, client.displayHeight - bottom * factor,
                Math.max(0, right - left) * factor, Math.max(0, bottom - top) * factor);
    }

    private final class RecipePickerScreen extends GuiScreen {
        private static final int PICKER_VIEW_TOP = 62;
        private static final int PICKER_OPEN_JEI = 101;
        private static final int PICKER_ALTERNATIVES = 102;
        private static final int PICKER_NO_RECIPE = 103;
        private static final int PICKER_DONE = 104;
        private static final int PICKER_REUSABLE = 105;

        private final RecipeTreeScreen parent;
        private final RecipeTreeModel.Node node;
        private final IFocus.Mode mode;
        private final boolean initial;
        private final List<RecipeTreeViewerBridge.RecipeGroup> groups;
        private final List<PickerGroupHitbox> groupHitboxes =
                new ArrayList<PickerGroupHitbox>();
        private final List<PickerMachineHitbox> machineHitboxes =
                new ArrayList<PickerMachineHitbox>();
        private final List<PickerCardHitbox> cardHitboxes =
                new ArrayList<PickerCardHitbox>();
        private final List<AspectSourceHitbox> aspectSourceHitboxes =
                new ArrayList<AspectSourceHitbox>();
        private GuiTextField searchField;
        private String searchText = "";
        private int scroll;
        private int contentHeight;

        private RecipePickerScreen(
                RecipeTreeScreen parent,
                RecipeTreeModel.Node node,
                IFocus.Mode mode,
                boolean initial) {
            this.parent = parent;
            this.node = node;
            this.mode = mode;
            this.initial = initial;
            this.groups = parent.model.recipesFor(node.getIngredient(), mode);
        }

        @Override
        public void initGui() {
            Keyboard.enableRepeatEvents(true);
            buttonList.clear();
            int right = width - 12;
            int x = right;
            if (mode == IFocus.Mode.OUTPUT) {
                x -= 90;
                buttonList.add(new GuiButton(PICKER_NO_RECIPE, x, 10, 86, 20, "No recipe"));
                if (node.getParent() != null) {
                    x -= 108;
                    buttonList.add(new GuiButton(PICKER_REUSABLE, x, 10, 104, 20,
                            pickerReusableLabel(node.isManualReusableInput())));
                }
                if (node.getAlternatives().size() > 1) {
                    x -= 116;
                    buttonList.add(new GuiButton(PICKER_ALTERNATIVES, x, 10, 112, 20,
                            "Change item " + (node.getAlternativeIndex() + 1) + " / "
                                    + node.getAlternatives().size()));
                }
            }
            x -= 86;
            buttonList.add(new GuiButton(PICKER_OPEN_JEI, x, 10, 82, 20, "Open in XEI"));
            buttonList.add(new GuiButton(PICKER_DONE, width - 92, height - 30,
                    80, 20, "Done"));
            int searchWidth = Math.max(90, Math.min(260, width - 180));
            searchField = new GuiTextField(106, fontRenderer, 58, 34, searchWidth, 20);
            searchField.setMaxStringLength(120);
            searchField.setText(searchText);
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == PICKER_OPEN_JEI) {
                parent.openJei(node.getIngredient(), mode);
            } else if (button.id == PICKER_ALTERNATIVES) {
                mc.displayGuiScreen(new AlternativePickerScreen(this, node));
            } else if (button.id == PICKER_NO_RECIPE) {
                parent.model.clearRecipesForIngredient(node, true);
                parent.invalidateLayout();
                parent.commitHistory(false);
                mc.displayGuiScreen(parent);
            } else if (button.id == PICKER_REUSABLE) {
                parent.toggleReusableNode(node);
                button.displayString = pickerReusableLabel(node.isManualReusableInput());
            } else if (button.id == PICKER_DONE) {
                mc.displayGuiScreen(initial ? null : parent);
            }
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            nativeRecipeRegions.clear();
            liveIngredientRegions.clear();
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(6, 6, width - 6, height - 6, 0xED101617);
            Gui.drawRect(6, 6, width - 6, 8, 0xFF55B947);
            safeRenderIngredient(node.getIngredient(), 14, 12, "recipe-picker-header");
            String heading = (mode == IFocus.Mode.OUTPUT ? "Input recipe for " : "Output using ")
                    + node.getIngredient().getDisplayName();
            fontRenderer.drawString(heading, 36, 17, 0xFFF3F3F3);
            String query = normalizedSearch();
            String choices = filteredChoiceCount(query) + " choices";
            fontRenderer.drawString(choices,
                    width - 14 - fontRenderer.getStringWidth(choices), 40, 0xFFB5C2B3);
            fontRenderer.drawString("Search", 14, 41, 0xFFB5C2B3);

            groupHitboxes.clear();
            machineHitboxes.clear();
            cardHitboxes.clear();
            aspectSourceHitboxes.clear();
            int viewTop = PICKER_VIEW_TOP;
            int viewBottom = height - 38;
            enableScissor(10, viewTop, width - 10, viewBottom);
            try {
                int y = viewTop - scroll;
                int visibleGroups = 0;
                for (RecipeTreeViewerBridge.RecipeGroup group : groups) {
                    boolean groupMatches = groupMatchesSearch(group, query);
                    List<RecipeTreeViewerBridge.Recipe> visibleRecipes =
                            filteredRecipes(group, query, groupMatches);
                    int visibleChoices = selectableRecipeCount(
                            visibleRecipes, query, groupMatches);
                    if (visibleChoices == 0) continue;
                    visibleGroups++;
                    int groupY = y;
                    boolean collapsed = progress.isRecipeTypeCollapsed(group.getCategoryUid());
                    if (intersectsViewport(14, groupY, width - 28, 20,
                            10, viewTop, width - 10, viewBottom)) {
                        groupHitboxes.add(new PickerGroupHitbox(group, 14, groupY,
                                width - 28, 20));
                        Gui.drawRect(14, groupY, width - 14, groupY + 20, 0xFF293A2F);
                        String marker = collapsed ? "> " : "v ";
                        fontRenderer.drawString(marker, 20, groupY + 6, 0xFFE5EDE3);
                        RecipeTreeViewerBridge.Ingredient machine = group.getCatalystMachine();
                        int titleX = 32;
                        if (machine != null) {
                            safeRenderIngredient(machine, 32, groupY + 2,
                                    "recipe-picker-machine");
                            machineHitboxes.add(new PickerMachineHitbox(
                                    machine, 30, groupY, 20, 20));
                            titleX = 54;
                        }
                        fontRenderer.drawString(
                                trim(group.getCategoryTitle(), Math.max(20, width - titleX - 52)),
                                titleX, groupY + 6, 0xFFE5EDE3);
                        String total = Integer.toString(visibleChoices);
                        fontRenderer.drawString(total,
                                width - 22 - fontRenderer.getStringWidth(total), groupY + 6,
                                0xFFC6D0C3);
                    }
                    y += 24;
                    if (collapsed) continue;
                    if (isAspectSourceGroup(group)) {
                        y = drawAspectSourceGrid(visibleRecipes, query, groupMatches,
                                y, mouseX, mouseY, viewTop, viewBottom);
                    } else {
                        y = drawPickerCards(visibleRecipes, y, mouseX, mouseY,
                                viewTop, viewBottom);
                    }
                    y += 8;
                }
                if (visibleGroups == 0) {
                    fontRenderer.drawString("No recipes match this search.", 18, y + 8,
                            0xFFB5C2B3);
                    y += 28;
                }
                contentHeight = Math.max(0, y + scroll - viewTop);
                scroll = clampScroll(scroll, contentHeight, viewBottom - viewTop);
            } finally {
                GL11.glDisable(GL11.GL_SCISSOR_TEST);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
            searchField.drawTextBox();
            PickerMachineHitbox hoveredMachine = pickerMachineAt(mouseX, mouseY);
            AspectSourceHitbox hoveredAspectSource = aspectSourceAt(mouseX, mouseY);
            String footer = hoveredMachine == null
                    ? "Scroll to browse all recipes"
                    : "Click the machine to view its crafting recipes";
            fontRenderer.drawString(footer, 14, height - 24, 0xFFBEC8BB);
            drawScrollbar(width - 10, viewTop, viewBottom, scroll, contentHeight);
            if (pointInsideViewport(mouseX, mouseY,
                    10, viewTop, width - 10, viewBottom)) {
                if (hoveredMachine != null) {
                    drawHoveringText(safeTooltip(
                            hoveredMachine.ingredient, "recipe-picker-machine-tooltip"),
                            mouseX, mouseY);
                } else if (hoveredAspectSource != null) {
                    if (hoveredAspectSource.containsByproductCorner(mouseX, mouseY)) {
                        drawAspectSourceByproductTooltip(hoveredAspectSource,
                                mouseX, mouseY, width, height);
                    } else {
                        drawHoveringText(safeTooltip(hoveredAspectSource.ingredient,
                                "thaumic-aspect-grid-tooltip"), mouseX, mouseY);
                    }
                } else {
                    drawNativeIngredientTooltip(mouseX, mouseY);
                }
            }
        }

        private AspectSourceHitbox aspectSourceAt(int mouseX, int mouseY) {
            for (AspectSourceHitbox source : aspectSourceHitboxes) {
                if (source.contains(mouseX, mouseY)) return source;
            }
            return null;
        }

        private PickerMachineHitbox pickerMachineAt(int mouseX, int mouseY) {
            for (PickerMachineHitbox machine : machineHitboxes) {
                if (machine.contains(mouseX, mouseY)) return machine;
            }
            return null;
        }

        private int drawPickerCards(
                List<RecipeTreeViewerBridge.Recipe> recipes,
                int y,
                int mouseX,
                int mouseY,
                int viewTop,
                int viewBottom) {
            int gap = 14;
            int available = width - 36;
            int preferred = 190;
            int columns = Math.max(1, Math.min(5, (available + gap) / (preferred + gap)));
            int columnWidth = (available - gap * (columns - 1)) / columns;
            int rowHeight = 0;
            int rowY = y;
            for (int index = 0; index < recipes.size(); index++) {
                RecipeTreeViewerBridge.Recipe recipe = recipes.get(index);
                int column = index % columns;
                if (column == 0 && index > 0) {
                    rowY += rowHeight + 12;
                    rowHeight = 0;
                }
                int rowStart = index - column;
                int rowItems = Math.min(columns, recipes.size() - rowStart);
                int rowLeft = centeredRowLeft(18, available, columnWidth, gap, rowItems);
                float scale = Math.min(1F, (columnWidth - 12F) / recipe.getWidth());
                int drawWidth = Math.max(1, Math.round(recipe.getWidth() * scale));
                int drawHeight = Math.max(1, Math.round(recipe.getHeight() * scale));
                int cardWidth = drawWidth;
                int cardHeight = drawHeight;
                rowHeight = Math.max(rowHeight, cardHeight);
                int cellLeft = rowLeft + column * (columnWidth + gap);
                int left = cellLeft + (columnWidth - cardWidth) / 2;
                boolean selected = node.getRecipe() != null
                        && node.getRecipe().getKey().equals(recipe.getKey());
                boolean hovered = contains(left, rowY, cardWidth, cardHeight, mouseX, mouseY);
                Gui.drawRect(left - 1, rowY - 1, left + cardWidth + 1,
                        rowY + cardHeight + 1,
                        selected ? 0xFF66D05B : hovered ? 0xFF92B989 : 0xFF55645A);
                int drawX = left;
                if (intersectsViewport(left, rowY, cardWidth, cardHeight,
                        10, viewTop, width - 10, viewBottom)) {
                    parent.drawNativeRecipe(recipe, drawX, rowY, scale,
                            (int) ((mouseX - drawX) / scale),
                            (int) ((mouseY - rowY) / scale));
                    cardHitboxes.add(new PickerCardHitbox(
                            recipe, left, rowY, cardWidth, cardHeight));
                }
            }
            return rowY + rowHeight;
        }

        private int drawAspectSourceGrid(
                List<RecipeTreeViewerBridge.Recipe> pages,
                String query,
                boolean groupMatches,
                int y,
                int mouseX,
                int mouseY,
                int viewTop,
                int viewBottom) {
            final int cellWidth = 52;
            final int cellHeight = 42;
            final int gap = 4;
            int gridLeft = 18;
            int available = Math.max(cellWidth, width - 36);
            int columns = Math.max(1, (available + gap) / (cellWidth + gap));
            int choiceCount = selectableRecipeCount(pages, query, groupMatches);
            int rows = (choiceCount + columns - 1) / columns;
            int gridTop = y;
            int firstVisibleRow = Math.max(0,
                    Math.floorDiv(viewTop - gridTop - cellHeight, cellHeight + gap));
            int lastVisibleRow = Math.min(rows - 1,
                    Math.floorDiv(viewBottom - gridTop, cellHeight + gap) + 1);
            int firstVisibleIndex = firstVisibleRow * columns;
            int lastVisibleIndex = Math.min(choiceCount, (lastVisibleRow + 1) * columns);
            int index = 0;
            for (RecipeTreeViewerBridge.Recipe page : pages) {
                for (RecipeTreeViewerBridge.Ingredient source :
                        page.getSelectableAspectSources()) {
                    if (!groupMatches && !aspectSourceMatches(page, source, query)) continue;
                    if (index >= lastVisibleIndex) {
                        return gridTop + rows * (cellHeight + gap) - gap;
                    }
                    if (index >= firstVisibleIndex) {
                        int column = index % columns;
                        int row = index / columns;
                        int left = gridLeft + column * (cellWidth + gap);
                        int top = gridTop + row * (cellHeight + gap);
                        boolean selected = selectedAspectSourceMatches(
                                node.getRecipe(), source);
                        boolean hovered = contains(
                                left, top, cellWidth, cellHeight, mouseX, mouseY);
                        Gui.drawRect(left, top, left + cellWidth, top + cellHeight,
                                selected ? 0xFF4A7444
                                        : hovered ? 0xFF3E5350 : 0xFF27332E);
                        safeRenderIngredient(source, left + (cellWidth - 16) / 2,
                                top + 5, "thaumic-aspect-grid");
                        String amount = RecipeTreeModel.formatAmount(source.getAmount());
                        fontRenderer.drawString(amount,
                                left + (cellWidth - fontRenderer.getStringWidth(amount)) / 2,
                                top + 26, 0xFFE8EEE6);
                        List<RecipeTreeViewerBridge.Ingredient> byproducts =
                                page.getAspectSourceByproducts(source);
                        if (!byproducts.isEmpty()) {
                            drawAspectSourceCorner(left, top, cellWidth, cellHeight);
                        }
                        aspectSourceHitboxes.add(new AspectSourceHitbox(
                                page, source, byproducts,
                                left, top, cellWidth, cellHeight));
                        liveIngredientRegions.add(new LiveIngredientRegion(source,
                                left + (cellWidth - 16) / 2, top + 5, 16, 16));
                    }
                    index++;
                }
            }
            return gridTop + rows * (cellHeight + gap) - gap;
        }

        private boolean isAspectSourceGroup(RecipeTreeViewerBridge.RecipeGroup group) {
            return RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_CATEGORY_UID.equals(
                    group.getCategoryUid());
        }

        private int selectableRecipeCount(List<RecipeTreeViewerBridge.Recipe> recipes) {
            return selectableRecipeCount(recipes, "", true);
        }

        private int selectableRecipeCount(
                List<RecipeTreeViewerBridge.Recipe> recipes,
                String query,
                boolean groupMatches) {
            int count = 0;
            for (RecipeTreeViewerBridge.Recipe recipe : recipes) {
                if (!recipe.isAspectSourcePage()) {
                    count++;
                    continue;
                }
                for (RecipeTreeViewerBridge.Ingredient source :
                        recipe.getSelectableAspectSources()) {
                    if (groupMatches || aspectSourceMatches(recipe, source, query)) count++;
                }
            }
            return count;
        }

        private int filteredChoiceCount(String query) {
            int count = 0;
            for (RecipeTreeViewerBridge.RecipeGroup group : groups) {
                boolean groupMatches = groupMatchesSearch(group, query);
                List<RecipeTreeViewerBridge.Recipe> visible =
                        filteredRecipes(group, query, groupMatches);
                count += selectableRecipeCount(visible, query, groupMatches);
            }
            return count;
        }

        private List<RecipeTreeViewerBridge.Recipe> filteredRecipes(
                RecipeTreeViewerBridge.RecipeGroup group,
                String query,
                boolean groupMatches) {
            if (query.isEmpty() || groupMatches) return group.getRecipes();
            List<RecipeTreeViewerBridge.Recipe> result =
                    new ArrayList<RecipeTreeViewerBridge.Recipe>();
            for (RecipeTreeViewerBridge.Recipe recipe : group.getRecipes()) {
                if (recipe.isAspectSourcePage()) {
                    for (RecipeTreeViewerBridge.Ingredient source :
                            recipe.getSelectableAspectSources()) {
                        if (aspectSourceMatches(recipe, source, query)) {
                            result.add(recipe);
                            break;
                        }
                    }
                } else if (pickerRecipeMatchesSearch(recipe, query)) {
                    result.add(recipe);
                }
            }
            return result;
        }

        private boolean groupMatchesSearch(
                RecipeTreeViewerBridge.RecipeGroup group,
                String query) {
            if (query.isEmpty()) return true;
            if (searchMatches(group.getCategoryTitle(), query)) return true;
            RecipeTreeViewerBridge.Ingredient machine = group.getCatalystMachine();
            return machine != null && pickerIngredientMatchesSearch(machine, query);
        }

        private boolean aspectSourceMatches(
                RecipeTreeViewerBridge.Recipe page,
                RecipeTreeViewerBridge.Ingredient source,
                String query) {
            if (query.isEmpty() || pickerIngredientMatchesSearch(source, query)) return true;
            for (RecipeTreeViewerBridge.Ingredient byproduct :
                    page.getAspectSourceByproducts(source)) {
                if (pickerIngredientMatchesSearch(byproduct, query)) return true;
            }
            return false;
        }

        private String normalizedSearch() {
            searchText = searchField == null ? searchText : searchField.getText();
            return searchText == null ? "" : searchText.trim().toLowerCase(Locale.ROOT);
        }

        @Override
        protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
            searchField.mouseClicked(mouseX, mouseY, mouseButton);
            super.mouseClicked(mouseX, mouseY, mouseButton);
            if (mc.currentScreen != this) return;
            int viewTop = PICKER_VIEW_TOP;
            int viewBottom = height - 38;
            if (!pointInsideViewport(mouseX, mouseY, 10, viewTop, width - 10, viewBottom)) {
                return;
            }
            if (mouseButton == 1 && openNativeIngredientAt(mouseX, mouseY)) return;
            if (mouseButton != 0) return;
            PickerMachineHitbox machine = pickerMachineAt(mouseX, mouseY);
            if (machine != null) {
                mc.displayGuiScreen(new OpenItemChoiceScreen(
                        parent, machine.ingredient, this));
                return;
            }
            for (PickerGroupHitbox header : groupHitboxes) {
                if (!header.contains(mouseX, mouseY)) continue;
                boolean collapsed = progress.isRecipeTypeCollapsed(
                        header.group.getCategoryUid());
                progress.setRecipeTypeCollapsed(header.group.getCategoryUid(), !collapsed);
                return;
            }
            for (PickerCardHitbox card : cardHitboxes) {
                if (!card.contains(mouseX, mouseY)) continue;
                if (mode == IFocus.Mode.OUTPUT) {
                    if (parent.model.setRecipe(node, card.recipe, true)) {
                        parent.invalidateLayout();
                        parent.commitHistory(false);
                        mc.displayGuiScreen(parent);
                    }
                } else {
                    RecipeTreeViewerBridge.Ingredient output = primaryOutput(card.recipe);
                    if (output != null) {
                        mc.displayGuiScreen(parent.screenForOpenedIngredient(output));
                    }
                }
                return;
            }
            for (AspectSourceHitbox source : aspectSourceHitboxes) {
                if (!source.contains(mouseX, mouseY)) continue;
                RecipeTreeViewerBridge.Recipe recipe =
                        source.page.selectAspectSource(source.ingredient);
                if (recipe == null) {
                    IllegalStateException failure = new IllegalStateException(
                            "ThaumicJEI aspect-source page rejected the selected item");
                    logRenderFailure("thaumic-aspect-select:" + source.page.getKey(), failure);
                    return;
                }
                if (mode == IFocus.Mode.OUTPUT) {
                    if (parent.model.setRecipe(node, recipe, true)) {
                        parent.invalidateLayout();
                        parent.commitHistory(false);
                        mc.displayGuiScreen(parent);
                    }
                } else {
                    RecipeTreeViewerBridge.Ingredient output = primaryOutput(recipe);
                    if (output != null) {
                        mc.displayGuiScreen(parent.screenForOpenedIngredient(output));
                    }
                }
                return;
            }
        }

        @Override
        public void handleMouseInput() throws IOException {
            super.handleMouseInput();
            int wheel = Mouse.getEventDWheel();
            if (wheel == 0) return;
            int viewport = Math.max(1, height - 96);
            scroll = scrollAfterWheel(scroll, wheel, contentHeight, viewport);
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            String previousSearch = searchField.getText();
            if (searchField.isFocused()
                    && searchField.textboxKeyTyped(typedChar, keyCode)) {
                searchText = searchField.getText();
                if (!previousSearch.equals(searchText)) scroll = 0;
                return;
            }
            if (parent.openInventoryIfPressed(keyCode)) return;
            if (isCtrlKeyDown() && keyCode == Keyboard.KEY_F) {
                searchField.setFocused(true);
                return;
            }
            if (keyCode == Keyboard.KEY_ESCAPE) {
                mc.displayGuiScreen(parent);
                return;
            }
            super.keyTyped(typedChar, keyCode);
        }

        @Override
        public void updateScreen() {
            searchField.updateCursorCounter();
        }

        @Override
        public void onGuiClosed() {
            searchText = searchField == null ? searchText : searchField.getText();
            Keyboard.enableRepeatEvents(false);
        }

        @Override
        public boolean doesGuiPauseGame() {
            return false;
        }
    }

    private final class AlternativePickerScreen extends GuiScreen {
        private final GuiScreen parent;
        private final RecipeTreeModel.Node node;
        private final List<IngredientHitbox> hitboxes = new ArrayList<IngredientHitbox>();
        private int scroll;
        private int contentHeight;

        private AlternativePickerScreen(GuiScreen parent, RecipeTreeModel.Node node) {
            this.parent = parent;
            this.node = node;
        }

        @Override
        public void initGui() {
            buttonList.clear();
            buttonList.add(new GuiButton(201, width - 92, height - 30, 80, 20, "Cancel"));
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == 201) mc.displayGuiScreen(parent);
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(8, 8, width - 8, height - 8, 0xEE111718);
            Gui.drawRect(8, 8, width - 8, 10, 0xFF55B947);
            fontRenderer.drawString("Choose ingredient", 18, 20, 0xFFF0F0F0);
            hitboxes.clear();
            int cell = 42;
            int columns = Math.max(1, (width - 36) / cell);
            int viewTop = 42;
            int viewBottom = height - 38;
            int rows = (node.getAlternatives().size() + columns - 1) / columns;
            contentHeight = 6 + rows * cell;
            scroll = clampScroll(scroll, contentHeight, viewBottom - viewTop);
            enableScissor(10, viewTop, width - 10, viewBottom);
            try {
                for (int index = 0; index < node.getAlternatives().size(); index++) {
                    int left = 18 + (index % columns) * cell;
                    int top = 48 - scroll + (index / columns) * cell;
                    if (!intersectsViewport(left, top, 36, 36,
                            10, viewTop, width - 10, viewBottom)) continue;
                    boolean selected = index == node.getAlternativeIndex();
                    boolean hovered = contains(left, top, 36, 36, mouseX, mouseY);
                    Gui.drawRect(left, top, left + 36, top + 36,
                            selected ? 0xFF4A7444 : hovered ? 0xFF3E5350 : 0xFF27332E);
                    RecipeTreeViewerBridge.Ingredient ingredient =
                            node.getAlternatives().get(index);
                    safeRenderIngredient(ingredient, left + 10, top + 7,
                            "alternative-picker");
                    hitboxes.add(new IngredientHitbox(index, ingredient, left, top, 36, 36));
                }
            } finally {
                GL11.glDisable(GL11.GL_SCISSOR_TEST);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
            drawScrollbar(width - 11, viewTop, viewBottom, scroll, contentHeight);
            for (IngredientHitbox hitbox : hitboxes) {
                if (pointInsideViewport(mouseX, mouseY,
                        10, viewTop, width - 10, viewBottom)
                        && hitbox.contains(mouseX, mouseY)) {
                    drawHoveringText(
                            safeTooltip(hitbox.ingredient, "alternative-picker"), mouseX, mouseY);
                    break;
                }
            }
        }

        @Override
        protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
            super.mouseClicked(mouseX, mouseY, mouseButton);
            if (mc.currentScreen != this) return;
            if (!pointInsideViewport(mouseX, mouseY,
                    10, 42, width - 10, height - 38)) return;
            if (mouseButton != 0) return;
            for (IngredientHitbox hitbox : hitboxes) {
                if (!hitbox.contains(mouseX, mouseY)) continue;
                if (model.selectAlternative(node, hitbox.index, true)) {
                    invalidateLayout();
                    commitHistory(false);
                }
                mc.displayGuiScreen(parent);
                return;
            }
        }

        @Override
        public void handleMouseInput() throws IOException {
            super.handleMouseInput();
            int wheel = Mouse.getEventDWheel();
            scroll = scrollAfterWheel(scroll, wheel, contentHeight, Math.max(1, height - 80));
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(parent);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class OpenItemChoiceScreen extends GuiScreen {
        private static final int ADD_CURRENT = 301;
        private static final int START_NEW = 302;
        private static final int CANCEL = 303;

        private final RecipeTreeScreen parent;
        private final GuiScreen returnScreen;
        private final RecipeTreeViewerBridge.Ingredient ingredient;
        private final List<RecipeTreeViewerBridge.RecipeGroup> groups;
        private final List<RecipeTreeViewerBridge.Recipe> recipes;
        private final List<PickerGroupHitbox> groupHitboxes =
                new ArrayList<PickerGroupHitbox>();
        private final List<PickerCardHitbox> cards = new ArrayList<PickerCardHitbox>();
        private final List<AspectSourceHitbox> aspectSources =
                new ArrayList<AspectSourceHitbox>();
        private RecipeTreeViewerBridge.Recipe selected;
        private int scroll;
        private int contentHeight;

        private OpenItemChoiceScreen(
                RecipeTreeScreen parent,
                RecipeTreeViewerBridge.Ingredient ingredient) {
            this(parent, ingredient, parent);
        }

        private OpenItemChoiceScreen(
                RecipeTreeScreen parent,
                RecipeTreeViewerBridge.Ingredient ingredient,
                GuiScreen returnScreen) {
            this.parent = parent;
            this.returnScreen = returnScreen;
            this.ingredient = ingredient;
            this.groups = parent.model.recipesFor(ingredient, IFocus.Mode.OUTPUT);
            this.recipes = new ArrayList<RecipeTreeViewerBridge.Recipe>();
            String favorite = progress.favoriteRecipe(ingredient.getKey());
            for (RecipeTreeViewerBridge.RecipeGroup group : groups) {
                for (RecipeTreeViewerBridge.Recipe recipe : group.getRecipes()) {
                    recipes.add(recipe);
                    if (recipe.isAspectSourcePage()) {
                        if (favorite != null) {
                            RecipeTreeViewerBridge.Recipe restored =
                                    recipe.resolveAspectSource(favorite);
                            if (restored != null) selected = restored;
                        }
                    } else if (favorite != null && favorite.equals(recipe.getKey())) {
                        selected = recipe;
                    }
                }
            }
            if (selected == null) {
                for (RecipeTreeViewerBridge.Recipe recipe : recipes) {
                    if (!recipe.isAspectSourcePage()) {
                        selected = recipe;
                        break;
                    }
                    if (!recipe.getSelectableAspectSources().isEmpty()) {
                        selected = recipe.selectAspectSource(
                                recipe.getSelectableAspectSources().get(0));
                        break;
                    }
                }
            }
        }

        @Override
        public void initGui() {
            buttonList.clear();
            int panelLeft = Math.max(8, width / 10);
            int panelRight = width - panelLeft;
            int contentLeft = panelLeft + 16;
            int contentWidth = panelRight - panelLeft - 32;
            int gap = 12;
            int half = Math.max(80, (contentWidth - gap) / 2);
            int buttonY = height - 36;
            buttonList.add(new GuiButton(ADD_CURRENT, contentLeft, buttonY, half, 20,
                    "Add to current tree"));
            buttonList.add(new GuiButton(START_NEW, contentLeft + half + gap, buttonY, half, 20,
                    "Start new tree"));
            buttonList.add(new GuiButton(CANCEL, panelRight - 90, 16, 74, 20, "Cancel"));
            for (GuiButton button : buttonList) {
                if (button.id == ADD_CURRENT || button.id == START_NEW) {
                    button.enabled = selected != null || recipes.isEmpty();
                }
            }
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == CANCEL) {
                mc.displayGuiScreen(returnScreen);
            } else if (button.id == ADD_CURRENT) {
                if (!parent.model.addRoot(ingredient, 1L)) {
                    parent.status = "A tree can contain at most " + RecipeTreeModel.MAX_ROOTS
                            + " starting items";
                    mc.displayGuiScreen(parent);
                    return;
                }
                RecipeTreeModel.Node root = parent.model.getRoots()
                        .get(parent.model.getRoots().size() - 1);
                if (selected != null) parent.model.setRecipe(root, selected, true);
                parent.invalidateLayout();
                parent.centered = false;
                parent.commitHistory(false);
                mc.displayGuiScreen(parent);
            } else if (button.id == START_NEW) {
                RecipeTreeScreen replacement = new RecipeTreeScreen(bridge, ingredient);
                if (selected != null) {
                    replacement.model.setRecipe(replacement.model.getPrimaryRoot(), selected, true);
                    replacement.commitHistory(false);
                    mc.displayGuiScreen(replacement);
                } else {
                    mc.displayGuiScreen(replacement.initialInputRecipeScreen());
                }
            }
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            nativeRecipeRegions.clear();
            liveIngredientRegions.clear();
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            int left = Math.max(8, width / 10);
            int right = width - left;
            Gui.drawRect(left, 10, right, height - 8, 0xEE111718);
            Gui.drawRect(left, 10, right, 12, 0xFF55B947);
            safeRenderIngredient(ingredient, left + 16, 20, "open-item-header");
            fontRenderer.drawString(ingredient.getDisplayName(), left + 40, 25, 0xFFF0F0F0);
            String explanation =
                    "Choose a recipe, then add this starting item or begin a separate tree.";
            fontRenderer.drawString(explanation, left + 16, 48, 0xFFB9C5B6);

            cards.clear();
            aspectSources.clear();
            groupHitboxes.clear();
            int viewTop = 66;
            int viewBottom = height - 44;
            int available = right - left - 32;
            int y = 72 - scroll;
            enableScissor(left + 8, viewTop, right - 8, viewBottom);
            try {
                for (RecipeTreeViewerBridge.RecipeGroup group : groups) {
                    int groupY = y;
                    boolean collapsed = progress.isRecipeTypeCollapsed(group.getCategoryUid());
                    if (intersectsViewport(left + 16, groupY, available, 20,
                            left + 8, viewTop, right - 8, viewBottom)) {
                        groupHitboxes.add(new PickerGroupHitbox(
                                group, left + 16, groupY, available, 20));
                        Gui.drawRect(left + 16, groupY, right - 16,
                                groupY + 20, 0xFF293A2F);
                        String marker = collapsed ? "> " : "v ";
                        fontRenderer.drawString(marker, left + 22,
                                groupY + 6, 0xFFE5EDE3);
                        RecipeTreeViewerBridge.Ingredient machine = group.getCatalystMachine();
                        int titleX = left + 40;
                        if (machine != null) {
                            safeRenderIngredient(machine, left + 40, groupY + 2,
                                    "open-item-category-machine");
                            titleX = left + 62;
                        }
                        fontRenderer.drawString(
                                trim(group.getCategoryTitle(),
                                        Math.max(20, right - titleX - 48)),
                                titleX, groupY + 6, 0xFFE5EDE3);
                        String total = Integer.toString(
                                selectableOpenRecipeCount(group.getRecipes()));
                        fontRenderer.drawString(total,
                                right - 24 - fontRenderer.getStringWidth(total),
                                groupY + 6, 0xFFC6D0C3);
                    }
                    y += 24;
                    if (collapsed) continue;
                    if (isOpenAspectSourceGroup(group)) {
                        y = drawOpenAspectSourceGrid(group.getRecipes(), left + 16, available, y,
                                mouseX, mouseY, viewTop, viewBottom);
                    } else {
                        y = drawOpenRecipeCards(group.getRecipes(), left + 16, available, y,
                                mouseX, mouseY, viewTop, viewBottom);
                    }
                    y += 8;
                }
                contentHeight = Math.max(0, y + scroll - viewTop);
                scroll = clampScroll(scroll, contentHeight, viewBottom - viewTop);
            } finally {
                GL11.glDisable(GL11.GL_SCISSOR_TEST);
            }
            if (recipes.isEmpty()) {
                fontRenderer.drawString("No recipes", left + 16, 80, 0xFFBFC6BD);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
            drawScrollbar(right - 11, viewTop, viewBottom, scroll, contentHeight);
            if (pointInsideViewport(mouseX, mouseY,
                    left + 8, viewTop, right - 8, viewBottom)) {
                AspectSourceHitbox hoveredSource = null;
                for (AspectSourceHitbox source : aspectSources) {
                    if (source.contains(mouseX, mouseY)) {
                        hoveredSource = source;
                        break;
                    }
                }
                if (hoveredSource != null) {
                    if (hoveredSource.containsByproductCorner(mouseX, mouseY)) {
                        drawAspectSourceByproductTooltip(hoveredSource,
                                mouseX, mouseY, width, height);
                    } else {
                        drawHoveringText(safeTooltip(hoveredSource.ingredient,
                                "thaumic-aspect-grid-tooltip"), mouseX, mouseY);
                    }
                } else {
                    drawNativeIngredientTooltip(mouseX, mouseY);
                }
            }
        }

        private int drawOpenRecipeCards(
                List<RecipeTreeViewerBridge.Recipe> values,
                int regionLeft,
                int available,
                int y,
                int mouseX,
                int mouseY,
                int viewTop,
                int viewBottom) {
            int gap = 14;
            int columns = Math.max(1, Math.min(3, (available + gap) / 190));
            int cardWidth = (available - gap * (columns - 1)) / columns;
            List<Integer> rowHeights = recipeRowHeights(values, columns, cardWidth);
            int rowY = y;
            for (int index = 0; index < values.size(); index++) {
                RecipeTreeViewerBridge.Recipe recipe = values.get(index);
                int column = index % columns;
                if (column == 0 && index > 0) {
                    rowY += rowHeights.get(index / columns - 1) + 12;
                }
                float scale = Math.min(1F, (cardWidth - 10F) / recipe.getWidth());
                RecipeTreeLayout.Size cardSize = pickerRecipeCardSize(
                        recipe.getWidth(), recipe.getHeight(), scale);
                int drawWidth = cardSize.width;
                int drawHeight = cardSize.height;
                int rowStart = index - column;
                int rowItems = Math.min(columns, values.size() - rowStart);
                int rowLeft = centeredRowLeft(regionLeft, available,
                        cardWidth, gap, rowItems);
                int cellLeft = rowLeft + column * (cardWidth + gap);
                int drawLeft = cellLeft + (cardWidth - drawWidth) / 2;
                if (!intersectsViewport(drawLeft, rowY, drawWidth, drawHeight,
                        regionLeft - 8, viewTop, regionLeft + available + 8, viewBottom)) {
                    continue;
                }
                boolean active = selected != null
                        && selected.getKey().equals(recipe.getKey());
                boolean hovered = contains(
                        drawLeft, rowY, drawWidth, drawHeight, mouseX, mouseY);
                Gui.drawRect(drawLeft - 1, rowY - 1,
                        drawLeft + drawWidth + 1, rowY + drawHeight + 1,
                        active ? 0xFF66D05B : hovered ? 0xFF92B989 : 0xFF59655C);
                drawNativeRecipe(recipe, drawLeft, rowY, scale,
                        (int) ((mouseX - drawLeft) / scale),
                        (int) ((mouseY - rowY) / scale));
                if (active) {
                    Gui.drawRect(drawLeft, rowY, drawLeft + drawWidth, rowY + drawHeight,
                            selectedRecipeTintColor(0xFF55B947));
                }
                cards.add(new PickerCardHitbox(
                        recipe, drawLeft, rowY, drawWidth, drawHeight));
            }
            return rowHeights.isEmpty()
                    ? rowY : rowY + rowHeights.get(rowHeights.size() - 1);
        }

        private int selectableOpenRecipeCount(
                List<RecipeTreeViewerBridge.Recipe> values) {
            int count = 0;
            for (RecipeTreeViewerBridge.Recipe recipe : values) {
                count += recipe.isAspectSourcePage()
                        ? recipe.getSelectableAspectSources().size() : 1;
            }
            return count;
        }

        private boolean isOpenAspectSourceGroup(
                RecipeTreeViewerBridge.RecipeGroup group) {
            return RecipeTreeViewerBridge.THAUMIC_ASPECT_SOURCE_CATEGORY_UID.equals(
                    group.getCategoryUid());
        }

        private int drawOpenAspectSourceGrid(
                List<RecipeTreeViewerBridge.Recipe> pages,
                int gridLeft,
                int available,
                int y,
                int mouseX,
                int mouseY,
                int viewTop,
                int viewBottom) {
            final int cellWidth = 52;
            final int cellHeight = 42;
            final int gap = 4;
            int choiceCount = selectableOpenRecipeCount(pages);
            if (choiceCount <= 0) return y;
            int columns = Math.max(1, (available + gap) / (cellWidth + gap));
            int rows = (choiceCount + columns - 1) / columns;
            int gridTop = y;
            int firstVisibleRow = Math.max(0,
                    Math.floorDiv(viewTop - gridTop - cellHeight, cellHeight + gap));
            int lastVisibleRow = Math.min(rows - 1,
                    Math.floorDiv(viewBottom - gridTop, cellHeight + gap) + 1);
            int firstVisibleIndex = firstVisibleRow * columns;
            int lastVisibleIndex = Math.min(choiceCount,
                    (lastVisibleRow + 1) * columns);
            int index = 0;
            for (RecipeTreeViewerBridge.Recipe page : pages) {
                for (RecipeTreeViewerBridge.Ingredient source :
                        page.getSelectableAspectSources()) {
                    if (index >= lastVisibleIndex) {
                        return gridTop + rows * (cellHeight + gap) - gap;
                    }
                    if (index >= firstVisibleIndex) {
                        int column = index % columns;
                        int row = index / columns;
                        int left = gridLeft + column * (cellWidth + gap);
                        int top = gridTop + row * (cellHeight + gap);
                        boolean active = selectedAspectSourceMatches(selected, source);
                        boolean hovered = contains(
                                left, top, cellWidth, cellHeight, mouseX, mouseY);
                        Gui.drawRect(left, top, left + cellWidth, top + cellHeight,
                                active ? 0xFF4A7444
                                        : hovered ? 0xFF3E5350 : 0xFF27332E);
                        safeRenderIngredient(source, left + 18, top + 5,
                                "open-item-aspect-source");
                        String amount = RecipeTreeModel.formatAmount(source.getAmount());
                        fontRenderer.drawString(amount,
                                left + (cellWidth - fontRenderer.getStringWidth(amount)) / 2,
                                top + 26, 0xFFE8EEE6);
                        List<RecipeTreeViewerBridge.Ingredient> byproducts =
                                page.getAspectSourceByproducts(source);
                        if (!byproducts.isEmpty()) {
                            drawAspectSourceCorner(left, top, cellWidth, cellHeight);
                        }
                        aspectSources.add(new AspectSourceHitbox(
                                page, source, byproducts,
                                left, top, cellWidth, cellHeight));
                        liveIngredientRegions.add(new LiveIngredientRegion(
                                source, left + 18, top + 5, 16, 16));
                    }
                    index++;
                }
            }
            return gridTop + rows * (cellHeight + gap) - gap;
        }

        private List<Integer> recipeRowHeights(
                List<RecipeTreeViewerBridge.Recipe> values,
                int columns,
                int cardWidth) {
            List<Integer> rows = new ArrayList<Integer>();
            for (int index = 0; index < values.size(); index++) {
                RecipeTreeViewerBridge.Recipe recipe = values.get(index);
                float scale = Math.min(1F, (cardWidth - 10F) / recipe.getWidth());
                int height = pickerRecipeCardSize(
                        recipe.getWidth(), recipe.getHeight(), scale).height;
                int row = index / columns;
                if (row >= rows.size()) rows.add(height);
                else rows.set(row, Math.max(rows.get(row), height));
            }
            return rows;
        }

        @Override
        protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
            super.mouseClicked(mouseX, mouseY, mouseButton);
            if (mc.currentScreen != this) return;
            int left = Math.max(8, width / 10);
            int right = width - left;
            int viewBottom = height - 44;
            if (!pointInsideViewport(mouseX, mouseY,
                    left + 8, 66, right - 8, viewBottom)) return;
            if (mouseButton == 1 && openNativeIngredientAt(mouseX, mouseY)) return;
            if (mouseButton != 0) return;
            for (PickerGroupHitbox header : groupHitboxes) {
                if (!header.contains(mouseX, mouseY)) continue;
                boolean collapsed = progress.isRecipeTypeCollapsed(
                        header.group.getCategoryUid());
                progress.setRecipeTypeCollapsed(header.group.getCategoryUid(), !collapsed);
                return;
            }
            for (PickerCardHitbox card : cards) {
                if (card.contains(mouseX, mouseY)) {
                    selected = card.recipe;
                    for (GuiButton button : buttonList) {
                        if (button.id == ADD_CURRENT || button.id == START_NEW) button.enabled = true;
                    }
                    return;
                }
            }
            for (AspectSourceHitbox source : aspectSources) {
                if (!source.contains(mouseX, mouseY)) continue;
                RecipeTreeViewerBridge.Recipe choice =
                        source.page.selectAspectSource(source.ingredient);
                if (choice == null) {
                    logRenderFailure("open-item-aspect-select:" + source.page.getKey(),
                            new IllegalStateException(
                                    "ThaumicJEI aspect-source page rejected the selected item"));
                    return;
                }
                selected = choice;
                for (GuiButton button : buttonList) {
                    if (button.id == ADD_CURRENT || button.id == START_NEW) {
                        button.enabled = true;
                    }
                }
                return;
            }
        }

        @Override
        public void handleMouseInput() throws IOException {
            super.handleMouseInput();
            int wheel = Mouse.getEventDWheel();
            int viewBottom = height - 44;
            scroll = scrollAfterWheel(scroll, wheel, contentHeight,
                    Math.max(1, viewBottom - 66));
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(returnScreen);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class TreeTransferScreen extends GuiScreen implements GuiYesNoCallback {
        private static final int BUTTON_IMPORT_TREE = 701;
        private static final int BUTTON_EXPORT_TREE = 702;
        private static final int BUTTON_COPY_TREE = 703;
        private static final int BUTTON_OPEN_FOLDER = 704;
        private static final int BUTTON_START_EXPORTER = 705;
        private static final int BUTTON_DONE = 706;

        private final GuiScreen returnScreen;
        private GuiTextField outputField;
        private String outputDirectory = "jei-exports";
        private ExportRequest pendingExportRequest;
        private String message = "";
        private int panelLeft;
        private int panelRight;

        private TreeTransferScreen(GuiScreen returnScreen) {
            this.returnScreen = returnScreen;
        }

        @Override
        public void initGui() {
            Keyboard.enableRepeatEvents(true);
            buttonList.clear();
            int panelWidth = Math.min(620, Math.max(360, width - 32));
            panelLeft = (width - panelWidth) / 2;
            panelRight = panelLeft + panelWidth;
            int contentLeft = panelLeft + 22;
            int contentRight = panelRight - 22;
            int buttonWidth = Math.min(180, (contentRight - contentLeft - 10) / 2);

            buttonList.add(new GuiButton(BUTTON_IMPORT_TREE, contentLeft, 72,
                    buttonWidth, 20, "Import tree"));
            buttonList.add(new GuiButton(BUTTON_EXPORT_TREE,
                    contentLeft + buttonWidth + 10, 72, buttonWidth, 20,
                    "Export current tree"));
            buttonList.add(new GuiButton(BUTTON_COPY_TREE, contentLeft, 98,
                    buttonWidth, 20, "Copy current tree"));
            buttonList.add(new GuiButton(BUTTON_OPEN_FOLDER,
                    contentLeft + buttonWidth + 10, 98, buttonWidth, 20,
                    "Open tree folder"));

            outputField = new GuiTextField(707, fontRenderer,
                    contentLeft, 174, contentRight - contentLeft, 20);
            outputField.setMaxStringLength(512);
            outputField.setText(outputDirectory);
            buttonList.add(new GuiButton(BUTTON_START_EXPORTER,
                    contentLeft, 202, Math.min(200, contentRight - contentLeft), 20,
                    "Start JEI data export"));
            buttonList.add(new GuiButton(BUTTON_DONE,
                    panelRight - 102, height - 42, 80, 20, "Done"));
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            switch (button.id) {
                case BUTTON_IMPORT_TREE:
                    mc.displayGuiScreen(new ImportTreeScreen(this));
                    break;
                case BUTTON_EXPORT_TREE:
                    shareCurrentTree(this);
                    break;
                case BUTTON_COPY_TREE:
                    try {
                        setClipboardString(currentPortableShareJson());
                        button.displayString = "Copied!";
                        message = "Portable recipe tree copied";
                    } catch (RuntimeException error) {
                        JeiExportMod.LOGGER.error(
                                "[jeiexport] Could not create portable recipe-tree JSON", error);
                        message = "Could not copy tree; see the log";
                    }
                    break;
                case BUTTON_OPEN_FOLDER:
                    openShareDirectory();
                    break;
                case BUTTON_START_EXPORTER:
                    requestDatasetExportConfirmation();
                    break;
                case BUTTON_DONE:
                    mc.displayGuiScreen(returnScreen);
                    break;
                default:
                    break;
            }
        }

        private void requestDatasetExportConfirmation() {
            outputDirectory = outputField.getText() == null
                    ? "" : outputField.getText().trim();
            try {
                pendingExportRequest = ExportRequest.fromCommand(
                        outputDirectory.isEmpty() ? null : outputDirectory, mc);
                mc.displayGuiScreen(new GuiYesNo(
                        this,
                        "Start the full JEI data export?",
                        "Warning: this scans every registered recipe and may temporarily " +
                                "freeze the client. Continue?",
                        "Start export",
                        "Cancel",
                        BUTTON_START_EXPORTER));
            } catch (IOException error) {
                pendingExportRequest = null;
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Invalid data export requested from the Recipe Tree screen",
                        error);
                message = "Invalid export location: " + error.getMessage();
            }
        }

        @Override
        public void confirmClicked(boolean confirmed, int id) {
            if (id != BUTTON_START_EXPORTER) {
                pendingExportRequest = null;
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Recipe Tree received an unknown confirmation id {}", id);
                message = "Could not confirm export; see the log";
                mc.displayGuiScreen(this);
                return;
            }
            ExportRequest request = pendingExportRequest;
            pendingExportRequest = null;
            if (!confirmed) {
                message = "JEI data export canceled";
                mc.displayGuiScreen(this);
                return;
            }
            if (request == null) {
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Recipe Tree export was confirmed without a validated request");
                message = "Could not start export; see the log";
                mc.displayGuiScreen(this);
                return;
            }
            JeiExportMod.COORDINATOR.enqueue(request, "Recipe Tree import/export screen");
            message = "JEI data export queued: " + request.output;
            mc.displayGuiScreen(this);
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(panelLeft, 12, panelRight, height - 12, 0xED111718);
            Gui.drawRect(panelLeft, 12, panelRight, 14, 0xFF55B947);
            drawCenteredString(fontRenderer, "Import / Export", width / 2, 28,
                    0xFFF1F1F1);
            fontRenderer.drawString("Recipe trees", panelLeft + 22, 54, 0xFFB9D8B3);
            fontRenderer.drawSplitString(
                    "Import from this world's history, the clipboard, or .mrtree.json files. "
                            + "Export keeps the existing copy and share-folder actions.",
                    panelLeft + 22, 126, panelRight - panelLeft - 44, 0xFFBFC8BD);
            fontRenderer.drawString("Full JEI dataset export", panelLeft + 22, 154,
                    0xFFB9D8B3);
            fontRenderer.drawString("Output directory", panelLeft + 22, 164,
                    0xFF9FACA0);
            fontRenderer.drawSplitString(
                    "This starts the same export as /jeiexport [output-directory]. Relative "
                            + "paths are inside the Minecraft instance.",
                    panelLeft + 22, 232, panelRight - panelLeft - 44, 0xFFBFC8BD);
            if (!message.isEmpty()) {
                fontRenderer.drawSplitString(message, panelLeft + 22, height - 68,
                        panelRight - panelLeft - 130, 0xFF8FE871);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
            outputField.drawTextBox();
        }

        @Override
        protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
            outputField.mouseClicked(mouseX, mouseY, mouseButton);
            super.mouseClicked(mouseX, mouseY, mouseButton);
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (outputField.textboxKeyTyped(typedChar, keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(returnScreen);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public void onGuiClosed() {
            Keyboard.enableRepeatEvents(false);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class ImportTreeScreen extends GuiScreen {
        private static final int BUTTON_HISTORY = 711;
        private static final int BUTTON_CLIPBOARD = 712;
        private static final int BUTTON_FILES = 713;
        private static final int BUTTON_OPEN_FOLDER = 714;
        private static final int BUTTON_BACK = 715;

        private final GuiScreen returnScreen;
        private String message = "";

        private ImportTreeScreen(GuiScreen returnScreen) {
            this.returnScreen = returnScreen;
        }

        @Override
        public void initGui() {
            buttonList.clear();
            int center = width / 2;
            int buttonWidth = Math.min(240, Math.max(150, width - 64));
            int left = center - buttonWidth / 2;
            buttonList.add(new GuiButton(BUTTON_HISTORY, left, 66,
                    buttonWidth, 20, "Recipe history"));
            buttonList.add(new GuiButton(BUTTON_CLIPBOARD, left, 92,
                    buttonWidth, 20, "Paste tree from clipboard"));
            buttonList.add(new GuiButton(BUTTON_FILES, left, 118,
                    buttonWidth, 20, "Trees in share folder"));
            buttonList.add(new GuiButton(BUTTON_OPEN_FOLDER, left, 144,
                    buttonWidth, 20, "Open share folder"));
            buttonList.add(new GuiButton(BUTTON_BACK, width - 92, height - 30,
                    80, 20, "Back"));
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            switch (button.id) {
                case BUTTON_HISTORY:
                    mc.displayGuiScreen(new HistorySelectorScreen(
                            RecipeTreeScreen.this, this));
                    break;
                case BUTTON_CLIPBOARD:
                    importClipboard();
                    break;
                case BUTTON_FILES:
                    mc.displayGuiScreen(new SharedTreeFilesScreen(this));
                    break;
                case BUTTON_OPEN_FOLDER:
                    openShareDirectory();
                    break;
                case BUTTON_BACK:
                    mc.displayGuiScreen(returnScreen);
                    break;
                default:
                    break;
            }
        }

        private void importClipboard() {
            try {
                RecipeTreeProgress.RecipeHistoryEntry entry = RecipeTreeTransfer.fromJson(
                        getClipboardString(), bridge);
                openImportedTree(entry, "clipboard");
            } catch (IOException error) {
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Could not import the recipe tree from the clipboard",
                        error);
                message = "Clipboard import failed: " + error.getMessage();
            }
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(8, 8, width - 8, height - 8, 0xED111718);
            Gui.drawRect(8, 8, width - 8, 10, 0xFF55B947);
            drawCenteredString(fontRenderer, "Import recipe tree", width / 2, 24,
                    0xFFF1F1F1);
            drawCenteredString(fontRenderer,
                    "Open a recent tree, paste portable JSON, or choose a shared file.",
                    width / 2, 42, 0xFFBFC8BD);
            if (!message.isEmpty()) {
                fontRenderer.drawSplitString(message, 24, 178, width - 48, 0xFFFF7777);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(returnScreen);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class SharedTreeFilesScreen extends GuiScreen {
        private static final int BUTTON_REFRESH = 721;
        private static final int BUTTON_OPEN_FOLDER = 722;
        private static final int BUTTON_BACK = 723;

        private final GuiScreen returnScreen;
        private final List<TreeFileHitbox> cards = new ArrayList<TreeFileHitbox>();
        private List<Path> files = Collections.emptyList();
        private String message = "";
        private int scroll;
        private int contentHeight;

        private SharedTreeFilesScreen(GuiScreen returnScreen) {
            this.returnScreen = returnScreen;
        }

        @Override
        public void initGui() {
            buttonList.clear();
            buttonList.add(new GuiButton(BUTTON_REFRESH, 14, height - 30,
                    76, 20, "Refresh"));
            buttonList.add(new GuiButton(BUTTON_OPEN_FOLDER, 96, height - 30,
                    112, 20, "Open folder"));
            buttonList.add(new GuiButton(BUTTON_BACK, width - 92, height - 30,
                    80, 20, "Back"));
            refreshFiles();
        }

        private void refreshFiles() {
            try {
                Files.createDirectories(shareDirectory());
                files = RecipeTreeTransfer.listShareFiles(shareDirectory());
                message = files.isEmpty() ? "No .mrtree.json files in the share folder" : "";
            } catch (IOException error) {
                JeiExportMod.LOGGER.error(
                        "[jeiexport] Could not list recipe-tree files in {}",
                        shareDirectory(), error);
                files = Collections.emptyList();
                message = "Could not read the share folder; see the log";
            }
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == BUTTON_REFRESH) refreshFiles();
            else if (button.id == BUTTON_OPEN_FOLDER) openShareDirectory();
            else if (button.id == BUTTON_BACK) mc.displayGuiScreen(returnScreen);
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(8, 8, width - 8, height - 8, 0xED111718);
            Gui.drawRect(8, 8, width - 8, 10, 0xFF55B947);
            fontRenderer.drawString("Shared recipe trees", 18, 20, 0xFFF1F1F1);
            cards.clear();
            int viewTop = 42;
            int viewBottom = height - 38;
            contentHeight = files.size() * 28 + 6;
            scroll = clampScroll(scroll, contentHeight, viewBottom - viewTop);
            enableScissor(10, viewTop, width - 10, viewBottom);
            try {
                for (int index = 0; index < files.size(); index++) {
                    Path file = files.get(index);
                    int top = viewTop + 4 + index * 28 - scroll;
                    if (!intersectsViewport(16, top, width - 32, 22,
                            10, viewTop, width - 10, viewBottom)) continue;
                    boolean hovered = contains(16, top, width - 32, 22, mouseX, mouseY);
                    Gui.drawRect(16, top, width - 16, top + 22,
                            hovered ? 0xFF3D5142 : 0xFF27322C);
                    String name = file.getFileName() == null
                            ? file.toString() : file.getFileName().toString();
                    fontRenderer.drawString(trim(name, width - 58), 24, top + 7,
                            0xFFE7ECE5);
                    cards.add(new TreeFileHitbox(file, 16, top, width - 32, 22));
                }
            } finally {
                GL11.glDisable(GL11.GL_SCISSOR_TEST);
            }
            if (!message.isEmpty()) {
                drawCenteredString(fontRenderer, message, width / 2,
                        Math.min(height - 52, viewTop + 12), 0xFFFF8888);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
            drawScrollbar(width - 11, viewTop, viewBottom, scroll, contentHeight);
        }

        @Override
        protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
            super.mouseClicked(mouseX, mouseY, mouseButton);
            if (mc.currentScreen != this || mouseButton != 0) return;
            for (TreeFileHitbox card : cards) {
                if (!card.contains(mouseX, mouseY)) continue;
                try {
                    RecipeTreeProgress.RecipeHistoryEntry entry =
                            RecipeTreeTransfer.fromFile(card.file, bridge);
                    openImportedTree(entry, card.file.getFileName().toString());
                } catch (IOException error) {
                    JeiExportMod.LOGGER.error(
                            "[jeiexport] Could not import recipe tree {}", card.file, error);
                    message = "Import failed: " + error.getMessage();
                }
                return;
            }
        }

        @Override
        public void handleMouseInput() throws IOException {
            super.handleMouseInput();
            scroll = scrollAfterWheel(scroll, Mouse.getEventDWheel(), contentHeight,
                    Math.max(1, height - 80));
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(returnScreen);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class HistorySelectorScreen extends GuiScreen {
        private final RecipeTreeScreen parent;
        private final GuiScreen returnScreen;
        private final List<HistoryHitbox> cards = new ArrayList<HistoryHitbox>();
        private final List<HistoryHitbox> deleteButtons = new ArrayList<HistoryHitbox>();
        private Integer comparisonIndex;
        private int scroll;
        private int contentHeight;

        private HistorySelectorScreen(RecipeTreeScreen parent, GuiScreen returnScreen) {
            this.parent = parent;
            this.returnScreen = returnScreen;
        }

        @Override
        public void initGui() {
            buttonList.clear();
            buttonList.add(new GuiButton(401, width - 92, height - 30, 80, 20, "Cancel"));
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == 401) mc.displayGuiScreen(returnScreen);
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(6, 6, width - 6, height - 6, 0xED111718);
            Gui.drawRect(6, 6, width - 6, 8, 0xFF55B947);
            fontRenderer.drawString("(L)  Recipe tree history", 18, 20, 0xFFF1F1F1);
            cards.clear();
            deleteButtons.clear();
            int gap = 8;
            int cardWidth = Math.max(140, Math.min(260, (width - 42) / 3));
            int columns = Math.max(1, (width - 28 + gap) / (cardWidth + gap));
            int viewTop = 42;
            int viewBottom = height - 38;
            int rows = (history.size() + columns - 1) / columns;
            contentHeight = 6 + rows * 54;
            scroll = clampScroll(scroll, contentHeight, viewBottom - viewTop);
            enableScissor(10, viewTop, width - 10, viewBottom);
            try {
                for (int index = history.size() - 1, shown = 0; index >= 0; index--, shown++) {
                    int column = shown % columns;
                    int row = shown / columns;
                    int left = 16 + column * (cardWidth + gap);
                    int top = 48 - scroll + row * 54;
                    if (!intersectsViewport(left, top, cardWidth, 46,
                            10, viewTop, width - 10, viewBottom)) continue;
                    RecipeTreeProgress.RecipeHistoryEntry entry = history.get(index);
                    boolean current = index == historyIndex;
                    boolean compare = comparisonIndex != null && comparisonIndex == index;
                    Gui.drawRect(left, top, left + cardWidth, top + 46,
                            compare ? 0xFF654F35 : current ? 0xFF496741 : 0xFF27322C);
                    RecipeTreeViewerBridge.Ingredient ingredient =
                            bridge.findIngredient(entry.getItemIdentity());
                    if (ingredient != null) {
                        safeRenderIngredient(ingredient, left + 9, top + 14, "history-card");
                    }
                    String name = historyName(entry);
                    fontRenderer.drawString(trim(name, cardWidth - 64), left + 34, top + 10,
                            0xFFF0F2EE);
                    String depth = "Tree depth " + entry.getTreeDepth();
                    fontRenderer.drawString(depth, left + 34, top + 27, 0xFFB9C5B7);
                    cards.add(new HistoryHitbox(index, left, top, cardWidth, 46));
                    int deleteLeft = left + cardWidth - 15;
                    int deleteTop = top + 4;
                    HistoryHitbox delete = new HistoryHitbox(
                            index, deleteLeft, deleteTop, 11, 11);
                    deleteButtons.add(delete);
                    Gui.drawRect(deleteLeft, deleteTop, deleteLeft + 11, deleteTop + 11,
                            delete.contains(mouseX, mouseY) ? 0xFFC85353 : 0xFF793939);
                    fontRenderer.drawString("x", deleteLeft + 3, deleteTop + 1, 0xFFFFFFFF);
                }
            } finally {
                GL11.glDisable(GL11.GL_SCISSOR_TEST);
            }
            fontRenderer.drawString(
                    comparisonIndex == null
                            ? "Newest first - left click to open; right click to compare; x deletes"
                            : "Right click another tree to compare Types, Materials, and Byproducts",
                    16, height - 24, 0xFFBFC8BD);
            super.drawScreen(mouseX, mouseY, partialTicks);
            drawScrollbar(width - 11, viewTop, viewBottom, scroll, contentHeight);
        }

        @Override
        protected void mouseClicked(int mouseX, int mouseY, int mouseButton) throws IOException {
            super.mouseClicked(mouseX, mouseY, mouseButton);
            if (mc.currentScreen != this) return;
            if (!pointInsideViewport(mouseX, mouseY,
                    10, 42, width - 10, height - 38)) return;
            for (HistoryHitbox delete : deleteButtons) {
                if (mouseButton != 0 || !delete.contains(mouseX, mouseY)) continue;
                int deletedIndex = delete.index;
                parent.deleteHistoryEntry(deletedIndex);
                if (comparisonIndex != null) {
                    if (comparisonIndex == deletedIndex) comparisonIndex = null;
                    else if (comparisonIndex > deletedIndex) comparisonIndex--;
                }
                return;
            }
            for (HistoryHitbox card : cards) {
                if (!card.contains(mouseX, mouseY)) continue;
                if (mouseButton == 0) {
                    parent.openHistoryEntry(card.index);
                } else if (mouseButton == 1) {
                    if (comparisonIndex == null) comparisonIndex = card.index;
                    else if (comparisonIndex == card.index) comparisonIndex = null;
                    else mc.displayGuiScreen(new TreeComparisonScreen(
                                this, history.get(comparisonIndex), history.get(card.index)));
                }
                return;
            }
        }

        @Override
        public void handleMouseInput() throws IOException {
            super.handleMouseInput();
            int wheel = Mouse.getEventDWheel();
            scroll = scrollAfterWheel(scroll, wheel, contentHeight, Math.max(1, height - 80));
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(returnScreen);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class TreeComparisonScreen extends GuiScreen {
        private final GuiScreen parent;
        private final RecipeTreeProgress.RecipeHistoryEntry leftEntry;
        private final RecipeTreeProgress.RecipeHistoryEntry rightEntry;
        private final List<List<RecipeTreeComparison.Difference>> lists =
                new ArrayList<List<RecipeTreeComparison.Difference>>();
        private final int[] scrollRows = new int[3];
        private final boolean compareUsingByproducts = useByproducts;
        private int selectedTab;
        private String failure;

        private TreeComparisonScreen(
                GuiScreen parent,
                RecipeTreeProgress.RecipeHistoryEntry leftEntry,
                RecipeTreeProgress.RecipeHistoryEntry rightEntry) {
            this.parent = parent;
            this.leftEntry = leftEntry;
            this.rightEntry = rightEntry;
            try {
                RecipeTreeModel a = RecipeTreeModel.restoreForComparison(bridge, leftEntry);
                RecipeTreeModel b = RecipeTreeModel.restoreForComparison(bridge, rightEntry);
                if (a == null || b == null) throw new IllegalStateException("A saved tree is unavailable in this pack");
                RecipeTreeModel.Summary left = a.summarize(compareUsingByproducts);
                RecipeTreeModel.Summary right = b.summarize(compareUsingByproducts);
                lists.add(RecipeTreeComparison.differences(RecipeTreeComparison.types(left), RecipeTreeComparison.types(right)));
                lists.add(RecipeTreeComparison.differences(RecipeTreeComparison.items(left.materials), RecipeTreeComparison.items(right.materials)));
                lists.add(RecipeTreeComparison.differences(RecipeTreeComparison.items(left.byproducts), RecipeTreeComparison.items(right.byproducts)));
            } catch (RuntimeException error) {
                failure = "Cannot compare complete trees: " + error.getMessage();
                JeiExportMod.LOGGER.error("[jeiexport] Could not compare saved trees {} and {}",
                        historyName(leftEntry), historyName(rightEntry), error);
            }
        }

        @Override
        public void initGui() {
            buttonList.clear();
            buttonList.add(new GuiButton(501, width - 92, height - 30, 80, 20, "Back"));
            int tabWidth = Math.min(102, (width - 36) / 3);
            for (int index = 0; index < 3; index++) {
                String label = SummaryTab.values()[index].label;
                String counted = label + (failure == null ? " (" + lists.get(index).size() + ")" : "");
                GuiButton tab = new GuiButton(502 + index, 18 + index * tabWidth, 70, tabWidth - 4, 20,
                        fontRenderer.getStringWidth(counted) <= tabWidth - 12 ? counted : label);
                tab.enabled = failure == null && index != selectedTab;
                buttonList.add(tab);
            }
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == 501) mc.displayGuiScreen(parent);
            else if (button.id >= 502 && button.id <= 504) {
                selectedTab = button.id - 502;
                initGui();
            }
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(8, 8, width - 8, height - 8, 0xED111718);
            Gui.drawRect(8, 8, width - 8, 10, 0xFF55B947);
            fontRenderer.drawString("Compare recipe trees", 18, 20, 0xFFF0F0F0);
            String leftName = historyName(leftEntry);
            String rightName = historyName(rightEntry);
            fontRenderer.drawString(trim("A: " + leftName + " x" + leftEntry.getAmount(), width / 2 - 30), 20, 40, 0xFFB9D8B3);
            fontRenderer.drawString(trim("B: " + rightName + " x" + rightEntry.getAmount(), width / 2 - 30), width / 2 + 10, 40, 0xFFB9D8B3);
            fontRenderer.drawString(trim("Byproduct usage: " + (compareUsingByproducts ? "ON" : "OFF")
                    + " - comparing saved amounts", width - 40), 20, 55, 0xFFADB9AA);
            if (failure != null) {
                fontRenderer.drawSplitString(failure, 20, 108, width - 40, 0xFFFFAAAA);
            } else {
                List<RecipeTreeComparison.Difference> differences = lists.get(selectedTab);
                int aRight = width * 60 / 100;
                int bRight = width * 77 / 100;
                int deltaRight = width - 24;
                fontRenderer.drawString(selectedTab == 0 ? "Recipe type" : "Item / resource", 20, 100, 0xFFE4E7E2);
                comparisonNumber("A", aRight, 100, 0xFFE4E7E2);
                comparisonNumber("B", bRight, 100, 0xFFE4E7E2);
                comparisonNumber("B - A", deltaRight, 100, 0xFFE4E7E2);
                int visible = Math.max(0, (height - 42 - 116) / 24);
                int maximum = summaryMaximumScroll(differences.size(), visible);
                scrollRows[selectedTab] = clamp(scrollRows[selectedTab], 0, maximum);
                RecipeTreeComparison.Difference hovered = null;
                if (differences.isEmpty()) fontRenderer.drawString("No differences in this list", 20, 122, 0xFFB9D8B3);
                for (int index = scrollRows[selectedTab]; index < differences.size()
                        && index < scrollRows[selectedTab] + visible; index++) {
                    RecipeTreeComparison.Difference row = differences.get(index);
                    int y = 116 + (index - scrollRows[selectedTab]) * 24;
                    boolean over = contains(18, y, width - 38, 22, mouseX, mouseY);
                    Gui.drawRect(18, y, width - 20, y + 22, over ? 0xFF35473B : 0x552B382F);
                    if (row.entry.icon != null) safeRenderIngredient(row.entry.icon, 22, y + 3, "comparison");
                    fontRenderer.drawString(trim(row.entry.name, width * 40 / 100 - 44), 44, y + 7, 0xFFE4E7E2);
                    comparisonNumber(trim(RecipeTreeModel.formatAmount(row.left), width * 16 / 100), aRight, y + 7, 0xFFE4E7E2);
                    comparisonNumber(trim(RecipeTreeModel.formatAmount(row.right), width * 16 / 100), bRight, y + 7, 0xFFE4E7E2);
                    String change = (row.change.signum() > 0 ? "+" : "") + RecipeTreeModel.formatAmount(row.change);
                    comparisonNumber(trim(change, width * 16 / 100), deltaRight, y + 7,
                            row.change.signum() > 0 ? 0xFFF0C879 : 0xFF8BCBE8);
                    if (over) hovered = row;
                }
                if (visible > 0) drawScrollbar(width - 16, 116, 116 + visible * 24,
                        scrollRows[selectedTab] * 24, differences.size() * 24);
                if (hovered != null) {
                    List<String> tooltip = new ArrayList<String>();
                    if (hovered.entry.icon != null) tooltip.addAll(safeTooltip(hovered.entry.icon, "comparison-tooltip"));
                    else tooltip.add(hovered.entry.name);
                    tooltip.add("A: " + RecipeTreeModel.formatAmount(hovered.left));
                    tooltip.add("B: " + RecipeTreeModel.formatAmount(hovered.right));
                    tooltip.add("Change (B - A): " + (hovered.change.signum() > 0 ? "+" : "")
                            + RecipeTreeModel.formatAmount(hovered.change));
                    drawHoveringText(tooltip, mouseX, mouseY);
                }
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
        }

        private void comparisonNumber(String text, int right, int y, int color) {
            fontRenderer.drawString(text, right - fontRenderer.getStringWidth(text), y, color);
        }

        @Override
        public void handleMouseInput() throws IOException {
            super.handleMouseInput();
            if (failure != null) return;
            int visible = Math.max(0, (height - 42 - 116) / 24);
            scrollRows[selectedTab] = scrollSummaryRows(scrollRows[selectedTab], Mouse.getEventDWheel(),
                    summaryMaximumScroll(lists.get(selectedTab).size(), visible));
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(parent);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private final class ShareInstructionsScreen extends GuiScreen {
        private static final int BUTTON_DONE = 601;
        private static final int BUTTON_OPEN_FOLDER = 602;
        private static final int BUTTON_COPY_TREE = 603;
        private static final int DIALOG_MAX_WIDTH = 430;
        private static final int DIALOG_HEIGHT = 154;
        private final GuiScreen parent;
        private final Path file;
        private final String recipeTreeJson;
        private int dialogLeft;
        private int dialogRight;
        private int dialogTop;
        private int dialogBottom;

        private ShareInstructionsScreen(GuiScreen parent, Path file, String recipeTreeJson) {
            this.parent = parent;
            this.file = file;
            this.recipeTreeJson = recipeTreeJson;
        }

        @Override
        public void initGui() {
            buttonList.clear();
            int dialogWidth = Math.min(DIALOG_MAX_WIDTH, Math.max(300, width - 40));
            dialogLeft = (width - dialogWidth) / 2;
            dialogRight = dialogLeft + dialogWidth;
            dialogTop = (height - DIALOG_HEIGHT) / 2;
            dialogBottom = dialogTop + DIALOG_HEIGHT;

            int gap = SHARE_DIALOG_BUTTON_GAP;
            int doneWidth = SHARE_DIALOG_DONE_WIDTH;
            int actionWidth = shareDialogActionWidth(dialogWidth);
            int rowWidth = actionWidth * 2 + doneWidth + gap * 2;
            int buttonX = dialogLeft + (dialogWidth - rowWidth) / 2;
            int buttonY = dialogBottom - 32;
            buttonList.add(new GuiButton(BUTTON_COPY_TREE, buttonX, buttonY,
                    actionWidth, 20, "Copy recipe tree"));
            buttonList.add(new GuiButton(BUTTON_OPEN_FOLDER, buttonX + actionWidth + gap,
                    buttonY, actionWidth, 20, "Open share folder"));
            buttonList.add(new GuiButton(BUTTON_DONE,
                    buttonX + actionWidth * 2 + gap * 2, buttonY, doneWidth, 20, "Done"));
        }

        @Override
        protected void actionPerformed(GuiButton button) throws IOException {
            if (button.id == BUTTON_DONE) {
                mc.displayGuiScreen(parent);
            } else if (button.id == BUTTON_OPEN_FOLDER) {
                openShareFolder(file);
            } else if (button.id == BUTTON_COPY_TREE) {
                setClipboardString(recipeTreeJson);
                button.displayString = "Copied!";
            }
        }

        @Override
        public void drawScreen(int mouseX, int mouseY, float partialTicks) {
            drawGradientRect(0, 0, width, height, 0xA0000000, 0xC0000000);
            Gui.drawRect(dialogLeft, dialogTop, dialogRight, dialogBottom, 0xF0111718);
            Gui.drawRect(dialogLeft, dialogTop, dialogRight, dialogTop + 2, 0xFF55B947);
            drawCenteredString(fontRenderer, "Recipe tree ready", width / 2,
                    dialogTop + 14, 0xFFF0F0F0);
            fontRenderer.drawSplitString(
                    "A portable copy was saved in config/recipe-tree-shares. Copy the recipe "
                            + "tree to send it directly, or open the folder to share the file.",
                    dialogLeft + 16, dialogTop + 36,
                    dialogRight - dialogLeft - 32, 0xFFC9D1C7);
            String fileName = file == null || file.getFileName() == null
                    ? "" : file.getFileName().toString();
            if (!fileName.isEmpty()) {
                drawCenteredString(fontRenderer, trim(fileName, dialogRight - dialogLeft - 32),
                        width / 2, dialogBottom - 51, 0xFF8E9A91);
            }
            super.drawScreen(mouseX, mouseY, partialTicks);
        }

        @Override
        protected void keyTyped(char typedChar, int keyCode) throws IOException {
            if (RecipeTreeScreen.this.openInventoryIfPressed(keyCode)) return;
            if (keyCode == Keyboard.KEY_ESCAPE) mc.displayGuiScreen(parent);
            else super.keyTyped(typedChar, keyCode);
        }

        @Override
        public boolean doesGuiPauseGame() { return false; }
    }

    private RecipeTreeViewerBridge.Ingredient primaryOutput(
            RecipeTreeViewerBridge.Recipe recipe) {
        if (recipe == null) return null;
        for (RecipeTreeViewerBridge.Slot slot : recipe.getOutputs()) {
            if (!slot.getAlternatives().isEmpty()) return slot.getAlternatives().get(0);
        }
        return null;
    }

    private String historyName(RecipeTreeProgress.RecipeHistoryEntry entry) {
        if (entry != null && !entry.getRoots().isEmpty()) {
            String name = entry.getRoots().get(0).getIngredientName();
            if (name != null && !name.isEmpty()) return name;
        }
        return entry == null ? "Unavailable tree" : entry.getItemIdentity();
    }

    private static final class ScreenRect {
        private final int left;
        private final int top;
        private final int width;
        private final int height;

        private ScreenRect(int left, int top, int width, int height) {
            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
        }
    }

    static final class PanOverviewGeometry {
        final int outerLeft;
        final int outerTop;
        final int outerRight;
        final int outerBottom;
        final int mapLeft;
        final int mapTop;
        final int mapWidth;
        final int mapHeight;
        final double scale;
        final int viewportLeft;
        final int viewportTop;
        final int viewportRight;
        final int viewportBottom;

        private PanOverviewGeometry(
                int outerLeft,
                int outerTop,
                int outerRight,
                int outerBottom,
                int mapLeft,
                int mapTop,
                int mapWidth,
                int mapHeight,
                double scale,
                int viewportLeft,
                int viewportTop,
                int viewportRight,
                int viewportBottom) {
            this.outerLeft = outerLeft;
            this.outerTop = outerTop;
            this.outerRight = outerRight;
            this.outerBottom = outerBottom;
            this.mapLeft = mapLeft;
            this.mapTop = mapTop;
            this.mapWidth = mapWidth;
            this.mapHeight = mapHeight;
            this.scale = scale;
            this.viewportLeft = viewportLeft;
            this.viewportTop = viewportTop;
            this.viewportRight = viewportRight;
            this.viewportBottom = viewportBottom;
        }

        int mapX(double treeX) {
            return mapLeft + (int) Math.round(treeX * scale);
        }

        int mapY(double treeY) {
            return mapTop + (int) Math.round(treeY * scale);
        }
    }

    private static class Hitbox {
        final int left;
        final int top;
        final int width;
        final int height;

        private Hitbox(int left, int top, int width, int height) {
            this.left = left;
            this.top = top;
            this.width = width;
            this.height = height;
        }

        boolean contains(int mouseX, int mouseY) {
            return RecipeTreeScreen.contains(left, top, width, height, mouseX, mouseY);
        }
    }

    private static final class NodeHitbox extends Hitbox {
        private final RecipeTreeModel.Node node;

        private NodeHitbox(RecipeTreeModel.Node node, int left, int top, int width, int height) {
            super(left, top, width, height);
            this.node = node;
        }
    }

    private static final class RootRemoveHitbox extends Hitbox {
        private final RecipeTreeModel.Node node;
        private final int keepLeft;
        private final int keepTop;
        private final int keepWidth;
        private final int keepHeight;

        private RootRemoveHitbox(
                RecipeTreeModel.Node node,
                int left,
                int top,
                int width,
                int height,
                int keepLeft,
                int keepTop,
                int keepWidth,
                int keepHeight) {
            super(left, top, width, height);
            this.node = node;
            this.keepLeft = keepLeft;
            this.keepTop = keepTop;
            this.keepWidth = keepWidth;
            this.keepHeight = keepHeight;
        }

        private boolean keepsVisible(int mouseX, int mouseY) {
            return RecipeTreeScreen.contains(
                    keepLeft, keepTop, keepWidth, keepHeight, mouseX, mouseY);
        }
    }

    private static final class TabHitbox extends Hitbox {
        private final SummaryTab tab;

        private TabHitbox(SummaryTab tab, int left, int top, int width, int height) {
            super(left, top, width, height);
            this.tab = tab;
        }
    }

    private static final class ProcessHitbox extends Hitbox {
        private final RecipeTreeModel.ProcessSummary process;

        private ProcessHitbox(
                RecipeTreeModel.ProcessSummary process,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.process = process;
        }
    }

    private static final class MachineHitbox extends Hitbox {
        private final RecipeTreeViewerBridge.Ingredient ingredient;

        private MachineHitbox(
                RecipeTreeViewerBridge.Ingredient ingredient,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.ingredient = ingredient;
        }
    }

    private static final class ReusableToggleHitbox extends Hitbox {
        private final RecipeTreeModel.Node node;

        private ReusableToggleHitbox(
                RecipeTreeModel.Node node,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.node = node;
        }
    }

    private static final class NativeRecipeRegion extends Hitbox {
        private final RecipeTreeViewerBridge.Recipe recipe;
        private final IRecipeLayoutDrawable layout;
        private final float scale;

        private NativeRecipeRegion(
                RecipeTreeViewerBridge.Recipe recipe,
                IRecipeLayoutDrawable layout,
                int left,
                int top,
                float scale,
                int width,
                int height) {
            super(left, top, width, height);
            this.recipe = recipe;
            this.layout = layout;
            this.scale = scale;
        }
    }

    private static final class NativeIngredientHit {
        private final RecipeTreeViewerBridge.Ingredient ingredient;

        private NativeIngredientHit(RecipeTreeViewerBridge.Ingredient ingredient) {
            this.ingredient = ingredient;
        }
    }

    private static final class LiveIngredientRegion extends Hitbox {
        private final RecipeTreeViewerBridge.Ingredient ingredient;

        private LiveIngredientRegion(
                RecipeTreeViewerBridge.Ingredient ingredient,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.ingredient = ingredient;
        }
    }

    private static final class PickerGroupHitbox extends Hitbox {
        private final RecipeTreeViewerBridge.RecipeGroup group;

        private PickerGroupHitbox(
                RecipeTreeViewerBridge.RecipeGroup group,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.group = group;
        }
    }

    private static final class PickerMachineHitbox extends Hitbox {
        private final RecipeTreeViewerBridge.Ingredient ingredient;

        private PickerMachineHitbox(
                RecipeTreeViewerBridge.Ingredient ingredient,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.ingredient = ingredient;
        }
    }

    private static final class PickerCardHitbox extends Hitbox {
        private final RecipeTreeViewerBridge.Recipe recipe;

        private PickerCardHitbox(
                RecipeTreeViewerBridge.Recipe recipe,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.recipe = recipe;
        }
    }

    private static final class AspectSourceHitbox extends Hitbox {
        private final RecipeTreeViewerBridge.Recipe page;
        private final RecipeTreeViewerBridge.Ingredient ingredient;
        private final List<RecipeTreeViewerBridge.Ingredient> byproducts;

        private boolean containsByproductCorner(int mouseX, int mouseY) {
            return !byproducts.isEmpty() && contains(mouseX, mouseY)
                    && (left + width - 1 - mouseX) + (top + height - 1 - mouseY)
                    < ASPECT_CORNER_SIZE;
        }

        private AspectSourceHitbox(
                RecipeTreeViewerBridge.Recipe page,
                RecipeTreeViewerBridge.Ingredient ingredient,
                List<RecipeTreeViewerBridge.Ingredient> byproducts,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.page = page;
            this.ingredient = ingredient;
            this.byproducts = byproducts == null
                    ? Collections.<RecipeTreeViewerBridge.Ingredient>emptyList()
                    : byproducts;
        }
    }

    private static final class IngredientHitbox extends Hitbox {
        private final int index;
        private final RecipeTreeViewerBridge.Ingredient ingredient;

        private IngredientHitbox(
                int index,
                RecipeTreeViewerBridge.Ingredient ingredient,
                int left,
                int top,
                int width,
                int height) {
            super(left, top, width, height);
            this.index = index;
            this.ingredient = ingredient;
        }
    }

    private static final class HistoryHitbox extends Hitbox {
        private final int index;

        private HistoryHitbox(int index, int left, int top, int width, int height) {
            super(left, top, width, height);
            this.index = index;
        }
    }

    private static final class TreeFileHitbox extends Hitbox {
        private final Path file;

        private TreeFileHitbox(Path file, int left, int top, int width, int height) {
            super(left, top, width, height);
            this.file = file;
        }
    }

    enum NodeClickAction {
        NONE,
        SELECT_RECIPE,
        VIEW_USES,
        SELECT_ALTERNATIVE
    }

    private enum SummaryTab {
        TYPES("Types"),
        MATERIALS("Materials"),
        BYPRODUCTS("Byproducts");

        private final String label;

        SummaryTab(String label) {
            this.label = label;
        }
    }

    private static final class ToolbarPlacement {
        private final int left;
        private final int top;
        private final int width;

        private ToolbarPlacement(int left, int top, int width) {
            this.left = left;
            this.top = top;
            this.width = width;
        }
    }

    private static final class ToolbarFlow {
        private final int left;
        private final int right;
        private int x;
        private int rowY;

        private ToolbarFlow(int left, int right, int rowY) {
            this.left = left;
            this.right = right;
            this.x = left;
            this.rowY = rowY;
        }

        private ToolbarPlacement place(int preferredWidth) {
            int width = Math.max(20, Math.min(preferredWidth, right - left));
            if (x != left && x + width > right) {
                x = left;
                rowY += TOOLBAR_BUTTON_HEIGHT + 4;
            }
            ToolbarPlacement result = new ToolbarPlacement(x, rowY, width);
            x += width + 4;
            return result;
        }

        private int take(int preferredWidth) {
            int width = Math.max(20, Math.min(preferredWidth, right - left));
            if (x != left && x + width > right) {
                x = left;
                rowY += TOOLBAR_BUTTON_HEIGHT + 4;
            }
            return x;
        }

        private void advance(int width) {
            x += width + 4;
        }

        private int getRowY() { return rowY; }

        private int getBottom() { return rowY + TOOLBAR_BUTTON_HEIGHT; }
    }

    private final class ClockButton extends GuiButton {
        private ClockButton(int id, int x, int y) {
            super(id, x, y, 22, 20, "");
        }

        @Override
        public void drawButton(Minecraft minecraft, int mouseX, int mouseY, float partialTicks) {
            if (!visible) return;
            hovered = mouseX >= x && mouseY >= y && mouseX < x + width
                    && mouseY < y + height;
            int face = hovered ? 0xFF899089 : 0xFF777D77;
            Gui.drawRect(x + 3, y + 3, x + 19, y + 19, 0x99000000);
            // A low-pixel 16x16 circle with an L-shaped clock hand and normal button shadow.
            Gui.drawRect(x + 5, y + 2, x + 17, y + 18, face);
            Gui.drawRect(x + 3, y + 5, x + 19, y + 15, face);
            Gui.drawRect(x + 4, y + 3, x + 18, y + 17, face);
            Gui.drawRect(x + 6, y + 4, x + 16, y + 16, 0xFF2E332E);
            Gui.drawRect(x + 8, y + 6, x + 14, y + 14, face);
            Gui.drawRect(x + 10, y + 7, x + 12, y + 13, 0xFFFFFFFF);
            Gui.drawRect(x + 10, y + 11, x + 15, y + 13, 0xFFFFFFFF);
        }
    }

    private static final class PortableShareEnvelope {
        private final String format;
        private final int version;
        private final String createdAt;
        private final PortableSharePack pack;
        private final String rootKey;
        private final String direction;
        private final PortableShareProductionPlan productionPlan;
        private final List<PortableShareSelection> selections;

        private PortableShareEnvelope(
                String format,
                int version,
                String createdAt,
                PortableSharePack pack,
                String rootKey,
                String direction,
                PortableShareProductionPlan productionPlan,
                List<PortableShareSelection> selections) {
            this.format = format;
            this.version = version;
            this.createdAt = createdAt;
            this.pack = pack;
            this.rootKey = rootKey;
            this.direction = direction;
            this.productionPlan = productionPlan;
            this.selections = selections;
        }
    }

    private static final class PortableSharePack {
        private final String minecraftVersion;

        private PortableSharePack(String minecraftVersion) {
            this.minecraftVersion = minecraftVersion;
        }
    }

    private static final class PortableShareProductionPlan {
        private final long amount;
        private final int windowSeconds;

        private PortableShareProductionPlan(long amount, int windowSeconds) {
            this.amount = amount;
            this.windowSeconds = windowSeconds;
        }
    }

    private static final class PortableShareSelection {
        private final List<Integer> path;
        private final String itemKey;
        private final PortableShareSource source;

        private PortableShareSelection(
                List<Integer> path,
                String itemKey,
                PortableShareSource source) {
            this.path = new ArrayList<Integer>(path);
            this.itemKey = itemKey;
            this.source = source;
        }
    }

    private static final class PortableShareSource {
        private final String kind;
        private final String recipeKey;

        private PortableShareSource(String kind, String recipeKey) {
            this.kind = kind;
            this.recipeKey = recipeKey;
        }
    }
}
