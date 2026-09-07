package com.recipetree.jeiexport;

import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.HoverEvent;
import net.minecraft.network.chat.MutableComponent;
import org.jetbrains.annotations.Nullable;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.EnumSet;
import java.util.Locale;

/**
 * Tick-driven export state machine. All rendering happens on the render thread in
 * time-budgeted slices each client tick, so the game stays responsive even when a
 * modpack has six figures of recipes. PNG encoding happens on the IO pool.
 */
public final class ExportJob {
    public enum Phase {ITEMS, RECIPES, EMC, MOBS, BLOCK_DROPS, TRADES}

    /**
     * Cooperative render-thread budget. Volatile so /jeiexport speed takes effect
     * on the next tick even while an export is running.
     */
    private static volatile int speed = initialSpeed();

    @Nullable
    private static ExportJob current;

    private final ExportContext ctx;
    private final Deque<Phase> remaining;
    @Nullable
    private final IJeiRuntime runtime;
    @Nullable
    private PhaseRunner runner;
    private boolean cancelled;
    private boolean cancellationPrepared;
    private boolean contextClosed;
    private final long startedAtMillis = System.currentTimeMillis();

    public interface PhaseRunner {
        /** Performs one unit of work. @return true when the phase is finished. */
        boolean step() throws Exception;

        String label();

        int done();

        int total();

        default void close() throws IOException {
        }
    }

    private ExportJob(@Nullable IJeiRuntime runtime, EnumSet<Phase> phases, ExportContext ctx) {
        this.runtime = runtime;
        this.ctx = ctx;
        // EnumSet iterates in declaration order: ITEMS, RECIPES, MOBS.
        this.remaining = new ArrayDeque<>(phases);
    }

    public static synchronized void start(@Nullable IJeiRuntime runtime, EnumSet<Phase> phases, int iconScale) throws IOException {
        start(runtime, phases, iconScale, false);
    }

    public static synchronized void start(
            @Nullable IJeiRuntime runtime,
            EnumSet<Phase> phases,
            int iconScale,
            boolean forceRebuild) throws IOException {
        if (current != null) {
            throw new IllegalStateException("An export is already running");
        }
        if (phases.isEmpty()) {
            throw new IllegalArgumentException("At least one export phase is required");
        }
        if (iconScale < 1 || iconScale > 16) {
            throw new IllegalArgumentException("iconScale must be between 1 and 16");
        }
        var gameDirectory = Minecraft.getInstance().gameDirectory.toPath();
        PackIdentity packIdentity = PackIdentityResolver.resolve(gameDirectory);
        ExportContext ctx = new ExportContext(
                gameDirectory.resolve("jei-exports"), iconScale, packIdentity, forceRebuild);
        current = new ExportJob(runtime, phases, ctx);
    }

    @Nullable
    public static ExportJob current() {
        return current;
    }

    public static boolean cancel() {
        ExportJob job = current;
        if (job == null) {
            return false;
        }
        job.cancelled = true;
        return true;
    }

    /** Immediate cleanup (e.g. when leaving the world). Must run on the render thread. */
    public static synchronized void abortNow() {
        ExportJob job = current;
        if (job != null) {
            try {
                job.finish(true);
            } catch (Exception e) {
                JeiExportMod.LOGGER.error("Failed to clean up export", e);
                current = null;
            }
        }
    }

    public String statusLine() {
        PhaseRunner r = this.runner;
        if (r == null) {
            return "Getting ready… Speed " + speed + " (" + ExportPacing.label(speed) + ")";
        }
        return String.format(Locale.ROOT, "%s: %,d of %,d · Speed %d · %s",
                friendlyProgressLabel(r.label()),
                r.done(),
                r.total(),
                speed,
                ctx.incrementalStatus());
    }

    public static int speed() {
        return speed;
    }

    public static void setSpeed(int newSpeed) {
        ExportPacing.requireValidSpeed(newSpeed);
        speed = newSpeed;
        JeiExportMod.LOGGER.info(
                "[jeiexport] Export speed set to {} ({}, {} ms render-thread slices)",
                newSpeed,
                ExportPacing.label(newSpeed),
                ExportPacing.sliceBudgetMillis(newSpeed));
    }

