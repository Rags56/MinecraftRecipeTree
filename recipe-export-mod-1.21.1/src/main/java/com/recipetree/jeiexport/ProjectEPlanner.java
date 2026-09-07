package com.recipetree.jeiexport;

import java.util.List;
import java.util.Optional;
import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.gui.builder.IRecipeLayoutBuilder;
import mezz.jei.api.gui.drawable.IDrawable;
import mezz.jei.api.gui.ingredient.IRecipeSlotsView;
import mezz.jei.api.helpers.IGuiHelper;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRenderer;
import mezz.jei.api.ingredients.IIngredientType;
import mezz.jei.api.ingredients.subtypes.UidContext;
import mezz.jei.api.recipe.IFocusGroup;
import mezz.jei.api.recipe.RecipeIngredientRole;
import mezz.jei.api.recipe.RecipeType;
import mezz.jei.api.recipe.category.IRecipeCategory;
import mezz.jei.api.registration.IModIngredientRegistration;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.TooltipFlag;
import net.neoforged.fml.ModList;

/** Queries ProjectE only for the requested output; never enumerates the EMC registry. */
final class ProjectEPlanner {
    static final IIngredientType<Emc> EMC = () -> Emc.class;
    static final ResourceLocation ID = ResourceLocation.fromNamespaceAndPath("projecte", "emc");
    private static ProjectEEmcExporter.EmcProxy proxy;
    private static boolean attempted;
    private static boolean failed;
    record Emc(long amount) {}
    record Recipe(ItemStack output, long cost) {}

    static void registerCategories(mezz.jei.api.registration.IRecipeCategoryRegistration registration) {
        if (ModList.get().isLoaded("projecte")) registration.addRecipeCategories(new Category(registration.getJeiHelpers().getGuiHelper()));
    }

    static void register(IModIngredientRegistration registration) {
        if (!ModList.get().isLoaded("projecte")) return;
        attempted = false;
        failed = false;
        registration.register(EMC, List.of(new Emc(1)), new Helper(), new Renderer());
    }

    static Optional<Recipe> recipe(ItemStack output) {
        if (output.isEmpty() || !ModList.get().isLoaded("projecte") || failed) return Optional.empty();
        try {
            if (!attempted) { attempted = true; proxy = ProjectEEmcExporter.EmcProxy.load(); }
            if (proxy == null || !proxy.hasValue(output)) return Optional.empty();
            long cost = proxy.value(output);
            return cost > 0 ? Optional.of(new Recipe(output.copyWithCount(1), cost)) : Optional.empty();
        } catch (ReflectiveOperationException | RuntimeException error) {
            failed = true;
            JeiExportMod.LOGGER.error("ProjectE live EMC recipes are unavailable: its EMC API failed", error);
            return Optional.empty();
        }
    }

    static final class Category implements IRecipeCategory<Recipe> {
        private final IDrawable background;
        Category(IGuiHelper gui) { background = gui.createBlankDrawable(80, 86); }
        @Override public RecipeType<Recipe> getRecipeType() { return RecipeType.create("projecte", "emc_transmutation", Recipe.class); }
        @Override public Component getTitle() { return Component.literal("EMC Transmutation"); }
        @Override public IDrawable getBackground() { return background; }
        @Override public IDrawable getIcon() { return null; }
        @Override public ResourceLocation getRegistryName(Recipe recipe) {
            return ResourceLocation.fromNamespaceAndPath("projecte", "emc/" + Naming.hash8("item|" + JeiExportPlugin.runtime().getIngredientManager().getIngredientHelper(VanillaTypes.ITEM_STACK).getUniqueId(recipe.output, UidContext.Ingredient)));
        }
        @Override public void setRecipe(IRecipeLayoutBuilder builder, Recipe recipe, IFocusGroup focuses) {
            builder.addSlot(RecipeIngredientRole.OUTPUT, 32, 24).addItemStack(recipe.output);
            builder.addSlot(RecipeIngredientRole.INPUT, 2, 66).addIngredient(EMC, new Emc(recipe.cost));
        }
        @Override public void draw(Recipe recipe, IRecipeSlotsView slots, GuiGraphics graphics, double mouseX, double mouseY) {
            graphics.blit(ResourceLocation.fromNamespaceAndPath("projecte", "textures/gui/transmute.png"), 0, 0, 8, 16, 80, 62);
            String cost = Long.toString(recipe.cost);
            var font = Minecraft.getInstance().font;
            float scale = Math.min(1.0f, 56.0f / Math.max(1, font.width(cost)));
            graphics.pose().pushPose();
            graphics.pose().translate(20, 70, 10);
            graphics.pose().scale(scale, scale, 1);
            graphics.drawString(font, cost, 0, 0, 0xffdddddd, false);
            graphics.pose().popPose();
        }
    }

    private static final class Helper implements IIngredientHelper<Emc> {
        @Override public IIngredientType<Emc> getIngredientType() { return EMC; }
        @Override public String getDisplayName(Emc emc) { return "EMC"; }
        @Override public String getUniqueId(Emc emc, UidContext context) { return "projecte:emc"; }
        @Override public ResourceLocation getResourceLocation(Emc emc) { return ID; }
        @Override public Emc copyIngredient(Emc emc) { return emc; }
        @Override public String getErrorInfo(Emc emc) { return "EMC " + emc.amount; }
    }

    private static final class Renderer implements IIngredientRenderer<Emc> {
        @Override public void render(GuiGraphics graphics, Emc emc) {
            graphics.drawString(Minecraft.getInstance().font, "E", 4, 4, 0xff8aeed5, false);
        }
        @Override public List<Component> getTooltip(Emc emc, TooltipFlag flag) {
            return List.of(Component.literal("EMC"), Component.literal(Long.toString(emc.amount)));
        }
    }
}
