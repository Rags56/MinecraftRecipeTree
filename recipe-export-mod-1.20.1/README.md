# Recipe Tree for JEI and REI (Forge 1.20.1)

Client-side mod that plans and exports recipes from JEI or REI to `<gameDir>/jei-exports/`:

## In-game recipe planner

Press **G** while holding an item or hovering an item in JEI or any inventory/container slot to
open its Recipe Tree planner.
The key is configurable under Minecraft's **Controls → Recipe Tree** category. The planner:

- draws recipes with JEI's own renderer, so modded layouts and ingredient alternatives remain familiar;
- exports exact vanilla cooking durations and common modded JEI recipe timing accessors for
  production planning in the site viewer; recipes that expose total energy and energy per tick are
  converted to an exact cycle length when the ratio is integral;
- lets you left-click an item to choose its input recipe and right-click it to choose a recipe
  output that consumes it;
- attaches chosen input recipes to persistent branches instead of replacing the current recipe;
- uses JEI's native recipe box as every expanded Details-mode node, while Compact mode keeps the
  tree item-only and reveals the hovered node in a responsive, fitted top-right translucent square
  layered over the full-width tree canvas;
- shows the configured attack-button recipe hint on unexpanded items and cycles a hovered
  ingredient through its JEI tag alternatives before the mouse wheel falls back to tree zoom;
- preserves every JEI typed input in the tree, including Forge fluids and Mekanism chemicals,
  using each type's native JEI renderer, tooltip, identity, and amount;
- supports background-drag panning and cursor-centered wheel zoom, with the arrow buttons reserved
  for moving backward and forward through recent output targets;
- provides **Import / Export** for primary-tree JSON, clipboard/file imports, history, snapshots,
  and exporter commands; saved files use unique names in `config/recipe-tree-shares/`;
- keeps history and the last viewed tree separate for each local world or multiplayer server;
- saves immutable snapshot baselines alongside an editable working version;
- marks inputs reusable with **R** or the inspector/picker toggle, keeping their branches visible
  at quantity one while excluding them from consumed materials;
- gives the first player in a new local world a vanilla Recipe Tree guide, controlled by
  `recipe_tree.spawnBookInNewWorlds` in `config/jeiexport-client.toml`;
- shows a batched overview while panning oversized trees, and exposes machine recipes from
  clickable catalyst icons in recipe-picker headings;
- provides lazy ProjectE EMC transmutation choices and counts brewing bottle demand correctly;
- adds up to 16 independent starting outputs to one pannable graph through a searchable item grid,
  combines their materials, processes, and byproduct allocation, and saves all roots in history;
- wraps the current tree when a new output is chosen from the root, preserving the existing plan as
  the matching input branch; selected recipes are persisted as per-output favorites and promoted to
  the front of future recipe choosers, and favorited recipes automatically expand whenever their
  output appears as an ingredient; the input picker header can explicitly select **No recipe**,
  clearing that favorite and leaving the ingredient collapsed; changing or clearing a favorite
  updates every matching occurrence across every starting branch immediately;
- keeps the requested amount editable in both display modes and multiplies every expanded input
  branch by the required craft count, including recipes that produce more than one output;
- packs differently sized recipe choices closely in one vertically scrolling list and only renders
  or ticks the visible JEI boxes, grouped under collapsible JEI recipe-type headers whose state is
  remembered locally;
- renders tree recipes and items beneath the foreground controls so item depth cannot cover buttons
  or status messages, without reserving a footer strip from the pannable tree;
- wraps the planner toolbar into up to three rows on narrow GUI-scaled screens and moves the tree
  viewport below those rows instead of allowing controls to overlap;
- uses the same full-size planner canvas in Compact and Details modes, places calculated quantities
  below their nodes, and gives recipe-picker cards more breathing room;
- groups repeated ingredients into one tree node with a quantity such as `9x`, and excludes JEI's
  informational tag pages from planner recipe choices; and
- saves the most recent plan for each target locally in `config/recipe-tree-plans.json`.

JEI recipe queries remain lazy and bounded, keeping the normal game loop independent from large JEI
recipe catalogs. Account sync is not part of this first release; the local plan file is the migration
boundary for a later opt-in sync service.

The portable format and compatibility limits are documented in
[`docs/portable-recipe-trees.md`](../docs/portable-recipe-trees.md).

## Exporting a pack

- **Recipes** — every recipe of every visible JEI category, rendered offscreen through JEI's own
  `IRecipeLayoutDrawable` into PNGs (it looks exactly like the in-game recipe screen), plus
  per-category `recipes.json` with inputs/outputs/catalysts. Repeated pixels can be stored once as
  a shared `bg` layer; the recipe's `img` is then its exact transparent overlay. Readers draw `bg`
  first and `img` second at the same dimensions. Recipes without `bg` remain complete images.
- **Ingredients** — every registered JEI ingredient (items, fluids, custom types like gases) rendered
  through its `IIngredientRenderer` into icons. 3D blocks keep their GUI pose, special renderers
  (chests, banners, tridents, glint) are correct because it's the real render path.