    private static int initialSpeed() {
        String configured = System.getProperty(ExportPacing.SPEED_PROPERTY);
        try {
            return ExportPacing.parseSpeed(configured);
        } catch (IllegalArgumentException error) {
            JeiExportMod.LOGGER.error(
                    "[jeiexport] Invalid -D{}={}; using the explicit default speed {} ({})",
                    ExportPacing.SPEED_PROPERTY,
                    configured,
                    ExportPacing.DEFAULT_SPEED,
                    ExportPacing.label(ExportPacing.DEFAULT_SPEED),
                    error);
            return ExportPacing.DEFAULT_SPEED;
        }
    }

    public void tick() {
        long start = System.nanoTime();
        long sliceBudgetNanos = ExportPacing.sliceBudgetNanos(speed);
        try {
            if (cancelled) {
                if (!cancellationPrepared) {
                    remaining.clear();
                    if (runner != null) {
                        runner.close();
                        runner = null;
                    }
                    cancellationPrepared = true;
                }
                if (ctx.pendingWrites.get() > 0) {
                    overlay("Stopping safely… finishing " + ctx.pendingWrites.get() + " pictures");
                    return;
                }
                finish(true);
                return;
            }
            while (System.nanoTime() - start < sliceBudgetNanos) {
                if (ctx.pendingWrites.get() >= ExportContext.MAX_PENDING_IMAGE_WRITES) {
                    overlay("Saving pictures… " + ctx.pendingWrites.get() + " left");
                    return;
                }
                if (runner == null) {
                    Phase next = remaining.poll();
                    if (next == null) {
                        // Let async PNG writes drain before declaring victory.
                        if (ctx.pendingWrites.get() > 0) {
                            overlay("Finishing pictures… " + ctx.pendingWrites.get() + " left");
                            return;
                        }
                        finish(false);
                        return;
                    }
                    runner = createRunner(next);
                }
                if (runner.step()) {
                    runner.close();
                    chat(String.format(Locale.ROOT, "%s finished (%,d checked)",
                            friendlySectionName(runner.label()), runner.done()), ChatFormatting.GREEN);
                    runner = null;
                }
            }
            overlay(statusLine());
        } catch (Throwable t) {
            JeiExportMod.LOGGER.error("JEI export failed", t);
            chat("Something went wrong and the export stopped. Check the game log for details.", ChatFormatting.RED);
            try {
                finish(true);
            } catch (Exception e) {
                JeiExportMod.LOGGER.error("Cleanup after failure also failed", e);
                current = null;
            }
        }
    }

    private PhaseRunner createRunner(Phase phase) throws IOException {
        return switch (phase) {
            case ITEMS -> new ItemExporter(ctx, requireRuntime());
            case RECIPES -> new RecipeExporter(ctx, requireRuntime());
            case EMC -> new ProjectEEmcExporter(ctx, requireRuntime());
            case MOBS -> new MobExporter(ctx);
            case BLOCK_DROPS -> new BlockDropsExporter(ctx);
            case TRADES -> new TradeExporter(ctx, requireRuntime());
        };
    }

    private IJeiRuntime requireRuntime() {
        if (runtime == null) {
            throw new IllegalStateException("JEI runtime is not available");
        }
        return runtime;
    }

