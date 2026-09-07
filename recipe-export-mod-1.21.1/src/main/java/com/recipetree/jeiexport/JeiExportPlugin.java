package com.recipetree.jeiexport;

import mezz.jei.api.IModPlugin;
import mezz.jei.api.JeiPlugin;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.resources.ResourceLocation;
import org.jetbrains.annotations.Nullable;

/**
 * Registered with JEI automatically via the {@link JeiPlugin} annotation.
 * Only exists to capture the {@link IJeiRuntime}, which becomes available
 * once the player has joined a world and JEI has finished loading recipes.
 */
@JeiPlugin
public class JeiExportPlugin implements IModPlugin {
    private static final ResourceLocation UID =
            ResourceLocation.fromNamespaceAndPath(JeiExportMod.MOD_ID, "exporter");

    @Nullable
    private static volatile IJeiRuntime runtime;

    @Override
    public void registerCategories(mezz.jei.api.registration.IRecipeCategoryRegistration registration) {
        ProjectEPlanner.registerCategories(registration);
    }

    @Override
    public void registerIngredients(mezz.jei.api.registration.IModIngredientRegistration registration) {
        ProjectEPlanner.register(registration);
    }

    @Override
    public ResourceLocation getPluginUid() {
        return UID;
    }

    @Override
    public void onRuntimeAvailable(IJeiRuntime jeiRuntime) {
        runtime = jeiRuntime;
    }

    @Override
    public void onRuntimeUnavailable() {
        runtime = null;
    }

    @Nullable
    public static IJeiRuntime runtime() {
        return runtime;
    }
}