- **Mobs** — every `LivingEntity` type from every mod, rendered with the real entity renderers
  into a 16-frame animated sprite sheet (game time + walk cycle advance between frames), plus
  `mobs.json` with stats and loot drops sampled from the real loot tables (600 player-kill rolls
  per mob) and custom death hooks (64 isolated probes) on the integrated server.
- **Block drops** — every block's loot table sampled 512× with the best valid harvesting tool
  (respecting `requiresCorrectToolForDrops`), silk-touch variant included when it differs;
  crops are sampled fully grown. Written to `blockdrops.json`.

## Build

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew build
# -> build/libs/jeiexport-1.2.0-beta.73.jar
```

Gradle 8.1.1 / ForgeGradle 6 / Forge 1.20.1. The release accepts Forge 47.1–47.x and either
JEI 15.2–15.x, or REI 12.1.785 with REI Plugin Compatibilities 12.0.93. It compiles against
the JEI 15.2.0.21 compatibility baseline while dev runs exercise JEI 15.20.0.130 and REI
12.1.785, preventing accidental linkage to newer-only viewer methods.

## Use

Choose one recipe-viewer setup:

- **JEI:** install this jar and JEI 15.x.
- **REI:** install this jar, REI 12.1.785, REI Plugin Compatibilities 12.0.93,
  Architectury API 9.2.14, and Cloth Config 11.1.136. Do not also install JEI; the compatibility
  mod provides the JEI API facade used by Recipe Tree and other JEI plugins.

Join a world, then `/jeiexport all`.
See the [repo root README](../README.md) for the full command reference, output format, and the viewer.

Completed compatible snapshots are incremental by default. The exporter validates the Minecraft
version, modpack identity, exact loaded mod versions, render settings, and cache revision, then reuses
unchanged ingredient/category icons, structurally identical recipe previews, mobs, block drops, and
complete trade records. Missing files, previous failures, new records, and recipes whose JEI slots,
amounts, dimensions, duration, or identifiers changed are generated again. Reused files are linked
into the transactional staging snapshot when supported, with a logged copy fallback. Run
`/jeiexport rebuild` to explicitly ignore the prior snapshot and regenerate everything. Cache usage
and per-phase reuse counts are written to `manifest.json` and displayed in progress/completion text.
Existing complete recipe images remain reusable after upgrading; run `/jeiexport rebuild` once when
you want those older screenshots converted to shared layers for maximum disk savings.

After a repeat export, the exporter also writes a sibling `jei-exports-update.zip` when the changed
payload is less than 80% of the new full snapshot. The update is compared with exactly the previous
completed snapshot, includes SHA-256 metadata for every changed file, and never replaces the full
`jei-exports/` fallback. Add the full ZIP to a browser once, then later update ZIPs reconstruct a new
standalone local snapshot transactionally and remove the superseded copy; update archives do not
form a dependency chain. If the pack identity, Minecraft version, render settings, or size threshold
does not permit a safe useful delta, the exporter removes any stale update ZIP and keeps only the
full export.

JEI layouts must be rendered on Minecraft's render thread, so the exporter uses cooperative pacing.
Run `/jeiexport speed` to inspect the active preset or `/jeiexport speed <1-3>` to change it while an
export is running. Speed 1 uses 2 ms slices for playable background exports, speed 2 is the default
and matches the legacy 45 ms pacing, and speed 3 uses bounded 250 ms turbo slices. Turbo nearly
monopolizes the render thread but yields between slices so the progress overlay can redraw. Automated
launches can select a preset with `-Djeiexport.speed=1|2|3`. Invalid property values are logged and
use the explicit speed 2 default rather than being silently clamped.

The default command renders 64×64 ingredient canvases (`iconScale: 4`) and 2× JEI recipe
layouts. Those settings, complete failure telemetry in `manifest.diagnostics`, and one preview
PNG per declared recipe are the strict `generic-jei-1.20.1` publication contract. Do not override
`iconScale` for a hosted export; a different scale is valid raw data but intentionally fails that
profile rather than being silently resized.

The 4× canvas preserves high-resolution/custom JEI renderers and avoids viewer-side upscaling,
but it contains 16× the pixels of native 1× icons. That increases GPU readback, PNG encoding,
raw-export storage, staging I/O, and publication processing; compression means file bytes do not
necessarily grow by the full 16×. A separate native-1× quality profile would be the smaller/faster
option for pixel-art-only packs, with the tradeoff that custom-renderer detail may be lost.

### Modpack identity

Every `manifest.json` now includes publication identity alongside the Minecraft version:

```json
"pack": {
  "name": "My Modpack",
  "version": "2.4.1",
  "identitySource": "explicit-request"
}
```

For a deterministic name and version, launch Minecraft with both properties. The exporter permits
an omitted version for private raw snapshots, but hosted publication requires it:

```text
-Djeiexport.packName=My Modpack
-Djeiexport.packVersion=2.4.1
```

The resolver uses this precedence order: explicit JVM properties, CurseForge
`minecraftinstance.json`, Prism/MultiMC's parent `instance.cfg`, Modrinth
`modrinth.index.json`, then the game-directory name. Launcher files are read as bounded UTF-8
regular files (maximum 256 KiB); symlinks, malformed JSON, invalid Unicode controls, conflicting
metadata, and fallback selection are written to the Minecraft log instead of being hidden.
Pack names are limited to 120 Unicode code points and versions to 80. C0/C1 controls plus the
canonical bidirectional and zero-width formatting ranges are rejected. A derived directory name
is convenient for an interactive export, but publishers should use the JVM properties so moving
or renaming an instance cannot change its public identity.

The manifest also records exact, non-truncated failure accounting:

```json
"diagnostics": {
  "failureEvents": 0,
  "failureEventsOmitted": 0
}
```

`diagnostics.failureEvents` always equals `counts.failures` and the number of entries in
`failures.json`; `failureEventsOmitted` is always zero. The publisher rejects schema drift,
partial diagnostics, semantic-error recipes, missing recipe previews, and `QUANTITY_INVALID`
events. Unknown custom ingredient amounts remain explicit as `-1` in the raw snapshot and are
logged as publication-blocking diagnostics; they are never silently converted to quantity `1`.
Custom ingredient classes with no quantity API are explicitly logged and treated as categorical
unit values; item, fluid, and quantified custom stacks retain their runtime counts.

The exporter also writes `export-errors.json`. It retains every failure as a structured record with
the responsible mod, JEI category, recipe ID and source index when available, recipe class,
exception type, bounded stack trace, pack/version, Minecraft version, and exporter version. The web
viewer can load the successful part of an export even when this report is non-empty, then submit the
deduplicated diagnostics to the project's GitHub issue reporter.

Recipe slot alternatives and category catalysts are exported in full. Sets above 512 entries emit
a warning because large tags can materially increase JSON size and export time, but they are not
silently truncated.

Exports are transactional: the run writes to `.jei-exports.staging-<uuid>` and promotes that
directory only after PNG writes and metadata complete. A failed or cancelled run retains its
staging data for diagnosis and leaves the previous `jei-exports/` snapshot intact. This can
temporarily require disk space for both snapshots.

## Headless / automatic export

Launching the game with `-Djeiexport.auto=all` (or `items`/`recipes`/`mobs`, plus optional
`-Djeiexport.iconScale=N`, `-Djeiexport.packName=...`, and `-Djeiexport.packVersion=...`) starts
the export automatically ~5s after world load — no command needed.

For an unattended CurseForge smoke test, also add
`-Djeiexport.createWorld=true -Djeiexport.worldFolder=RecipeTree-Exporter-Test
-Djeiexport.worldName=RecipeTreeExport -Djeiexport.exitOnComplete=true` to the profile JVM
arguments. The exporter creates one new disposable single-player world, exports after JEI is
ready, and closes Minecraft only after success. It refuses to reuse an existing world folder.

In this dev workspace there's a one-shot task that boots straight into a test world
and exports everything:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew runExportClient
# world 'export-test' must exist in run/saves (generate once via: ./gradlew runServer, then
# copy run/world to run/saves/export-test)
```

