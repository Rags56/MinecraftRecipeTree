# Recipe Tree exporter changelog

This file contains release-ready notes for the Minecraft exporter builds. The generated exporter
manifest remains the source of truth for downloadable filenames, checksums, and compatibility.

## 2026-09-05

### Modern planner feature parity

- Forge 1.20.1: **1.2.0-beta.73**; NeoForge 1.21.1: **1.2.0-beta.2**.
- Bring forward the recent 1.12.2 planner features: unified Import / Export, primary-tree shares,
  immutable snapshot baselines with working versions, world/server history, reusable inputs,
  configurable one-time new-world guide books, native tooltips, and inventory-key navigation.
- Move byproduct use into its tab, tint selected recipe types like 1.12, add clickable machine
  icons to picker headings, and show a batched overview while panning oversized trees.
- Let the add-to-tree / start-new-tree recipe dialog fill the window with a small outer margin.
- Expand the main tree viewer to the window, allow either root to be removed while retaining
  at least one, and promote the remaining root for titles, JEI, history, and portable exports.
- Render the drag overview at the top-left with visible nodes, connections, and a viewport marker.
- Keep hovered sidebar recipes compact with the summary below, and place tree quantities beneath
  the full native recipe border with dedicated spacing in the tree layout.
- Bound availability probes per frame, cache repeated recipe queries, and suppress favorite
  expansion while restoring saved trees.
- Restore saved ingredient alternatives on import before applying reusable-input flags.
- Add lazy ProjectE EMC planner recipes using the live API and native transmutation texture.
- Use JEI's semantic brewing API to count one potion input/output, retaining its native layout.
  The 1.12-specific Thermal wrapper patch is not used against modern JEI wrappers.


### NeoForge 1.21.1 exporter and recipe planner

- NeoForge JEI 1.21.1 beta: **1.2.0-beta.1** (Java 21, NeoForge 21.1, JEI 19.21.2.313–19.x)
- Port the Forge 1.20.1 in-game planner: G key, JEI recipe layouts, Compact/Details modes,
  ingredient alternatives, multiple outputs, quantities, machine planning, favorites, discovery,
  local history, and portable tree sharing.
- Port incremental snapshots, delta archives, shared recipe image layers, export speed controls,
  and structured failure reports while retaining the 1.21.1 exporter API adaptations.
- Adapt client events, scrolling, tooltips, item component comparisons, and vertex rendering for
  Minecraft 1.21.1. Unwrap JEI recipe holders when extracting cooking durations.
- Include Minecraft version and loader in the build filename to distinguish it from older ports.
- This port requires JEI; the Forge 1.20.1 REI adapter is not included.

## 2026-08-31

### Brewing quantities and Fluid Transposer tanks

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.109**

#### Fixed

- Count JEI's three visual brewing-stand bottle positions as one consumed potion per one produced
  potion, preventing every brewing step from tripling the planner's required amounts.
- Focus Thermal Expansion's parallel Fluid Transposer layouts on the already-correlated fluid
  variant so potion and other container recipes display their actual fluid in the native tank.
- Reject and log changed brewing or transposer wrapper structures instead of silently guessing an
  amount or substituting the wrong fluid.

## 2026-08-31

### In-game tree import and export

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.108**

#### Changed

- Replace the separate save-plan, snapshot, and share actions with a single in-game Import/Export
  screen for history, clipboard JSON, portable tree files, and command-style recipe export.
- Move the byproduct usage toggle into the Byproducts tab and keep reusable inputs expanded so
  their recipe subtrees remain visible.
- Reserve recipe-type color for selection tinting instead of drawing an outline around every
  recipe card.

## 2026-08-30

### Compact recipe-tree share confirmation

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.107**

#### Fixed

- Replace the oversized share-folder control with a compact centered confirmation panel and three
  native-width actions for copying the tree, opening its folder, and closing the screen.
- Cap every share action at Minecraft 1.12's 200-pixel button-texture limit so the control cannot
  split into white texture fragments at large GUI scales.

## 2026-08-30

### Primary-tree JSON sharing and snapshot versions

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.106**

#### Changed

- Copy the actual site-compatible `.mrtree.json` recipe-tree JSON to the clipboard while continuing
  to save the same JSON under `config/recipe-tree-shares`.
