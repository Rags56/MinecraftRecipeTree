# Portable recipe trees

Minecraft Recipe Tree shares use the versioned `minecraft-recipe-tree` JSON format and the
`.mrtree.json` filename suffix. The format moves the same ingredient tree between the web viewer,
the mobile app, and the in-game JEI viewer.

Recipe selections carry two identities:

- `recipeKey`: JEI's stable `category-id|recipe-id` identity, used across platforms and dataset
  publications.
- `ref`: the optional `[categoryIndex, recipeIndex]` location used as a fast path when reopening
  the exact same web dataset publication.

The importer still verifies the stable identity before accepting a web reference. This prevents a
reference from silently selecting a different recipe after a pack publication changes.

## Web and mobile app

Open the graph controls and choose **Share**.

- **Share current tree** opens the native share sheet on mobile. On web it uses file sharing when
  supported, otherwise it downloads a `.mrtree.json` file and attempts to copy the JSON.
- Paste copied history JSON into **Open shared tree history**, or choose/drop the received
  `.mrtree.json` history file.

Histories are limited to 1 MiB, 2,048 selected sources, and 64 levels. The selected site publication
must match every pack identity field carried by the history, including its exact publication or pack
version when present. Recipes are also resolved by stable identity.

## Minecraft 1.20.1 and 1.21.1 mods

Choose **Import / Export** on the recipe-tree screen.

- **Export primary tree** copies the primary tree to the clipboard and saves a uniquely named
  `.mrtree.json` in `config/recipe-tree-shares/`. Other starting outputs remain in local history.
- Import explicitly from clipboard JSON or a listed file. Imports reject malformed paths,
  duplicate selections, invalid UTF-8, symbolic links, and documents larger than 1 MiB.
- **Save snapshot version** preserves an immutable baseline and selects a working version for edits.
- Modern mod-to-mod shares preserve reusable inputs in the optional `reusableInputs` path list.
  The web viewer uses the recipe selections; it does not apply that optional mod-only field.
- History and last-viewed trees are scoped to each world/server. Legacy unscoped history remains
  preserved in the local state file rather than appearing in unrelated worlds.

The in-game viewer currently imports ingredient-directed trees. Mob-drop and mining sources from a
web tree are left collapsed because the JEI planner does not represent those as recipe pages.
