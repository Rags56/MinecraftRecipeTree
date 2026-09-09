package com.recipetree.jeiexport112;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.Test;
import org.lwjgl.input.Keyboard;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public class RecipeTreeScreenPolicyTest {
    @Test
    public void summaryScrollingReachesTheLastRowsAndClampsAtBothEnds() {
        assertEquals(0, RecipeTreeScreen.summaryMaximumScroll(4, 10));
        assertEquals(14, RecipeTreeScreen.summaryMaximumScroll(30, 16));
        assertEquals(3, RecipeTreeScreen.scrollSummaryRows(0, -120, 14));
        assertEquals(14, RecipeTreeScreen.scrollSummaryRows(12, -120, 14));
        assertEquals(0, RecipeTreeScreen.scrollSummaryRows(2, 120, 14));
        assertEquals(5, RecipeTreeScreen.scrollSummaryRows(5, 0, 14));
        assertEquals(0, RecipeTreeScreen.scrollSummaryRows(14, -120, 0));
    }

    @Test
    public void summaryScrollLimitAccountsForGridRowsAndReducedPanelHeight() {
        // A seven-column grid containing 50 items needs eight rows, including the last partial row.
        assertEquals(5, RecipeTreeScreen.summaryMaximumScroll((50 + 6) / 7, 3));
        assertEquals(7, RecipeTreeScreen.summaryMaximumScroll(8, 0));
        assertEquals(0, RecipeTreeScreen.summaryMaximumScroll(0, 0));
    }

    @Test
    public void inventoryKeyMatchesTheConfiguredKeyWithoutTransientModifierState() {
        assertTrue(RecipeTreeScreen.matchesConfiguredInventoryKey(Keyboard.KEY_E, Keyboard.KEY_E));
        assertTrue(RecipeTreeScreen.matchesConfiguredInventoryKey(Keyboard.KEY_I, Keyboard.KEY_I));
        assertFalse(RecipeTreeScreen.matchesConfiguredInventoryKey(Keyboard.KEY_E, Keyboard.KEY_I));
        assertFalse(RecipeTreeScreen.matchesConfiguredInventoryKey(Keyboard.KEY_NONE, Keyboard.KEY_NONE));
    }

    @Test
    public void lwjglIntegerQueriesReserveTheRequiredBufferCapacity() {
        assertEquals(16, RecipeTreeScreen.OPENGL_INTEGER_QUERY_BUFFER_SIZE);
    }

    @Test
    public void shareDialogButtonsStayWithinTheLegacyTextureWidth() {
        assertEquals(200, RecipeTreeScreen.MAX_NATIVE_BUTTON_WIDTH);
        assertEquals(160, RecipeTreeScreen.shareDialogActionWidth(430));
        assertEquals(104, RecipeTreeScreen.shareDialogActionWidth(300));
        assertTrue(RecipeTreeScreen.shareDialogActionWidth(1000)
                <= RecipeTreeScreen.MAX_NATIVE_BUTTON_WIDTH);
    }

    @Test
    public void largeTreesBoundAvailabilityWorkPerRenderedFrame() {
        assertEquals(16, RecipeTreeScreen.MAX_AVAILABILITY_CHECKS_PER_FRAME);
        assertTrue(RecipeTreeScreen.MAX_AVAILABILITY_CHECKS_PER_FRAME
                < RecipeTreeModel.MAX_NODES);
    }

    @Test
    public void viewportIntersectionRejectsHiddenHitboxes() {
        assertTrue(RecipeTreeScreen.intersectsViewport(
                20, 20, 10, 10, 10, 10, 40, 40));
        assertTrue(RecipeTreeScreen.intersectsViewport(
                5, 20, 10, 10, 10, 10, 40, 40));
        assertFalse(RecipeTreeScreen.intersectsViewport(
                0, 20, 10, 10, 10, 10, 40, 40));
        assertFalse(RecipeTreeScreen.intersectsViewport(
                40, 20, 10, 10, 10, 10, 40, 40));
        assertFalse(RecipeTreeScreen.intersectsViewport(
                20, 20, 0, 10, 10, 10, 40, 40));
    }

    @Test
    public void viewportPointUsesExclusiveRightAndBottomEdges() {
        assertTrue(RecipeTreeScreen.pointInsideViewport(10, 10, 10, 10, 40, 40));
        assertTrue(RecipeTreeScreen.pointInsideViewport(39, 39, 10, 10, 40, 40));
        assertFalse(RecipeTreeScreen.pointInsideViewport(40, 39, 10, 10, 40, 40));
        assertFalse(RecipeTreeScreen.pointInsideViewport(39, 40, 10, 10, 40, 40));
    }

    @Test
    public void scrollingIsBoundedAtBothEnds() {
        assertEquals(0, RecipeTreeScreen.clampScroll(-30, 500, 100));
        assertEquals(400, RecipeTreeScreen.clampScroll(900, 500, 100));
        assertEquals(0, RecipeTreeScreen.clampScroll(20, 80, 100));
        assertEquals(34, RecipeTreeScreen.scrollAfterWheel(0, -1, 500, 100));
        assertEquals(0, RecipeTreeScreen.scrollAfterWheel(10, 1, 500, 100));
        assertEquals(400, RecipeTreeScreen.scrollAfterWheel(390, -1, 500, 100));
    }

    @Test
    public void nestedScreensPreferTheActiveRenderContext() {
        Object activeClient = new Object();
        Object unopenedParent = new Object();

        assertSame(activeClient,
                RecipeTreeScreen.preferLiveRenderContext(activeClient, unopenedParent));
        assertSame(unopenedParent,
                RecipeTreeScreen.preferLiveRenderContext(null, unopenedParent));
    }

    @Test
    public void partialRecipeRowsAreCenteredInThePicker() {
        assertEquals(418, RecipeTreeScreen.centeredRowLeft(18, 1188, 388, 14, 1));
        assertEquals(217, RecipeTreeScreen.centeredRowLeft(18, 1188, 388, 14, 2));
        assertEquals(18, RecipeTreeScreen.centeredRowLeft(18, 1188, 388, 14, 3));
    }

    @Test
    public void nodeActionsAreComposedForTheSidePanel() {
        assertEquals(Arrays.asList(
                        "Required: 12",
                        "Discovered",
                        "Scroll to change item 2 / 7",
                        "Middle click: choose from a grid",
                        "Left click: select input recipe",
                        "Right click: view recipes using this item"),
                RecipeTreeScreen.nodePanelActionLines(
                        "12", true, 1, 7, true));
        assertEquals(Arrays.asList(
                        "Required: 1",
                        "No recipes",
                        "Right click: view recipes using this item"),
                RecipeTreeScreen.nodePanelActionLines(
                        "1", false, 0, 1, false));
        assertEquals("Reusable input: OFF (R)",
                RecipeTreeScreen.reusableToggleLabel(false));
        assertEquals("Reusable input: ON (R)",
                RecipeTreeScreen.reusableToggleLabel(true));
        assertEquals("Reusable: OFF", RecipeTreeScreen.pickerReusableLabel(false));
        assertEquals("Reusable: ON", RecipeTreeScreen.pickerReusableLabel(true));
    }

    @Test
    public void detailedRecipeCardUsesTheExactNativeRenderBounds() {
        RecipeTreeLayout.Size size = RecipeTreeScreen.detailedRecipeNodeSize(156, 84);
        assertEquals(156, size.width);
        assertEquals(84, size.height);
    }

    @Test
    public void startingItemRecipePickerUsesTheExactScaledNativeBounds() {
        RecipeTreeLayout.Size fullSize = RecipeTreeScreen.pickerRecipeCardSize(156, 84, 1F);
        assertEquals(156, fullSize.width);
        assertEquals(84, fullSize.height);

        RecipeTreeLayout.Size scaledSize = RecipeTreeScreen.pickerRecipeCardSize(156, 84, 0.5F);
        assertEquals(78, scaledSize.width);
        assertEquals(42, scaledSize.height);
    }

    @Test
    public void recipePickerSearchMatchesDisplayNamesAndStableIngredientKeys() {
        RecipeTreeViewerBridge.Ingredient ingredient =
                new RecipeTreeViewerBridge.Ingredient(
                        null, "item|thaumcraft:quicksilver", "item|thaumcraft:quicksilver",
                        "Quicksilver Drop", BigDecimal.ONE);

        assertTrue(RecipeTreeScreen.pickerIngredientMatchesSearch(ingredient, "quicksilver"));
        assertTrue(RecipeTreeScreen.pickerIngredientMatchesSearch(ingredient, "thaumcraft"));
        assertFalse(RecipeTreeScreen.pickerIngredientMatchesSearch(ingredient, "aer crystal"));
    }

    @Test
    public void emcOutputItemIsCenteredOverTheTransmutationCircleMark() {
        int itemLeft = RecipeTreeScreen.emcOutputItemLeft();

        assertEquals(35, itemLeft);
        assertEquals(RecipeTreeViewerBridge.EMC_RECIPE_WIDTH / 2, itemLeft + 8);
    }

    @Test
    public void recipeItemsAndCountsShareTheExactTreeZoomScale() {
        assertEquals(1.4F, RecipeTreeScreen.nodeVisualScale(1.4F), 0F);
        assertEquals(0.8F, RecipeTreeScreen.nodeVisualScale(0.8F), 0F);
        assertEquals(0.28F, RecipeTreeScreen.nodeVisualScale(0.2F), 0F);
        assertEquals(2.25F, RecipeTreeScreen.nodeVisualScale(3F), 0F);
        assertEquals(104, RecipeTreeScreen.nodeCountTop(100, 1F));
        assertEquals(102, RecipeTreeScreen.nodeCountTop(100, 0.28F));
    }

    @Test
    public void panOverviewAppearsOnlyWhenTheScaledTreeExceedsTheViewport() {
        assertFalse(RecipeTreeScreen.panOverviewRequired(600, 400, 600, 400));
        assertTrue(RecipeTreeScreen.panOverviewRequired(601, 400, 600, 400));
        assertTrue(RecipeTreeScreen.panOverviewRequired(600, 401, 600, 400));
        assertFalse(RecipeTreeScreen.panOverviewRequired(300, 200, 600, 400));
    }

    @Test
    public void panOverviewMapsTheFullTreeAndViewportIntoItsTopLeftWindow() {
        RecipeTreeScreen.PanOverviewGeometry overview =
                RecipeTreeScreen.panOverviewGeometry(
                        10, 20, 100, 60,
                        1000, 500,
                        250, 100, 500, 250,
                        5);

        assertEquals(10, overview.outerLeft);
        assertEquals(20, overview.outerTop);
        assertEquals(110, overview.outerRight);
        assertEquals(80, overview.outerBottom);
        assertEquals(15, overview.mapLeft);
        assertEquals(27, overview.mapTop);
        assertEquals(90, overview.mapWidth);
        assertEquals(45, overview.mapHeight);
        assertEquals(38, overview.viewportLeft);
        assertEquals(36, overview.viewportTop);
        assertEquals(83, overview.viewportRight);
        assertEquals(59, overview.viewportBottom);
        assertEquals(60, overview.mapX(500));
        assertEquals(50, overview.mapY(250));
    }

    @Test
    public void panOverviewKeepsAnOffTreeViewportVisibleAtTheNearestEdge() {
        RecipeTreeScreen.PanOverviewGeometry overview =
                RecipeTreeScreen.panOverviewGeometry(
                        0, 0, 100, 60,
                        1000, 500,
                        1200, -400, 200, 100,
                        5);

        assertEquals(overview.mapLeft + overview.mapWidth, overview.viewportRight);
        assertEquals(overview.viewportRight - 2, overview.viewportLeft);
        assertEquals(overview.mapTop, overview.viewportTop);
        assertEquals(overview.mapTop + 2, overview.viewportBottom);
    }

    @Test
    public void terminalItemsWithoutRecipesCannotOpenTheRecipeSelector() {
        assertEquals(RecipeTreeScreen.NodeClickAction.NONE,
                RecipeTreeScreen.nodeClickAction(0, false, false));
        assertEquals(RecipeTreeScreen.NodeClickAction.SELECT_RECIPE,
                RecipeTreeScreen.nodeClickAction(0, true, false));
        assertEquals(RecipeTreeScreen.NodeClickAction.VIEW_USES,
                RecipeTreeScreen.nodeClickAction(1, false, false));
        assertEquals(RecipeTreeScreen.NodeClickAction.SELECT_ALTERNATIVE,
                RecipeTreeScreen.nodeClickAction(2, false, true));
    }

    @Test
    public void selectedTypeShadingUsesAStableQuarterTint() {
        assertEquals(0xFF303030,
                RecipeTreeScreen.mixColor(0xFF202020, 0xFF606060, 1, 4));
        assertEquals(0x4460A080,
                RecipeTreeScreen.selectedRecipeTintColor(0xFF60A080));
    }

    @Test
    public void manuallyReusableInputsStayVisibleWhileImplicitToolsRemainHidden() {
        assertTrue(RecipeTreeScreen.shouldDisplayOperationalInput(true, true));
        assertFalse(RecipeTreeScreen.shouldDisplayOperationalInput(true, false));
        assertTrue(RecipeTreeScreen.shouldDisplayOperationalInput(false, false));
    }

    @Test
    public void shareFilenameUsesTheMainStartingNodeName() {
        assertEquals("simulation-chamber",
                RecipeTreeScreen.safeShareFileStem("Simulation Chamber"));
        assertEquals("recipe-tree", RecipeTreeScreen.safeShareFileStem("---"));
    }

    @Test
    public void portableShareIsSiteCompatibleAndContainsOnlyRootZeroSelections() {
        List<RecipeTreeProgress.RecipeHistorySelection> selections =
                new ArrayList<RecipeTreeProgress.RecipeHistorySelection>();
        selections.add(new RecipeTreeProgress.RecipeHistorySelection(
                0, Collections.singletonList(2), "item|example:input", "Input",
                "example:machine|recipe-1", "example:machine", false));
        selections.add(new RecipeTreeProgress.RecipeHistorySelection(
                1, Collections.singletonList(4), "item|example:other", "Other",
                "example:machine|recipe-2", "example:machine", false));
        RecipeTreeProgress.RecipeHistoryEntry entry =
                new RecipeTreeProgress.RecipeHistoryEntry(
                        "item|example:root", "example:root-recipe", 12, true, 3,
                        Collections.singletonList(new RecipeTreeProgress.RecipeHistoryRoot(
                                "item|example:root", "Root", "example:root-recipe", 12)),
                        selections, true);

        JsonObject json = new JsonParser().parse(
                RecipeTreeScreen.portableShareJson(entry, new Date(0L))).getAsJsonObject();

        assertEquals("minecraft-recipe-tree", json.get("format").getAsString());
        assertEquals(1, json.get("version").getAsInt());
        assertEquals("1.12.2",
                json.getAsJsonObject("pack").get("minecraftVersion").getAsString());
        assertEquals("item|example:root", json.get("rootKey").getAsString());
        assertEquals("inputs", json.get("direction").getAsString());
        assertEquals(12,
                json.getAsJsonObject("productionPlan").get("amount").getAsLong());
        JsonArray sharedSelections = json.getAsJsonArray("selections");
        assertEquals(1, sharedSelections.size());
        assertEquals("item|example:input",
                sharedSelections.get(0).getAsJsonObject().get("itemKey").getAsString());
        assertEquals("example:machine|recipe-1", sharedSelections.get(0).getAsJsonObject()
                .getAsJsonObject("source").get("recipeKey").getAsString());
    }

}