Verified on vanilla 1.20.1 + JEI 15.20.0.130, and on a real-mod test pack (Create 6.0.8,
Mekanism 10.4.16, Farmer's Delight 1.3.2, Alex's Mobs 1.22.9): 3,533 items (incl. Mekanism
gas/infusion/pigment/slurry types), 10,345 recipes across 70 categories (incl. Create's
sequenced assembly), 178 mobs, 2 failures (Mekanism blocks whose loot needs a block entity),
10.2s. The test mods are wired in build.gradle as `runtimeOnly fg.deobf("maven.modrinth:…")`
dev-run dependencies — remove or swap them freely; they're not compile deps and don't ship.
Note the `mixin.env.disableRefMap=true` run property: production mods' mixin refmaps target
SRG names and won't apply in the mojmap dev runtime without it.

## Implementation notes

- `JeiExportPlugin` (`@JeiPlugin`) captures `IJeiRuntime` on world load.
- `ExportJob` is a tick-driven state machine (45ms budget per client tick) so the game stays
  responsive; PNG encoding happens on Minecraft's IO pool.
- `OffscreenRenderer` owns a `TextureTarget` framebuffer and mirrors vanilla's GUI projection
  (`setOrtho(0,w,h,0,1000,guiFarPlane)`), reads back with alpha and un-flips.
- `ItemCatalog` dedupes by `<type>|<jei-uid>` key; the recipe phase routes every slot ingredient
  through it, so recipes can never reference a missing catalog entry.
- Every per-recipe/per-entity step is wrapped in catch-all error handling; failures land in
  `failures.json` and the export keeps going (important for big modpacks with broken edge cases).
