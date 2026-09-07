# Recipe Tree for JEI (NeoForge 1.21.1)

Client-side NeoForge mod with an in-game recipe planner and a complete JEI exporter.
Exports include ingredients, rendered recipe previews, living entities, sampled loot, block drops,
and villager trades in `<gameDir>/jei-exports/`.

## Compatibility

- Minecraft 1.21.1
- NeoForge 21.1.x
- JEI 19.21.2.313 through 19.x
- Java 21

The strict publication profile is `generic-jei-1.21.1`. Its default export uses 4× ingredient
canvases and 2× recipe layouts, records exact pack identity, retains complete diagnostics, and
requires one preview PNG for every declared recipe.

## Build

```bash
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew test build
# -> build/libs/jeiexport-1.21.1-neoforge-1.2.0-beta.2.jar
```

## In-game viewer

Press **G** while hovering an item in JEI or an inventory, or while holding an item, to open
its recipe tree. Change the binding under **Controls → Recipe Tree**. Pressing G in the world
reopens the last viewed tree when one exists.

The viewer carries over the 1.20.1 planner: Compact and Details layouts, ingredient alternatives,
input/output recipe selection, multiple starting outputs, quantities and machine planning,
favorites, discovery progress, and local history. Drag the background to pan and scroll to zoom.
Use **Import / Export** for clipboard/file imports, primary-tree `.mrtree.json` exports,
immutable snapshots with editable working versions, history, and exporter commands. Files are saved
under `config/recipe-tree-shares/`. History and the last viewed tree are isolated by world/server;
favorites, discoveries, and reusable-input preferences remain global.

Mark an input reusable with **R** or the inspector/picker toggle. Its branch stays visible at quantity
one, excluded from consumed materials. The Byproducts tab controls byproduct use. Oversized trees
show an overview while panning; recipe-picker machine icons open their recipes. ProjectE EMC choices
are queried lazily, and brewing demand counts one semantic bottle per output.

New singleplayer worlds grant their first player a vanilla guide book once. Disable this with
`recipe_tree.spawnBookInNewWorlds` in `config/jeiexport-client.toml`. Existing worlds receive no grant.
See [portable recipe trees](../docs/portable-recipe-trees.md).

The 1.21.1 port uses NeoForge and JEI 19. The Forge 1.20.1 REI adapter is not included.

## Exporting

1. Put the JAR in a NeoForge 1.21.1 modpack’s `mods` directory alongside JEI 19.x.
2. Start or join a single-player world.
3. Run `/jeiexport all`.
4. Wait for the completion message, then upload the unchanged `jei-exports` directory.

Completed compatible exports reuse unchanged icons, recipe previews, mobs, drops, and trades.
Run `/jeiexport rebuild` for a fresh export. Repeat exports can also produce a sibling
`jei-exports-update.zip` when the changed payload is small enough. Recipe screenshots can share
background layers; structured failures are retained in `export-errors.json`.

Use `/jeiexport speed <1-3>` to select background, normal, or turbo pacing. The default is 2;
turbo spends more time on the render thread and can reduce game responsiveness.

Pack identity is read from CurseForge, Prism/MultiMC, or Modrinth launcher metadata. Automated
launchers can override it with both of these JVM properties:

```text
-Djeiexport.packName=My Modpack
-Djeiexport.packVersion=1.2.3
```

For an unattended CurseForge smoke test, add these JVM arguments to the profile, then launch the
profile normally from CurseForge:

```text
-Djeiexport.auto=all
-Djeiexport.createWorld=true
-Djeiexport.worldFolder=RecipeTree-Exporter-Test
-Djeiexport.worldName=RecipeTreeExport
-Djeiexport.exitOnComplete=true
```

This creates one new disposable single-player world, starts the full export after JEI is ready,
and closes Minecraft only after a successful export. The exporter refuses to reuse an existing
world folder. These options are disabled unless explicitly set.

Exports are transactional: a failed or cancelled run leaves the previous `jei-exports/` snapshot
untouched and retains its staging directory for diagnosis.
