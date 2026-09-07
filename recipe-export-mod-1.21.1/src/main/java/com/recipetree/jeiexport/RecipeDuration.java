package com.recipetree.jeiexport;

import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.RecipeHolder;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.List;
import java.util.OptionalLong;

/** Extracts the processing time that JEI-backed recipe objects expose to their layouts. */
final class RecipeDuration {
    private static final List<String> DURATION_METHODS = List.of(
            "getDurationTicks",
            "getDurationInTicks",
            "getTimeTicks",
            "getTickTime",
            "getProcessingTicks",
            "getProcessTicks",
            "getProcessingTime",
            "getProcessTime",
            "getBaseDuration",
            "getRecipeTime",
            "getCookTime",
            "getCookingTime",
            "getDuration",
            "getTicks",
            "getTime"
    );
    private static final List<String> TOTAL_ENERGY_METHODS = List.of(
            "getTotalEnergy",
            "getRequiredEnergy",
            "getEnergyRequired",
            "getTotalPower",
            "getTotalEU",
            "getTotalFE"
    );
    private static final List<String> ENERGY_PER_TICK_METHODS = List.of(
            "getEnergyPerTick",
            "getPowerPerTick",
            "getEnergyRate",
            "getEUt",
            "getRfPerTick",
            "getRFPerTick",
            "getFEPerTick",
            "getUsagePerTick"
    );

    private RecipeDuration() {}

    static OptionalLong ticks(Object recipe) {
        if (recipe == null) return OptionalLong.empty();
        if (recipe instanceof RecipeHolder<?> holder) return ticks(holder.value());
        if (recipe instanceof AbstractCookingRecipe cookingRecipe
                && cookingRecipe.getCookingTime() > 0) {
            return OptionalLong.of(cookingRecipe.getCookingTime());
        }
        OptionalLong direct = firstPositiveIntegral(recipe, DURATION_METHODS);
        if (direct.isPresent()) return direct;

        OptionalLong totalEnergy = firstPositiveIntegral(recipe, TOTAL_ENERGY_METHODS);
        OptionalLong energyPerTick = firstPositiveIntegral(recipe, ENERGY_PER_TICK_METHODS);
        if (totalEnergy.isEmpty() || energyPerTick.isEmpty()) return OptionalLong.empty();
        long total = totalEnergy.getAsLong();
        long perTick = energyPerTick.getAsLong();
        if (total % perTick != 0) return OptionalLong.empty();
        long ticks = total / perTick;
        return ticks > 0 ? OptionalLong.of(ticks) : OptionalLong.empty();
    }

    private static OptionalLong firstPositiveIntegral(Object target, List<String> methodNames) {
        for (String methodName : methodNames) {
            try {
                Method method = target.getClass().getMethod(methodName);
                if (method.getParameterCount() != 0) continue;
                if (!method.canAccess(target) && !method.trySetAccessible()) continue;
                Object value = method.invoke(target);
                if (!(value instanceof Number number)) continue;
                double floating = number.doubleValue();
                long integral = number.longValue();
                if (Double.isFinite(floating)
                        && floating > 0
                        && integral > 0
                        && Math.abs(floating - integral) < 1e-9) {
                    return OptionalLong.of(integral);
                }
            } catch (NoSuchMethodException ignored) {
                // Try the next conventional JEI/mod recipe accessor.
            } catch (IllegalAccessException | InvocationTargetException | RuntimeException error) {
                JeiExportMod.LOGGER.warn("Recipe timing accessor {}.{} failed",
                        target.getClass().getName(), methodName, error);
            }
        }
        return OptionalLong.empty();
    }
}
