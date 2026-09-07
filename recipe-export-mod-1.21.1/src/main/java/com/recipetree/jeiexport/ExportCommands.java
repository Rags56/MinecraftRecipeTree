package com.recipetree.jeiexport;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

import java.util.EnumSet;

/**
 * /jeiexport all [iconScale]     - items + recipes + mobs
 * /jeiexport items [iconScale]   - just the ingredient catalog + icons
 * /jeiexport recipes [iconScale] - recipes (includes the item catalog, recipes reference it)
 * /jeiexport mobs                - renders of every living entity
 * /jeiexport rebuild [iconScale] - ignores the compatible previous snapshot and rebuilds everything
 * /jeiexport speed [1-3]         - report/change the export pacing preset
 * /jeiexport status | cancel
 */
public final class ExportCommands {
    private ExportCommands() {
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("jeiexport")
                .then(startLiteral("all", EnumSet.allOf(ExportJob.Phase.class)))
                .then(startLiteral("items", EnumSet.of(ExportJob.Phase.ITEMS)))
                .then(startLiteral("recipes", EnumSet.of(
                        ExportJob.Phase.ITEMS, ExportJob.Phase.RECIPES, ExportJob.Phase.EMC)))
                .then(startLiteral("mobs", EnumSet.of(ExportJob.Phase.MOBS)))
                .then(startLiteral("blockdrops", EnumSet.of(ExportJob.Phase.BLOCK_DROPS)))
                .then(startLiteral("trades", EnumSet.of(ExportJob.Phase.ITEMS, ExportJob.Phase.TRADES)))
                .then(startLiteral("rebuild", EnumSet.allOf(ExportJob.Phase.class), true))
                .then(Commands.literal("speed")
                        .executes(ctx -> reportSpeed(ctx.getSource()))
                        .then(Commands.argument("level", IntegerArgumentType.integer(
                                        ExportPacing.SLOW,
                                        ExportPacing.TURBO))
                                .executes(ctx -> setSpeed(
                                        ctx.getSource(),
                                        IntegerArgumentType.getInteger(ctx, "level")))))
                .then(Commands.literal("status").executes(ctx -> {
                    ExportJob job = ExportJob.current();
                    if (job == null) {
                        ctx.getSource().sendSuccess(() -> prefixed("Nothing is being exported right now.", ChatFormatting.GRAY), false);
                    } else {
                        ctx.getSource().sendSuccess(() -> prefixed(job.statusLine(), ChatFormatting.AQUA), false);
                    }
                    return 1;
                }))
                .then(Commands.literal("cancel").executes(ctx -> {
                    if (ExportJob.cancel()) {
                        ctx.getSource().sendSuccess(() -> prefixed("Stopping the export safely…", ChatFormatting.YELLOW), false);
                        return 1;
                    }
                    ctx.getSource().sendFailure(prefixed("Nothing is being exported right now.", ChatFormatting.RED));
                    return 0;
                })));
    }

    private static int reportSpeed(CommandSourceStack source) {
        int speed = ExportJob.speed();
        source.sendSuccess(() -> prefixed(
                speedDescription(speed),
                ChatFormatting.AQUA), false);
        return speed;
    }

    private static int setSpeed(CommandSourceStack source, int speed) {
        ExportJob.setSpeed(speed);
        String timing = ExportJob.current() == null
                ? "The next export will use it."
                : "The running export will use it beginning next tick.";
        source.sendSuccess(() -> prefixed(
                speedDescription(speed) + " " + timing,
                ChatFormatting.GREEN), false);
        return speed;
    }

    private static String speedDescription(int speed) {
        return "Speed " + speed + " selected (" + ExportPacing.label(speed) + "). "
                + "1 keeps the game smoother, 2 is normal, and 3 finishes as quickly as possible.";
    }

    private static LiteralArgumentBuilder<CommandSourceStack> startLiteral(String name, EnumSet<ExportJob.Phase> phases) {
        return startLiteral(name, phases, false);
    }

    private static LiteralArgumentBuilder<CommandSourceStack> startLiteral(
            String name,
            EnumSet<ExportJob.Phase> phases,
            boolean forceRebuild) {
        return Commands.literal(name)
                .executes(ctx -> start(
                        ctx.getSource(), phases, ExportManifestContract.DEFAULT_ICON_SCALE, forceRebuild))
                .then(Commands.argument("iconScale", IntegerArgumentType.integer(1, 16))
                        .executes(ctx -> start(
                                ctx.getSource(),
                                phases,
                                IntegerArgumentType.getInteger(ctx, "iconScale"),
                                forceRebuild)));
    }

    private static int start(
            CommandSourceStack source,
            EnumSet<ExportJob.Phase> phases,
            int iconScale,
            boolean forceRebuild) {
        if (ExportJob.current() != null) {
            source.sendFailure(prefixed("An export is already running. Stop it with /jeiexport cancel first.", ChatFormatting.RED));
            return 0;
        }

        boolean needsJei = phases.contains(ExportJob.Phase.ITEMS)
                || phases.contains(ExportJob.Phase.RECIPES)
                || phases.contains(ExportJob.Phase.EMC);
        IJeiRuntime runtime = JeiExportPlugin.runtime();
        if (needsJei && runtime == null) {
            source.sendFailure(prefixed("JEI is not ready yet. Make sure JEI is installed and wait for the world to finish loading.", ChatFormatting.RED));
            return 0;
        }

        try {
            ExportJob.start(runtime, phases, iconScale, forceRebuild);
        } catch (Exception e) {
            JeiExportMod.LOGGER.error("Failed to start export", e);
            source.sendFailure(prefixed("The export could not start. Check the game log for details.", ChatFormatting.RED));
            return 0;
        }
        source.sendSuccess(() -> prefixed("Exporting " + friendlyExportName(phases) + " at speed "
                + ExportJob.speed() + ". "
                + (forceRebuild
                ? "Starting fresh instead of using the last export. "
                : "Keeping anything that is already up to date. ")
                + "Use /jeiexport speed <1-3> to change the speed.",
                ChatFormatting.GREEN), false);
        return 1;
    }

    private static String friendlyExportName(EnumSet<ExportJob.Phase> phases) {
        if (phases.equals(EnumSet.allOf(ExportJob.Phase.class))) return "everything";
        if (phases.equals(EnumSet.of(ExportJob.Phase.ITEMS))) return "items";
        if (phases.equals(EnumSet.of(
                ExportJob.Phase.ITEMS, ExportJob.Phase.RECIPES, ExportJob.Phase.EMC))) {
            return "items and recipes";
        }
        if (phases.equals(EnumSet.of(ExportJob.Phase.MOBS))) return "creatures";
        if (phases.equals(EnumSet.of(ExportJob.Phase.BLOCK_DROPS))) return "block drops";
        if (phases.equals(EnumSet.of(ExportJob.Phase.ITEMS, ExportJob.Phase.TRADES))) return "trades";
        return "the selected data";
    }

    private static Component prefixed(String message, ChatFormatting color) {
        return Component.literal("[JEI Export] " + message).withStyle(color);
    }
}
