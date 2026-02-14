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
- inbox/ (gitignored): drop new source files here
- assets/<workId>/<trackId>/ (gitignored): imported media + composer/timing files
- tracks/<trackId>.track.json (tracked): small generated track metadata

## Workflow (Inbox -> Assets -> Tracks)
1. Drop new files into `inbox/` (mp3/txt/json5/zip).  
2. Run `npm run import:inbox` to move grouped files into `assets/<workId>/<trackId>/` and create/update `tracks/<trackId>.track.json`.
3. Edit `assets/<workId>/<trackId>/composer.txt` stubs as needed.
4. Run `npm run preprocess` to refresh track JSON data + embedded timing.
5. Run `npm run dev` for the dev viewer.