    private void finish(boolean aborted) throws IOException {
        if (runner != null) {
            try {
                runner.close();
            } catch (Exception e) {
                JeiExportMod.LOGGER.error("Failed to close phase runner", e);
            }
            runner = null;
        }
        int items = ctx.catalogCount();
        int recipes = ctx.recipeCount;
        int categories = ctx.categoryCount;
        int mobs = ctx.mobCount;
        int failures = ctx.failures.size();
        if (!contextClosed) {
            ctx.finishAndClose(aborted, System.currentTimeMillis() - startedAtMillis);
            contextClosed = true;
        }
        if (!aborted) {
            ctx.publishCompletedSnapshot();
        }
        current = null;
        long elapsedMillis = System.currentTimeMillis() - startedAtMillis;
        String reuseSummary = ctx.previous == null
                ? " This was a fresh export."
                : String.format(Locale.ROOT, " Kept %,d entries from the last export.", ctx.reusedTotal());
        String summary = aborted
                ? String.format(Locale.ROOT,
                "Export stopped after %s. Your last finished export is still safe. Working folder: ",
                friendlyDuration(elapsedMillis))
                : String.format(Locale.ROOT,
                "Export finished in %s. Saved %,d items and %,d recipes.%s%s Folder: ",
                friendlyDuration(elapsedMillis),
                items,
                recipes,
                reuseSummary,
                failures > 0
                        ? String.format(Locale.ROOT, " %,d notes were added to the error report.", failures)
                        : "");
        JeiExportMod.LOGGER.info(
                "[jeiexport] Export totals: aborted={} durationMs={} items={} recipes={} categories={} mobs={} failures={} reused={} deduplicatedRecipeImages={}",
                aborted,
                elapsedMillis,
                items,
                recipes,
                categories,
                mobs,
                failures,
                ctx.reusedTotal(),
                ctx.deduplicatedRecipeImages);
        chatWithOutputPath(
                summary,
                aborted ? ctx.root : ctx.finalRoot,
                aborted ? ChatFormatting.YELLOW : ChatFormatting.GREEN);
        if (!aborted && ctx.deltaArchive != null) {
            chatWithOutputPath(
                    String.format(
                            Locale.ROOT,
                            "Smaller update ZIP ready (%,d changed files; the full export remains your fallback): ",
                            ctx.deltaArchive.changedFiles()),
                    ctx.deltaArchive.path(),
                    ChatFormatting.AQUA);
        }
        if (!aborted) {
            try {
                if (AutomationOptions.exitOnCompleteEnabled()) {
                    JeiExportMod.LOGGER.info("[jeiexport] Export completed; closing Minecraft as requested");
                    Minecraft minecraft = Minecraft.getInstance();
                    minecraft.execute(minecraft::stop);
                }
            } catch (IllegalArgumentException e) {
                JeiExportMod.LOGGER.error("[jeiexport] Invalid automation option; Minecraft will remain open", e);
            }
        }
    }

    private static void overlay(String message) {
        Minecraft.getInstance().gui.setOverlayMessage(
                Component.literal("[JEI Export] " + message), false);
    }

    private static String friendlyProgressLabel(String label) {
        return switch (label) {
            case "items" -> "Checking items";
            case "recipes" -> "Checking recipes";
            case "EMC sources" -> "Checking EMC sources";
            case "mobs" -> "Checking creatures";
            case "block drops" -> "Checking block drops";
            case "trades" -> "Checking trades";
            default -> "Exporting";
        };
    }

    private static String friendlySectionName(String label) {
        return switch (label) {
            case "items" -> "Items";
            case "recipes" -> "Recipes";
            case "EMC sources" -> "EMC sources";
            case "mobs" -> "Creatures";
            case "block drops" -> "Block drops";
            case "trades" -> "Trades";
            default -> "This section";
        };
    }

    static String friendlyDuration(long durationMillis) {
        long totalSeconds = Math.max(0, Math.round(durationMillis / 1000.0));
        long minutes = totalSeconds / 60;
        long seconds = totalSeconds % 60;
        return minutes == 0
                ? seconds + " seconds"
                : String.format(Locale.ROOT, "%d minute%s %d second%s",
                minutes,
                minutes == 1 ? "" : "s",
                seconds,
                seconds == 1 ? "" : "s");
    }

    static void chat(String message, ChatFormatting color) {
        var player = Minecraft.getInstance().player;
        if (player != null) {
            player.displayClientMessage(Component.literal("[JEI Export] " + message).withStyle(color), false);
        }
        JeiExportMod.LOGGER.info("[jeiexport] {}", message);
    }

    static MutableComponent outputPathComponent(String summary, Path outputPath, ChatFormatting color) {
        String absolutePath = outputPath.toAbsolutePath().normalize().toString();
        MutableComponent message = Component.literal("[JEI Export] " + summary).withStyle(color);
        return message.append(Component.literal(absolutePath).withStyle(style -> style
                .withColor(ChatFormatting.AQUA)
                .withUnderlined(true)
                .withClickEvent(new ClickEvent(ClickEvent.Action.OPEN_FILE, absolutePath))
                .withHoverEvent(new HoverEvent(
                        HoverEvent.Action.SHOW_TEXT,
                        Component.literal("Open export folder")))));
    }

    private static void chatWithOutputPath(String summary, Path outputPath, ChatFormatting color) {
        String absolutePath = outputPath.toAbsolutePath().normalize().toString();
        var player = Minecraft.getInstance().player;
        if (player != null) {
            player.displayClientMessage(outputPathComponent(summary, outputPath, color), false);
        }
        JeiExportMod.LOGGER.info("[jeiexport] {}{}", summary, absolutePath);
    }
}