- Export only the graph's main starting node and its recipe selections when a graph has multiple
  starters.
- Make the share-folder location an in-game button that opens the containing desktop folder, with
  visible status and logging when the platform cannot open it.
- Save snapshots as an immutable baseline plus a selected working version so subsequent changes can
  be compared as versions of the same starting tree.

## 2026-08-30

### Native recipes at every zoom level

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.105**

#### Changed

- Always render the actual native recipe layout for every visible recipe node, including at the
  minimum tree zoom, instead of replacing small recipes with a flat item overview card.
- Preserve viewport culling so recipes entirely outside the graph viewport still do not consume
  rendering work.

## 2026-08-30

### Scrollable requested amount

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.104**

#### Added

- Scroll up or down while hovering the amount field to increase or decrease the requested output by
  one, clamped to the existing 1–999 editable range.
- Consume amount-field wheel input before graph handling so changing the amount never zooms the tree
  underneath it.

## 2026-08-30

### Large-tree panning overview

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.103**

#### Added

- Show a temporary top-left minimap while dragging a tree whose scaled bounds exceed the graph
  viewport. The minimap preserves the complete tree shape and outlines the currently visible area.
- Keep the viewport marker visible at the nearest minimap edge when the graph is dragged beyond its
  content bounds.

#### Optimized

- Batch all minimap edges and nodes into two draw calls so the overview remains inexpensive for the
  maximum 2,048-node tree.

## 2026-08-30

### Large-tree performance and restore stability

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.102**

#### Fixed

- Cache successful recipe results even when another legacy wrapper in the same query is malformed,
  and log a full stack trace only once per distinct failure shape instead of once per frame.
- Treat empty optional GUI slots from legacy machine wrappers as absent while continuing to reject
  and log recipes that have no semantic output.
- Restore saved trees without recursively replaying favorite auto-expansion for every restored
  node, eliminating the largest history-load query multiplier.
- Use a lightweight, bounded recipe-availability cache for node colors and clickability instead of
  constructing every semantic recipe while drawing the tree.

#### Optimized

- Memoize material/byproduct summaries until the graph changes, align the availability cache with
  the 2,048-node graph limit, and cap new availability probes per rendered frame.
- Render lightweight live-output cards for recipes below readable zoom levels instead of invoking
  every native HEI layout renderer every frame.

## 2026-08-30

### Correlated Transposer fluids

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.101**

#### Fixed

- Preserve Thermal Expansion's parallel container/fluid variant indexes in generic and merged
  Transposer recipes, so a focused fluid selects its matching container instead of index zero
  (water).
- Log ambiguous or structurally changed Transposer alternatives without silently substituting a
  different fluid. Unrelated JEI tag alternatives remain independent.

## 2026-08-30

### Exact recipe-picker cards

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.100**

#### Fixed

- Size recipe cards on the add-to-current/start-new page to their exact scaled native recipe
  bounds, removing the extra flat canvas and its oversized click target.

## 2026-08-30

### EMC orbit crop and item-only interaction

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.99**

#### Fixed

- Remove additional pixels from the top and right of ProjectE's left transmutation orbit and align
  the live output item with the orbit's exact focal point.
- Stop the EMC recipe background from producing the output tooltip. Only the overlaid 16x16 live
  item now owns its native tooltip and right-click Recipe Tree action.

## 2026-08-29

### Live EMC output and recipe-picker cleanup

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.98**

#### Changed

- Crop ProjectE's left transmutation orbit more tightly, center the output on its focal point, and
  make that output a live ingredient with its native tooltip and right-click Recipe Tree action.
- Label recipe-viewer actions `Open in XEI`, omit the redundant `Change item 1 / 1` control, and
  provide an explicit `Done` button on the recipe picker.
- Show manually reusable inputs as requiring exactly one item, independent of parent craft count,
  while continuing to exclude them from consumed-material totals.

## 2026-08-29

### Focused EMC recipe card

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.97**

#### Changed

- Reduce ProjectE EMC recipes to the left transmutation orbit with the live output item centered
  over it and the exact EMC cost immediately below. Omit the second orbit, learned-item slots,
  inventory, fuel controls, arrow, and synthetic EMC icon from Recipe Tree's recipe card.

