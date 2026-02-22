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
1. Drop new files into `inbox/` (mp3/wav/txt/json5/zip).
2. Run `npm run import:inbox`.
3. Import groups are resolved as:
   - folder groups: each top-level folder in `inbox/` is one group
   - loose-file groups: root files are grouped by best-effort basename prefix
4. `workId` resolution order:
   - optional override file in group (`*work-id*.txt` or `*work-id*.json5` with `workId`)
   - filename tag (for example `[work:my-work]` or `work_my-work`)
   - composer metadata title (`[Title: ...]` / `[Song Title: ...]`, with trailing `Stems` stripped)
   - filename-derived work id from mp3/zip (or group title)
   - fallback `work_YYYYMMDD`
5. Importer creates/updates:
   - `assets/<workId>/<trackId>/`
   - canonical stems from `stems.zip` when present (`instrumental.(wav|mp3)`, `vocals.(wav|mp3)`, best-effort filename matching with WAV preference)
   - playback MP3s generated/normalized from WAV stems when needed (`instrumental.mp3`, `vocals.mp3`, `mix.mp3`)
   - canonical `mix.mp3` (created from `instrumental.mp3` first, then fallback audio)
   - `composer.txt` stub if missing
   - `tracks/<trackId>.track.json` with catalog/import metadata, including hash source details (`instrumental.mp3` preferred when available)
6. Consumed groups are archived under `inbox/_done/<YYYY-MM-DD>/...`.
7. `import:inbox` automatically runs post-import processing for newly imported track IDs:
   - `preprocess:ai` (stems -> beats -> whisperx)
   - `preprocess` (embeds generated AI timing into `tracks/<trackId>.track.json`)
8. Run `npm run dev` for the dev viewer.

### Import Flags
- `npm run import:inbox -- --dry-run`
  - Plan only; no file writes/moves.
- `npm run import:inbox -- --overwrite`
  - Allow replacing conflicting files in target asset folders.
- `npm run import:inbox -- --json`
  - Print detailed import report JSON to stdout.
- `npm run import:inbox -- --json reports/import.json`
  - Write report JSON to a file.
- `npm run import:inbox -- --no-post`
  - Import only; skip post-import AI + track rebuild.
- `npm run import:inbox:raw`
  - Direct importer invocation without post-import processing wrapper.

### Smoke Test
- `npm run import:inbox:smoke`
  - Runs a local fixture import in a temp directory and verifies expected track/import outputs (no AI preprocess required).

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
      - `0 Lead Vocals.(wav|mp3)` -> `vocals.(wav|mp3)`
      - `1 Instrumental.(wav|mp3)` -> `instrumental.(wav|mp3)`
    - fallback heuristics:
      - vocals: filename contains `vocals` or `lead` (tie-break prefers starting with `0`)
      - instrumental: filename contains `instrumental` or `inst` (tie-break prefers starting with `1`)
  - Root canonical files are not overwritten unless `-- --overwrite-stems`
  - Generates/normalizes canonical playback `instrumental.mp3` + `vocals.mp3` to seek-safe MP3s (48kHz stereo, CBR 192k, Xing header) when `ffmpeg` is available
  - On Windows, if local `ffmpeg` is not found, tries `wsl ffmpeg`
  - If no `ffmpeg` is available, normalization is skipped and recorded in `stems.json`
  - Writes `stems.json` manifest in the track folder
- `npm run beats`
  - Uses `instrumental.wav` if present, else `instrumental.mp3`, else `mix.wav`, else `mix.mp3`
- `npm run whisperx`
  - Uses `vocals.wav` if present, else `vocals.mp3`, else `mix.wav`, else `mix.mp3`
  - Skips tracks unless `composer.txt` has non-empty lyric lines
  - Override policy with `-- --force-whisperx`
- `npm run preprocess:ai`
  - Runs stems, then beats, then whisperx
  - Shows stage start/finish progress logs
  - `beats`/`whisperx` skip existing `beats.json`/`words.json` by default
  - Use `-- --overwrite-ai` to regenerate existing AI outputs

### WSL Launchers (Linux AI stack from PowerShell or WSL)
Use these when Essentia/WhisperX are installed in WSL (for example in conda env `refresh-ai`).

- From WSL:
  - `bash tools/wsl/run-ai.sh preprocess-ai`
  - `bash tools/wsl/run-ai.sh beats -- --trackId <trackId>`
  - `bash tools/wsl/run-ai.sh whisperx -- --trackId <trackId> --device cpu --model small --language en`
- From PowerShell (calls WSL):
  - `.\tools\wsl\run-ai.ps1 -Task preprocess-ai`
  - `.\tools\wsl\run-ai.ps1 -Task beats -- --trackId <trackId>`
  - `.\tools\wsl\run-ai.ps1 -Task whisperx -- --trackId <trackId> --device cpu --model small --language en`

Notes:
- Default conda env is `refresh-ai` (override via `-CondaEnv <name>` in PowerShell or `CONDA_ENV_NAME=<name>` in WSL).
- Use `-SkipConda` (PowerShell) or `SKIP_CONDA=1` (WSL) if Python deps are already in PATH without conda activation.

Optional filters:
- `npm run stems -- --trackId <trackId>`
- `npm run beats -- --trackId <trackId>`
- `npm run whisperx -- --trackId <trackId> --language en --device cpu --model small`

Per-track failures do not abort the whole run; errors are written to:
- `assets/<workId>/<trackId>/ai-preprocess.log.json`

