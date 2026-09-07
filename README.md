# Minecraft Recipe Tree

Minecraft Recipe Tree is an interactive recipe explorer for large Minecraft modpacks. It transforms
recipe data into visual dependency trees, making complex crafting chains easier to understand and
plan.

[Open Minecraft Recipe Tree](https://minecraftrecipetree.craftsmannsoftware.com/)

## Release environments

Application changes are tested on the private beta Site before an explicitly approved production
promotion. See [Hosting environments](docs/hosting-environments.md) for the environment inventory
and release checklist.

## What you can do

- Search complete modpack item catalogs
- Browse an item's recipes and usages
- Build interactive ingredient trees
- Switch between standard, radial, and compact layouts
- Keep repeated recipes unique within large trees
- Swap recipes or collapse individual branches
- Calculate required resources with optional byproduct accounting
- Export resource totals as CSV
- Export high-resolution recipe trees as PNG images

## Available modpacks

- GT New Horizons — Minecraft 1.7.10
- MeatballCraft — Minecraft 1.12.2
- Multiblock Madness — Minecraft 1.12.2
- Multiblock Madness 2 — Minecraft 1.18.2

## How to use it

Choose a modpack, search for an item, and select one of its recipes to start a tree. Tap ingredient
nodes to expand them, change their recipe source, or collapse branches you no longer need.

The graph controls let you change the layout, show material totals, keep recipes unique, and fit the
entire tree into view.

## Project data

Recipe Tree uses data exported directly from each supported modpack so item names, icons, recipes,
machines, and crafting layouts reflect the selected Minecraft version.

Minecraft and third-party mod content belong to their respective creators.

## Exporter projects

Maintained exporter sources live in this repository for Minecraft 1.12.2, 1.18.2, 1.20.1, and
1.21.1. The 1.21.1 exporter and in-game recipe planner target NeoForge 21.1 and JEI 19; see
[the 1.21.1 mod README](recipe-export-mod-1.21.1/README.md) for build and usage details.