## 2026-08-29

### Vanilla inventory-key behavior

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.96**

#### Fixed

- Forward the inventory binding from Recipe Tree through Minecraft's normal inventory action:
  open the mounted horse inventory when applicable, otherwise notify the vanilla tutorial and open
  the player's inventory. This replaces the unconditional direct inventory-screen construction.

## 2026-08-29

### Recipe-picker reusable toggle and inventory access

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.95**

#### Changed

- Show an explicit persisted `Reusable: ON/OFF` button in the input recipe-picker header for every
  non-root ingredient, using the same state as the tree hover-panel toggle.
- Open the player's inventory when its configured key binding is pressed from Recipe Tree or any
  nested recipe, alternative, history, or snapshot screen.

## 2026-08-29

### Unified machine recipe choice screen

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.94**

#### Changed

- Open a type machine with the same actionable recipe-choice screen used for other items, including
  the options to add it to the current tree or start a new tree.
- Keep the choice screen's Cancel and tree-action buttons inside its panel, center partially filled
  recipe rows, and center each native recipe horizontally and vertically within its selection card.

## 2026-08-29

### Forge 1.12.2 scissor-state crash hotfix

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.93**

#### Fixed

- Allocate the 16-element integer query buffer required by LWJGL 2 when preserving OpenGL scissor
  state around native recipe cards. This fixes the immediate crash when opening Recipe Tree with
  beta.92 while retaining zoom-safe clipping for mob recipe layouts.

## 2026-08-29

### ProjectE EMC recipes and zoom-safe legacy cards

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.92**

#### Added

- Add live ProjectE EMC Transmutation as an in-game Recipe Tree input recipe for every item with
  a positive EMC value. Render the recipe with ProjectE's installed Transmutation Table texture
  and show the table as its crafting machine without adding a hard ProjectE dependency.

#### Fixed

- Correct Just Enough Resources' fixed-pixel mob scissor while Recipe Tree cards are zoomed, so
  tall mob renders no longer disappear from the top. Restore the caller's scissor afterward so
  native integrations cannot disable Recipe Tree's viewport clipping.
- Reserve the rendered font height plus a clear gap below both item and recipe cards, keeping
  detached required amounts out of their boxes at every supported zoom level.

## 2026-08-28

### Forge HEI/JEI 1.12.2 Recipe Tree book and recipe-picker layout

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.91**

#### Added

- Show each HEI category's live catalyst machine in the recipe-picker header. Clicking it opens a
  read-only grid of every recipe that crafts that machine, and Back returns to the unchanged picker.
- Mark a hovered non-root input reusable with the explicit right-panel toggle or the `R` shortcut.
  The choice applies to every matching node and persists in local progress, snapshots, and shared
  tree history.
- Add `recipe_tree.spawnBookInNewWorlds` to `config/jeiexport.cfg`, enabled by default, so pack
  authors and players can disable the one-time new-world guide-book grant.
- Give the first player a named Recipe Tree guide book when a new singleplayer world is created.
- Right-click the book to reopen the latest saved tree, or show the embedded control guide before
  the first tree exists.
- Persist the grant in world data so reloads and respawns never create duplicate books. Existing
  worlds are not retroactively given one.

#### Fixed

- Scope recent-tree history and the last-viewed tree to each singleplayer save or multiplayer
  server, so pressing `G` after changing worlds never opens another world's graph. Favorites,
  collapsed recipe categories, discoveries, and reusable-input preferences remain global.
- Keep manually reusable inputs visible as distinct terminal nodes while excluding them from
  material totals, and remove the previous Shift-click toggle to prevent accidental changes.
- Draw each parent branch as one pixel-snapped neutral connector bus, preventing overlapping
  category-colored segments from appearing bent at fractional zoom levels.
- Keep graph connectors neutral and apply a category's color only as a border and subtle shading
  on recipe nodes when that type is selected.
- Disable left-click recipe selection for terminal items that have no producing recipes.
- Treat Immersive Engineering metal-press molds and Tinkers' Construct reusable casts as retained
  tooling, keeping them in native recipes while omitting them from the tree and material totals.
- Scale item backgrounds, icons, and detached counts together at the exact tree zoom, and stop
  painting Recipe Tree's own fill behind native HEI recipe renders.
