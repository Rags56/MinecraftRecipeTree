package com.recipetree.jeiexport112;

import mezz.jei.api.IJeiRuntime;
import mezz.jei.api.IRecipeRegistry;
import mezz.jei.api.ingredients.IIngredientHelper;
import mezz.jei.api.ingredients.IIngredientRegistry;
import mezz.jei.api.ingredients.VanillaTypes;
import mezz.jei.api.recipe.IFocus;
import mezz.jei.api.recipe.IIngredientType;
import mezz.jei.api.recipe.IRecipeCategory;
import mezz.jei.api.recipe.IRecipeWrapper;
import org.junit.Test;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

public class RecipeTreeViewerBridgeTest {
    @Test
    public void semanticFingerprintIsStableAcrossAlternativeOrder() {
        List<List<String>> firstInputs = slots(
                alternatives("item|minecraft:oak_planks\u00001",
                        "item|minecraft:spruce_planks\u00001"),
                alternatives("item|minecraft:iron_ingot\u00002"));
        List<List<String>> reorderedInputs = slots(
                alternatives("item|minecraft:spruce_planks\u00001",
                        "item|minecraft:oak_planks\u00001"),
                alternatives("item|minecraft:iron_ingot\u00002"));
        List<List<String>> outputs = slots(alternatives("item|example:machine\u00001"));

        assertEquals(
                RecipeTreeViewerBridge.semanticRecipeKey("example.crafting", firstInputs, outputs),
                RecipeTreeViewerBridge.semanticRecipeKey("example.crafting", reorderedInputs, outputs));
    }

    @Test
    public void semanticFingerprintPreservesSlotsRepetitionAndQuantities() {
        List<List<String>> oneSlot = slots(alternatives("item|minecraft:iron_ingot\u00001"));
        List<List<String>> repeatedSlot = slots(
                alternatives("item|minecraft:iron_ingot\u00001"),
                alternatives("item|minecraft:iron_ingot\u00001"));
        List<List<String>> twoInOneSlot = slots(alternatives(
                "item|minecraft:iron_ingot\u00001",
                "item|minecraft:iron_ingot\u00001"));
        List<List<String>> quantityChanged = slots(
                alternatives("item|minecraft:iron_ingot\u00002"));
        List<List<String>> output = slots(alternatives("item|example:plate\u00001"));

        String baseline = RecipeTreeViewerBridge.semanticRecipeKey(
                "example.press", oneSlot, output);
        assertNotEquals(baseline, RecipeTreeViewerBridge.semanticRecipeKey(
                "example.press", repeatedSlot, output));
        assertNotEquals(baseline, RecipeTreeViewerBridge.semanticRecipeKey(
                "example.press", twoInOneSlot, output));
        assertNotEquals(baseline, RecipeTreeViewerBridge.semanticRecipeKey(
                "example.press", quantityChanged, output));
    }

    @Test
    public void semanticFingerprintChangesWithSlotOrderOutputAndCategory() {
        List<List<String>> ordered = slots(
                alternatives("item|example:a\u00001"),
                alternatives("item|example:b\u00001"));
        List<List<String>> reversed = slots(
                alternatives("item|example:b\u00001"),
                alternatives("item|example:a\u00001"));
        List<List<String>> firstOutput = slots(alternatives("item|example:out\u00001"));
        List<List<String>> secondOutput = slots(alternatives("item|example:out\u00002"));

        String baseline = RecipeTreeViewerBridge.semanticRecipeKey(
                "example.machine_a", ordered, firstOutput);
        assertNotEquals(baseline, RecipeTreeViewerBridge.semanticRecipeKey(
                "example.machine_a", reversed, firstOutput));
        assertNotEquals(baseline, RecipeTreeViewerBridge.semanticRecipeKey(
                "example.machine_a", ordered, secondOutput));
        assertNotEquals(baseline, RecipeTreeViewerBridge.semanticRecipeKey(
                "example.machine_b", ordered, firstOutput));
    }

