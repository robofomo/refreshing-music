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

## AI Preprocess (Beats + Words)
These steps write sidecar files in each asset track folder:
- `beats.json` from Essentia
- `words.json` from WhisperX (policy-gated)

### Setup
1. Create and activate a Python venv:
   - Windows PowerShell:
     - `python -m venv .venv`
     - `.\\.venv\\Scripts\\Activate.ps1`
2. Install Python deps:
   - `pip install -r requirements-ai.txt`
3. Ensure `ffmpeg` is installed and available in PATH:
   - `ffmpeg -version`

WhisperX model weights are cached on first run (typically under your user cache directory).

### Commands
- `npm run stems`
  - Extracts `stems.zip` (if present) to `assets/<workId>/<trackId>/stems/`
  - Zip-slip protected extraction
  - Picks canonical stem files:
    - exact-name preference:
      - `0 Lead Vocals.mp3` -> `vocals.mp3`
      - `1 Instrumental.mp3` -> `instrumental.mp3`
    - fallback heuristics:
      - vocals: filename contains `vocals` or `lead` (tie-break prefers starting with `0`)
      - instrumental: filename contains `instrumental` or `inst` (tie-break prefers starting with `1`)
  - Root canonical files are not overwritten unless `-- --overwrite-stems`
  - Writes `stems.json` manifest in the track folder
- `npm run beats`
  - Uses `instrumental.mp3` if present, else `mix.mp3`
- `npm run whisperx`
  - Uses `vocals.mp3` if present, else `mix.mp3`
  - Skips tracks unless `composer.txt` has non-empty lyric lines
  - Override policy with `-- --force-whisperx`
- `npm run preprocess:ai`
  - Runs stems, then beats, then whisperx

Optional filters:
- `npm run stems -- --trackId <trackId>`
- `npm run beats -- --trackId <trackId>`
- `npm run whisperx -- --trackId <trackId> --language en --device cpu --model small`

Per-track failures do not abort the whole run; errors are written to:
- `assets/<workId>/<trackId>/ai-preprocess.log.json`