- Scale detached counts identically for recipe and ingredient nodes at every tree zoom level.
- Size detailed recipe nodes to the native HEI recipe render itself, removing the flat gray side
  bands that Recipe Tree previously added outside the recipe.
- Credit Filostorm as the author of the written Recipe Tree guide book.
- Draw required counts below item and recipe cards on the transparent graph instead of extending
  each node's colored or gray background around the count.
- Move Recipe Tree's required amount, discovery state, and mouse-action hints out of native item
  tooltips and into the right-side hover panel beside the recipe preview.
- Render fluid ingredients as full 16x16 icons in Recipe Tree's custom nodes, lists, and headers
  while preserving exact quantities and native recipe-card rendering.
- Render nested recipe and item-choice screens with the active Minecraft client context even when
  their parent tree has not been displayed yet. This prevents the Faraday Suit Boots picker from
  crashing while it tries to draw the header ingredient.
- Keep the ingredient renderer's explicit error marker null-safe so a failed native render remains
  logged instead of causing a second rendering exception.
- Center partially filled recipe rows within the picker instead of pinning their cards to the left.
- Fit picker selection outlines and hitboxes to each native recipe layout, removing the oversized
  flat card background around JEI/HEI's own recipe panel.
- Keep Ender IO Micro Infinity and fully returned inputs such as molds in native recipe cards, but
  omit them from the visible planning tree and material/byproduct totals.

#### Compatibility

- Use a marked vanilla written book instead of a custom registry item, preserving the viewer's
  client-only multiplayer compatibility contract.

## 2026-08-26 — GTNH reproducible MobsInfo corpus

- GTNH NEI 1.7.10: **1.0.154**

### Changed

- Promote the MobsInfo corpus regenerated by two clean launches of the official GTNH 2.8.4
  Java 17–25 pack. Both captures produced the same 401-page semantic fingerprint and contained
  one fewer drop slot than the older cached runtime corpus.
- Initialize and verify Eternal Singularity 1.2.3's dedicated cosmic shader when rendering its
  Avaritia-compatible combined singularities instead of assuming every cosmic item uses
  Avaritia's renderer class.

## 2026-08-26 — GTNH Avaritia cosmic icons

- GTNH NEI 1.7.10: **1.0.151**

### Fixed

- Validate and, when necessary, initialize Avaritia 1.77's native cosmic shader before capturing
  Infinity equipment, Matter Clusters, and other cosmic inventory icons.
- Recover a stale Minecraft shader-support flag only when the active OpenGL context exposes the
  required shader objects, and fail the export explicitly instead of publishing an unshaded mask.
- Restore Avaritia's transient shader state after every adapted inventory draw.

## 2026-08-26

### Fluid and oversized AvaritiaItem catalog icons

- Forge HEI/JEI 1.12.2: **1.1.7**

#### Fixed

- Render fluid catalog identities at one full bucket so low-volume recipe ingredients no longer
  export as a one-pixel fill line.
- Preserve AvaritiaItem halo artwork by rendering its native oversized GUI model on a bounded
  canvas and fitting the complete visible result into the 16x16 catalog icon.
- Initialize AvaritiaItem's native cosmic shader before capture, including recovery when the
  active OpenGL context supports shader objects but Minecraft's cached support flag is stale.

#### Viewer behavior

- Show an item's exact ProjectE EMC value directly below the item heading, above its recipe tabs.

## 2026-08-22

### Retained crafting ingredients, durability tools, and EMC sources

- Forge HEI/JEI 1.12.2 beta: **1.2.0-beta.73**
- Forge JEI/REI 1.20.1 beta: **1.2.0-beta.72**
- NeoForge JEI 1.21.1: **1.0.3**

#### Added

- Add an **EMC Transmutation** source for every unique ProjectE item with a positive EMC value,
  including items that also have ordinary crafting or machine recipes. EMC is exported as its own
  resource type and totals remain exact in recipe cards, graph nodes, and CSV exports.
- Query ProjectE through its optional API so exporter builds remain compatible with packs that do
  not include ProjectE. The EMC scan is tick-bounded for large catalogs.

#### Fixed

- Detect crafting ingredients returned by Minecraft even when JEI does not repeat them in the
  recipe outputs. ProjectE's Philosopher's Stone is now one reusable prerequisite instead of being
  multiplied by every craft.