    @Test
    public void thaumicCrucibleCatalystStacksBecomeOneAlternativeSlot() {
        RecipeTreeViewerBridge.Ingredient quartz = testItemIngredient("item|example:quartz");
        RecipeTreeViewerBridge.Ingredient quartzNugget =
                testItemIngredient("item|example:quartz_nugget");
        RecipeTreeViewerBridge.Ingredient quartzSliver =
                testItemIngredient("item|example:quartz_sliver");
        RecipeTreeViewerBridge.Ingredient luna = testIngredient("aspect|luna");
        List<RecipeTreeViewerBridge.Slot> inputs = Arrays.asList(
                new RecipeTreeViewerBridge.Slot(Collections.singletonList(quartz)),
                new RecipeTreeViewerBridge.Slot(Collections.singletonList(quartzNugget)),
                new RecipeTreeViewerBridge.Slot(Collections.singletonList(quartzSliver)),
                new RecipeTreeViewerBridge.Slot(Collections.singletonList(luna)));

        List<RecipeTreeViewerBridge.Slot> normalized =
                RecipeTreeViewerBridge.normalizeThaumicCrucibleInputs(
                        RecipeTreeViewerBridge.THAUMIC_CRUCIBLE_CATEGORY_UID,
                        "com.buuz135.thaumicjei.category.CrucibleCategory$CrucibleWrapper",
                        inputs);

        assertEquals(2, normalized.size());
        assertEquals(Arrays.asList(quartz, quartzNugget, quartzSliver),
                normalized.get(0).getAlternatives());
        assertEquals(Collections.singletonList(luna), normalized.get(1).getAlternatives());
    }

    @Test
    public void nonCrucibleRecipesKeepSeparateItemSlots() {
        List<RecipeTreeViewerBridge.Slot> inputs = Arrays.asList(
                new RecipeTreeViewerBridge.Slot(Collections.singletonList(
                        testItemIngredient("item|example:first"))),
                new RecipeTreeViewerBridge.Slot(Collections.singletonList(
                        testItemIngredient("item|example:second"))));

        assertSame(inputs, RecipeTreeViewerBridge.normalizeThaumicCrucibleInputs(
                "minecraft.crafting", "example.CraftingWrapper", inputs));
    }

    @Test
    public void metadataCategoriesAreFilteredWithoutHidingRecipes() {
        assertTrue(RecipeTreeViewerBridge.isMetaCategory("jei.information"));
        assertTrue(RecipeTreeViewerBridge.isMetaCategory("jei:information"));
        assertTrue(RecipeTreeViewerBridge.isMetaCategory("jei.description"));
        assertTrue(RecipeTreeViewerBridge.isMetaCategory("jei:description"));
        assertFalse(RecipeTreeViewerBridge.isMetaCategory("minecraft.crafting"));
        assertFalse(RecipeTreeViewerBridge.isMetaCategory("example:information_processing"));
    }

    @Test
    public void emcRecipeUsesTheProjectETransmutationCardAndExactAmount() {
        RecipeTreeViewerBridge.Ingredient emc =
                RecipeTreeViewerBridge.Ingredient.emc(new BigDecimal("8192"));
        RecipeTreeViewerBridge.Ingredient output = testIngredient("item|minecraft:diamond");
        RecipeTreeViewerBridge.Recipe recipe = RecipeTreeViewerBridge.Recipe.emc(
                output.getKey(), null,
                Collections.singletonList(new RecipeTreeViewerBridge.Slot(
                        Collections.singletonList(emc))),
                Collections.singletonList(new RecipeTreeViewerBridge.Slot(
                        Collections.singletonList(output))));

        assertTrue(emc.isEmc());
        assertEquals("8192", emc.getAmount().toPlainString());
        assertTrue(recipe.isEmcTransmutation());
        assertEquals(RecipeTreeViewerBridge.EMC_CATEGORY_UID, recipe.getCategoryUid());
        assertEquals(86, recipe.getWidth());
        assertEquals(78, recipe.getHeight());
    }

    @Test
    public void nativeLayoutCacheHasTheDocumentedBound() {
        assertEquals(64, RecipeTreeViewerBridge.MAX_CACHED_LAYOUTS);
    }

