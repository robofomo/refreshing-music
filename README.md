# Generative Music Visualizer (WIP)

Local-first Canvas2D visualizer with:
- versioned engine + recipes (JSON5)
- per-track single data file (track.json)
- preprocess tools that derive timing/structure/lyrics maps

## Structure
- apps/dev-viewer: Vite dev viewer
- packages/engine: renderer + RNG + weighted choice + constraints
- packages/recipes: scene recipes (JSON5)
- packages/preprocess: preprocess studio tools
- schemas: JSON schemas for track + recipe