- Detect tools returned with durability damage and export their conservative usable-craft count.
- Preserve alternative-slot semantics: a slot mixing returned and consumed choices remains one OR
  slot instead of being split into two incorrect AND requirements.
- Continue through Modular Machinery Community Edition's controller lookup methods when one
  supported lookup returns no match, instead of dropping an otherwise valid structure preview.
- Omit Ender IO Stirling Generator tier outputs that its HEI wrapper explicitly reports as zero,
  while retaining every positive tier output for the fuel.

#### Viewer behavior

- Reusable item nodes use a teal retained-item background and require one item for any craft count.
- Durability tool nodes use an amber tool background and scale replacements by their exported usable
  crafts rather than consuming one complete tool per recipe run.
- Older exports remain readable; catalyst slots without the new metadata continue to behave as
  indefinitely reusable prerequisites.

#### Verified

- Fresh MeatballCraft `prerelease-0.18.6.4` export: 196,920 items, 367,833 recipes, 680 categories,
  and zero failures.
- All 261 Modular Machinery structure previews exported successfully with placed blocks,
  dimensions, and block counts.
- Exported 11,106 ProjectE EMC sources, including 8,346 items that also have ordinary recipes, and
  classified the Philosopher's Stone as reusable in 248 crafting recipes.

## 2026-08-08

### Forge HEI/JEI 1.12.2 — 1.1.4

Recommended for MeatballCraft, Multiblock Madness 1, and other Forge 1.12.2 packs using JEI or HEI
4.x.

#### Added

- Export placed-block structure data and block totals for all Modular Machinery Structure Preview
  recipes.
- Support the original Modular Machinery API, Modular Machinery Community Edition, compatible
  subclasses, and forks that expose `long`, boxed `Long`, or `Optional<Long>` preview selectors.
- Record exact Modular Machinery preview, success, and failure totals in exporter diagnostics.
- Allow targeted quality samples to scan the complete item catalog before exporting selected
  recipes, making structure-preview validation representative of a full export.

#### Fixed

- Use the first displayable Modular Machinery ingredient when a deterministic preview sample is
  empty or resolves to air.
- Keep air-only positions out of the material count while retaining their coordinates in the
  structure dimensions.
- Resolve machine fields through compatible wrapper class hierarchies instead of requiring one
  exact wrapper implementation.
- Report structure extraction failures with the category, recipe index, wrapper class, and bounded
  cause chain instead of silently producing an empty preview.
- Preserve the newly exported structure metadata through preview-sidecar generation and immutable
  Cloudflare publication.

#### Verified

- Fresh MeatballCraft 0.18.6 export: 196,127 items, 359,096 recipes, 674 categories, and zero
  failures.
- All 260 Modular Machinery structure previews exported successfully with placed blocks,
  dimensions, and block counts.
- Compiled against both the supported JEI 4 compatibility floor and MeatballCraft's installed
  Had Enough Items 4.28.1 API.

### Other current exporter builds

These builds are unchanged by the 2026-08-08 release:

| Minecraft | Recipe viewer | Loader | Current build | Status |
| --- | --- | --- | --- | --- |
| 1.21.1 | JEI 19 | NeoForge 21.1 | 1.0.0 | Current |
| 1.20.1 | JEI 15 | Forge 47 | 1.1.0 | Current public release; 1.2.0 beta remains in testing |
| 1.18.2 | REI 8 | Forge 40 | 1.0.52 | Current |
| 1.7.10 | NEI 2.8.44-GTNH | Forge 10.13.4 | 1.0.150 | Current |

## Copy-ready release summary

Recipe Tree Exporter 1.1.4 improves Modular Machinery support on Minecraft 1.12.2. Structure
previews now export as their actual placed blocks with correct dimensions and material totals across
the original Modular Machinery mod, Modular Machinery Community Edition, and compatible forks.
Air-only positions no longer inflate block counts, alternate display blocks are handled correctly,
and any structure extraction problem is included in the exporter diagnostics. The release was
validated on a complete MeatballCraft 0.18.6 export: all 260 Modular Machinery structures exported
successfully and the full 359,096-recipe export completed with zero failures.