    @Test
    public void focusedSemanticQueryCacheReusesResultsAndEvictsAtItsHardBound() {
        final AtomicInteger categoryQueries = new AtomicInteger();
        IRecipeRegistry recipeRegistry = proxy(IRecipeRegistry.class, new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] arguments) {
                if ("createFocus".equals(method.getName())) {
                    return proxy(IFocus.class, returningDefaults());
                }
                if ("getRecipeCategories".equals(method.getName())) {
                    categoryQueries.incrementAndGet();
                    return Collections.emptyList();
                }
                return defaultValue(method.getReturnType());
            }
        });
        RecipeTreeViewerBridge bridge = bridge(recipeRegistry,
                proxy(IIngredientRegistry.class, returningDefaults()));

        RecipeTreeViewerBridge.Ingredient first = testIngredient("custom|focus-0");
        assertTrue(bridge.query(first, IFocus.Mode.INPUT).isEmpty());
        assertTrue(bridge.query(first, IFocus.Mode.INPUT).isEmpty());
        assertEquals(1, categoryQueries.get());

        for (int index = 1; index <= RecipeTreeViewerBridge.MAX_CACHED_QUERIES; index++) {
            bridge.query(testIngredient("custom|focus-" + index), IFocus.Mode.INPUT);
        }
        assertEquals(RecipeTreeViewerBridge.MAX_CACHED_QUERIES,
                bridge.semanticQueryCacheSizeForTesting());
        assertEquals(0, bridge.semanticQueryCacheRecipeCountForTesting());
        assertEquals(RecipeTreeViewerBridge.MAX_CACHED_QUERIES + 1, categoryQueries.get());

        // focus-0 was the least recently used entry and must be queried again.
        bridge.query(first, IFocus.Mode.INPUT);
        assertEquals(RecipeTreeViewerBridge.MAX_CACHED_QUERIES + 2, categoryQueries.get());
        bridge.clearSemanticQueries();
        assertEquals(0, bridge.semanticQueryCacheSizeForTesting());
    }

    @Test
    public void incompleteSemanticQueryCachesItsSuccessfulSubsetAndLogsEachFailureShapeOnce() {
        final AtomicInteger categoryQueries = new AtomicInteger();
        final IRecipeCategory<?> category = proxy(IRecipeCategory.class,
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] arguments) {
                        if ("getUid".equals(method.getName())) return "example.machine";
                        if ("getTitle".equals(method.getName())) return "Example Machine";
                        return defaultValue(method.getReturnType());
                    }
                });
        final IRecipeWrapper wrapper = proxy(IRecipeWrapper.class, returningDefaults());
        IRecipeRegistry recipeRegistry = proxy(IRecipeRegistry.class, new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] arguments) {
                if ("createFocus".equals(method.getName())) {
                    return proxy(IFocus.class, returningDefaults());
                }
                if ("getRecipeCategories".equals(method.getName())) {
                    categoryQueries.incrementAndGet();
                    return Collections.singletonList(category);
                }
                if ("getRecipeWrappers".equals(method.getName())) {
                    return Collections.singletonList(wrapper);
                }
                if ("getRecipeCatalysts".equals(method.getName())) {
                    return Collections.emptyList();
                }
                return defaultValue(method.getReturnType());
            }
        });
        RecipeTreeViewerBridge bridge = bridge(recipeRegistry,
                proxy(IIngredientRegistry.class, returningDefaults()));
        RecipeTreeViewerBridge.Ingredient focus = testIngredient("custom|incomplete");

        assertTrue(bridge.query(focus, IFocus.Mode.OUTPUT).isEmpty());
        assertTrue(bridge.query(focus, IFocus.Mode.OUTPUT).isEmpty());

        assertEquals(1, categoryQueries.get());
        assertEquals(1, bridge.semanticQueryCacheSizeForTesting());
        assertEquals(1, bridge.semanticFailureSignatureCountForTesting());
    }

    @Test
    public void lightweightAvailabilityCheckDoesNotRecordRecipeSemanticsPerTreeNode() {
        final AtomicInteger categoryQueries = new AtomicInteger();
        final AtomicInteger wrapperLookups = new AtomicInteger();
        final IRecipeCategory<?> category = proxy(IRecipeCategory.class,
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] arguments) {
                        if ("getUid".equals(method.getName())) return "example.machine";
                        return defaultValue(method.getReturnType());
                    }
                });
        final IRecipeWrapper wrapper = proxy(IRecipeWrapper.class, returningDefaults());
        IRecipeRegistry recipeRegistry = proxy(IRecipeRegistry.class, new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] arguments) {
                if ("createFocus".equals(method.getName())) {
                    return proxy(IFocus.class, returningDefaults());
                }
                if ("getRecipeCategories".equals(method.getName())) {
                    categoryQueries.incrementAndGet();
                    return Collections.singletonList(category);
                }
                if ("getRecipeWrappers".equals(method.getName())) {
                    wrapperLookups.incrementAndGet();
                    return Collections.singletonList(wrapper);
                }
                return defaultValue(method.getReturnType());
            }
        });
        RecipeTreeViewerBridge bridge = bridge(recipeRegistry,
                proxy(IIngredientRegistry.class, returningDefaults()));
        RecipeTreeViewerBridge.Ingredient focus = testIngredient("custom|available");

        assertTrue(bridge.hasRecipes(focus, IFocus.Mode.OUTPUT));
        assertTrue(bridge.hasRecipes(focus, IFocus.Mode.OUTPUT));

        assertEquals(1, categoryQueries.get());
        assertEquals(1, wrapperLookups.get());
        assertEquals(1, bridge.recipeAvailabilityCacheSizeForTesting());
        assertEquals(0, bridge.semanticFailureSignatureCountForTesting());
    }

    @Test
    @SuppressWarnings("unchecked")
    public void savedCustomIngredientIsRestoredByItsRegisteredTypePrefix() {
        final TestGas gas = new TestGas("hydrogen", 40);
        final IIngredientType<TestGas> gasType = new IIngredientType<TestGas>() {
            @Override
            public Class<? extends TestGas> getIngredientClass() {
                return TestGas.class;
            }
        };
        final AtomicInteger registryScans = new AtomicInteger();
        final IIngredientHelper<TestGas> helper = (IIngredientHelper<TestGas>) proxy(IIngredientHelper.class,
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] arguments) {
                        if ("getUniqueId".equals(method.getName())) {
                            return "test:hydrogen";
                        }
                        if ("getResourceId".equals(method.getName())) {
                            return "test:hydrogen";
                        }
                        if ("getDisplayName".equals(method.getName())) {
                            return "Hydrogen";
                        }
                        if ("getDisplayModId".equals(method.getName())) {
                            return "Test";
                        }
                        return defaultValue(method.getReturnType());
                    }
                });
        IIngredientRegistry ingredientRegistry = proxy(IIngredientRegistry.class,
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] arguments) {
                        if ("getRegisteredIngredientTypes".equals(method.getName())) {
                            return Collections.<IIngredientType<?>>singletonList(gasType);
                        }
                        if ("getAllIngredients".equals(method.getName())) {
                            registryScans.incrementAndGet();
                            return Collections.singletonList(gas);
                        }
                        if ("getIngredientHelper".equals(method.getName())) {
                            return helper;
                        }
                        if ("getIngredientType".equals(method.getName())) {
                            return gasType;
                        }
                        return defaultValue(method.getReturnType());
                    }
                });
        RecipeTreeViewerBridge bridge = bridge(
                proxy(IRecipeRegistry.class, returningDefaults()), ingredientRegistry);

        String className = TestGas.class.getName().toLowerCase(Locale.ROOT);
        String key = "custom_" + Naming.sanitize(className) + "_" + Naming.hash8(className) +
                "|test:hydrogen";
        RecipeTreeViewerBridge.Ingredient restored = bridge.findIngredient(key);

        assertEquals(key, restored.getKey());
        assertEquals("Hydrogen", restored.getDisplayName());
        assertEquals("40", restored.getAmount().toPlainString());
        assertSame(gasType, restored.getType());
        assertEquals(1, registryScans.get());
        assertEquals(restored, bridge.findIngredient(key));
        assertEquals(1, registryScans.get());
    }

    @Test
    public void vanillaFluidHistoryKeysSelectAndScanTheRegisteredFluidFamily() {
        // Constructing FluidStack starts Minecraft's global block bootstrap, which is deliberately
        // absent from these unit tests. The custom-gas test above exercises conversion; this test
        // verifies that a saved fluid key scans the fluid registry rather than the item registry.
        assertEquals("fluid", RecipeTreeViewerBridge.ingredientPrefix(VanillaTypes.FLUID));
        final AtomicInteger fluidScans = new AtomicInteger();
        IIngredientRegistry ingredientRegistry = proxy(IIngredientRegistry.class,
                new InvocationHandler() {
                    @Override
                    public Object invoke(Object proxy, Method method, Object[] arguments) {
                        if ("getRegisteredIngredientTypes".equals(method.getName())) {
                            return Collections.<IIngredientType<?>>singletonList(VanillaTypes.FLUID);
                        }
                        if ("getAllIngredients".equals(method.getName())) {
                            assertSame(VanillaTypes.FLUID, arguments[0]);
                            fluidScans.incrementAndGet();
                            return Collections.emptyList();
                        }
                        return defaultValue(method.getReturnType());
                    }
                });
        RecipeTreeViewerBridge bridge = bridge(
                proxy(IRecipeRegistry.class, returningDefaults()), ingredientRegistry);

        assertNull(bridge.findIngredient("fluid|test:steam"));
        assertEquals(1, fluidScans.get());
    }

    @Test
    public void historyRestoreAndQueryCachesExposeDocumentedHardBounds() {
        assertEquals(RecipeTreeModel.MAX_NODES, RecipeTreeViewerBridge.MAX_CACHED_QUERIES);
        assertEquals(4096, RecipeTreeViewerBridge.MAX_CACHED_QUERY_RECIPES);
        assertEquals(1024, RecipeTreeViewerBridge.MAX_RECIPES_PER_CACHED_QUERY);
        assertEquals(4096, RecipeTreeViewerBridge.MAX_CACHED_AVAILABILITY_QUERIES);
        assertEquals(32768, RecipeTreeViewerBridge.MAX_CACHED_INGREDIENTS);
        assertEquals(128, RecipeTreeViewerBridge.MAX_REGISTERED_INGREDIENT_TYPES);
        assertEquals(250000, RecipeTreeViewerBridge.MAX_RESTORE_LOOKUP_SCAN_PER_TYPE);
        assertEquals(300000, RecipeTreeViewerBridge.MAX_RESTORE_LOOKUP_SCAN_TOTAL);
    }

    @SafeVarargs
    private static List<List<String>> slots(List<String>... slots) {
        return new ArrayList<List<String>>(Arrays.asList(slots));
    }

    private static List<String> alternatives(String... values) {
        return new ArrayList<String>(Arrays.asList(values));
    }

    private static RecipeTreeViewerBridge.Ingredient testIngredient(String key) {
        return new RecipeTreeViewerBridge.Ingredient(null, key, key, key, BigDecimal.ONE);
    }

    private static RecipeTreeViewerBridge.Ingredient testItemIngredient(String key) {
        return new RecipeTreeViewerBridge.Ingredient(
                VanillaTypes.ITEM, key, key, key, BigDecimal.ONE);
    }

    private static RecipeTreeViewerBridge bridge(final IRecipeRegistry recipes,
                                                 IIngredientRegistry ingredients) {
        IJeiRuntime runtime = proxy(IJeiRuntime.class, new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] arguments) {
                if ("getRecipeRegistry".equals(method.getName())) {
                    return recipes;
                }
                return defaultValue(method.getReturnType());
            }
        });
        return new RecipeTreeViewerBridge(runtime, ingredients);
    }

    private static InvocationHandler returningDefaults() {
        return new InvocationHandler() {
            @Override
            public Object invoke(Object proxy, Method method, Object[] arguments) {
                return defaultValue(method.getReturnType());
            }
        };
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler);
    }

    private static Object defaultValue(Class<?> type) {
        if (!type.isPrimitive()) {
            return null;
        }
        if (type == Boolean.TYPE) {
            return false;
        }
        if (type == Character.TYPE) {
            return '\0';
        }
        if (type == Byte.TYPE) {
            return (byte) 0;
        }
        if (type == Short.TYPE) {
            return (short) 0;
        }
        if (type == Integer.TYPE) {
            return 0;
        }
        if (type == Long.TYPE) {
            return 0L;
        }
        if (type == Float.TYPE) {
            return 0F;
        }
        if (type == Double.TYPE) {
            return 0D;
        }
        return null;
    }

    public static final class TestGas {
        private final String name;
        private final int amount;

        TestGas(String name, int amount) {
            this.name = name;
            this.amount = amount;
        }

        public String getName() {
            return name;
        }

        public int getAmount() {
            return amount;
        }
    }
}
