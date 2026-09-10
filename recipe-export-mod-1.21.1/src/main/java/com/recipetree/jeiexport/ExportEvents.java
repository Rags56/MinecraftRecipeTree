package com.recipetree.jeiexport;

import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.world.Difficulty;
import net.minecraft.world.level.GameRules;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.LevelSettings;
import net.minecraft.world.level.WorldDataConfiguration;
import net.minecraft.world.level.levelgen.WorldOptions;
import net.minecraft.world.level.levelgen.presets.WorldPresets;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.EnumSet;
import java.util.Locale;

@EventBusSubscriber(modid = JeiExportMod.MOD_ID, value = Dist.CLIENT)
public final class ExportEvents {
    private ExportEvents() {
    }

    /** Ticks spent in a loaded level, for the auto-export delay. */
    private static int ticksInLevel;
    private static int ticksWithoutLevel;
    private static boolean autoStartAttempted;
    private static boolean autoWorldAttempted;
    private static final int AUTO_START_DELAY_TICKS = 100;

    @SubscribeEvent
    public static void onRegisterClientCommands(RegisterClientCommandsEvent event) {
        ExportCommands.register(event.getDispatcher());
    }

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post event) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.level == null) {
            ticksInLevel = 0;
            ticksWithoutLevel++;
            maybeCreateAutomationWorld(minecraft);
            return;
        }
        ticksWithoutLevel = 0;
        ticksInLevel++;
        ExportJob job = ExportJob.current();
        if (job != null) {
            job.tick();
        } else {
            maybeAutoStart();
        }
    }

    private static void maybeCreateAutomationWorld(Minecraft minecraft) {
        if (autoWorldAttempted
                || ticksWithoutLevel < AUTO_START_DELAY_TICKS
                || System.getProperty("jeiexport.auto") == null
                || minecraft.screen == null
                || minecraft.getOverlay() != null) {
            return;
        }
        try {
            if (!AutomationOptions.createWorldEnabled()) {
                autoWorldAttempted = true;
                return;
            }
            String worldFolder = AutomationOptions.worldFolder();
            String worldName = AutomationOptions.worldName();
            Path save = minecraft.getLevelSource().getBaseDir().resolve(worldFolder);
            if (Files.exists(save, LinkOption.NOFOLLOW_LINKS)) {
                throw new IllegalStateException(
                        "Automation world already exists; choose a new -Djeiexport.worldFolder: " + save);
            }
            autoWorldAttempted = true;
            LevelSettings settings = new LevelSettings(
                    worldName,
                    GameType.CREATIVE,
                    false,
                    Difficulty.PEACEFUL,
                    true,
                    new GameRules(),
                    WorldDataConfiguration.DEFAULT);
            JeiExportMod.LOGGER.info(
                    "[jeiexport] Creating disposable automation world '{}' ({})", worldName, worldFolder);
            minecraft.createWorldOpenFlows().createFreshLevel(
                    worldFolder,
                    settings,
                    WorldOptions.defaultWithRandomSeed(),
                    WorldPresets::createNormalWorldDimensions,
                    minecraft.screen);
        } catch (Exception e) {
            autoWorldAttempted = true;
            JeiExportMod.LOGGER.error("[jeiexport] Failed to create the automation world", e);
        }
    }

    /**
     * Headless/CI mode: launch with -Djeiexport.auto=all|items|recipes|mobs|blockdrops|trades (and optionally
     * -Djeiexport.iconScale=N and -Djeiexport.speed=1..3) to start an export
     * automatically shortly after world load.
     */
    private static void maybeAutoStart() {
        if (autoStartAttempted || ticksInLevel < AUTO_START_DELAY_TICKS) {
            return;
        }
        String auto = System.getProperty("jeiexport.auto");
        if (auto == null || auto.isEmpty()) {
            autoStartAttempted = true;
            return;
        }
        if (JeiExportPlugin.runtime() == null) {
            return; // JEI not ready yet; keep waiting
        }
        autoStartAttempted = true;
        EnumSet<ExportJob.Phase> phases = switch (auto.toLowerCase(Locale.ROOT)) {
            case "all" -> EnumSet.allOf(ExportJob.Phase.class);
            case "items" -> EnumSet.of(ExportJob.Phase.ITEMS);
            case "recipes" -> EnumSet.of(
                    ExportJob.Phase.ITEMS, ExportJob.Phase.RECIPES, ExportJob.Phase.EMC);
            case "mobs" -> EnumSet.of(ExportJob.Phase.MOBS);
            case "blockdrops" -> EnumSet.of(ExportJob.Phase.BLOCK_DROPS);
            case "trades" -> EnumSet.of(ExportJob.Phase.ITEMS, ExportJob.Phase.TRADES);
            default -> null;
        };
        if (phases == null) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Invalid -Djeiexport.auto={} (expected all, items, recipes, mobs, blockdrops, or trades); no export was started",
                    auto);
            return;
        }
        int iconScale = Integer.getInteger(
                "jeiexport.iconScale", ExportManifestContract.DEFAULT_ICON_SCALE);
        try {
            ExportJob.start(JeiExportPlugin.runtime(), phases, iconScale);
            ExportJob.chat("Automatic export started at speed " + ExportJob.speed()
                    + " (" + ExportPacing.label(ExportJob.speed()) + ").",
                    ChatFormatting.GREEN);
        } catch (Exception e) {
            JeiExportMod.LOGGER.error("Auto-export failed to start", e);
        }
    }

    @SubscribeEvent
    public static void onLogout(ClientPlayerNetworkEvent.LoggingOut event) {
        // Framebuffers must be destroyed on the render thread.
        Minecraft.getInstance().execute(ExportJob::abortNow);
    }
}
