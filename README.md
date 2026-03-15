# Generative Music Visualizer (WIP)

Local-first Canvas2D visualizer with:
- versioned engine + recipes (JSON5)
- per-track single data file (track.json)
- preprocess tools that derive timing/structure/lyrics maps

## Structure
- apps/dev-viewer: Vite dev viewer
- packages/engine: renderer + RNG + weighted choice + constraints
- packages/palettes: shared palette presets and helpers
- packages/recipes: scene recipes (JSON5)
- schemas: JSON schema for tracked `tracks/<trackId>.track.json`
- inbox/ (gitignored): drop new source files here
- assets/<workId>/<trackId>/ (gitignored): imported media + composer/timing files
- tracks/<trackId>.track.json (tracked): small generated track metadata

## Recipe Resolvable Values (Deterministic)
Layer `params` support deterministic expression objects (all resolved from absolute time + seed + signals):
- `{"const": ...}`: explicit literal passthrough
- `{"signal": "audio.amp"}`: read from render state / signal bus path
- `{"pick": [...], "w": [...]}`: deterministic weighted choice (seed + param path)
- `{"map": "audio.amp", "from":[0,1], "to":[10,40], "ease":"linear|in|out|inOut"}`
- `{"lfo":{"hz":0.2,"amp":0.5,"bias":1.0,"phase":0,"wave":"sine|tri|saw"}}`
- `{"mul":[exprA, exprB, ...]}` and `{"add":[exprA, exprB, ...]}`

This keeps seek deterministic: a frame depends only on current timestamp + seed + inputs, never on prior-frame simulation history.

## Composer Visual Hints v1 (Best Effort)
Composer headers can provide high-level visualization intent. These are parsed into `track.visualHints` during `build-track`, then mapped to runtime recipe adjustments.

Supported header keys (aliases with `Viz ...` also accepted):
- `[Visual Mood: calm|tense|uplifting|dark]`
- `[Visual Motion: low|medium|high]`
- `[Visual Density: sparse|normal|dense]`
- `[Visual Lyric Presence: off|on|auto]`
- `[Visual Color Bias: cool|warm|neutral]`
- `[Visual Section Focus: intro|verse|chorus|bridge|outro]`
- `[Visual NoGo: lyrics, text, particles, strobe, rapid-cuts]`

Notes:
- Hints are intentionally high-level and deterministic-safe.
- Mapping is best-effort and non-destructive: base recipes still load, hints apply as constrained overrides.
- Next step (drafted in `composer-gpt/VisualHints.json`): section-level hint lines
  - `[Visual: key=value; key=value; ...]` under section labels
  - Intended for compile-time recipe generation, not ad-hoc runtime mutation.

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
8. Run the dev viewer with Vite:
   - local only: `npm run dev`
   - local network / IP access: `npm --workspace apps/dev-viewer run dev -- --host 0.0.0.0`
   - optional fixed port for LAN testing: `npm --workspace apps/dev-viewer run dev -- --host 0.0.0.0 --port 5173`
   - open `http://localhost:5173` on the current machine, or `http://<your-local-ip>:5173` from another device on the same network
   - Optional viewer mode query param: `?mode=player|hint-edit|primitive-lab|transition-lab` (default `player`).
   - In `primitive-lab`, use `j/k` to switch primitives, then vary only by seed (`seed` button, `r` key, or `?seed=...`).
   - In `player`, renderer runs a deterministic seeded section playbook with section transitions and scene variation over time.
   - In `transition-lab`, renderer holds the graph scene steady while cycling deterministic transition variants against section boundaries.
   - Section transitions are registry-based with built-ins: `cut`, `crossfade`, `wipe`, `noiseDissolve`, `sliceStepWipe`, `directionalBlurWipe`, `lumaDissolve`.
   - Graph node params support the same deterministic resolvable values (`map`, `pick`, `lfo`, `signal`, `add`, `mul`).
   - Built-in graph primitives cover backgrounds, particles, signal/noise fields, glitch, pressure/energy blooms, audio-reactive overlays, geometric curves, and lyric/text treatments.
   - Primitive-lab currently surfaces: `bg.gradientField`, `fg.particles`, `field.signalNoiseBlend`, `glitch.persistentOffset`, `energy.pressureBloom`, `shape.beatOrb`, `overlay.beatTrack`, `viz.waveStrip`, `viz.spectrumBars`, `viz.responsiveRings`, `shape.circlePulse`, `frame.haloArcs`, `frame.orbitTicks`, `frame.arcLattice`, `polyline.orbitRibbon`, `curve.rosetteSpiral`, `text.echoWord`, `text.wordTrails`, and `text.karaoke`.
   - `curve.rosetteSpiral` supports `mode`, `connectMode`, `symmetrySnap`, `skip`, and optional `color: "black"` for high-contrast variants.
   - In `transition-lab`, `j/k` select previous/next graph, `r` refreshes variant, and `a` toggles auto refresh.

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
  - `.\tools\wsl\run-ai.ps1 -Task beats -TaskArgs @("--trackId", "<trackId>")`
  - `.\tools\wsl\run-ai.ps1 -Task whisperx -TaskArgs @("--trackId", "<trackId>", "--device", "cpu", "--model", "small", "--language", "en")`

Notes:
- Default conda env is `refresh-ai` (override via `-CondaEnv <name>` in PowerShell or `CONDA_ENV_NAME=<name>` in WSL).
  - Use `-SkipConda` (PowerShell) or `SKIP_CONDA=1` (WSL) if Python deps are already in PATH without conda activation.
- `tools/wsl/run-ai.ps1` now prints the exact WSL command it is running and preflights WhisperX for the `whisperx` task.

### AI Repair Workflow
Use this when lyric timing or displayed words look wrong.

1. Repair indexes and lyric line timing from existing AI outputs:
   - one track: `npm run preprocess -- --trackId <trackId>`
   - all tracks: `npm run preprocess`
2. If the raw transcript itself is wrong, rerun WhisperX in WSL, then rebuild the track:
   - `.\tools\repair-track-ai.ps1 -TrackId <trackId> -RerunWhisperx`
   - equivalent explicit sequence:
     - `.\tools\wsl\run-ai.ps1 -Task whisperx -TaskArgs @("--trackId", "<trackId>", "--overwrite-ai", "--device", "cpu", "--model", "small", "--language", "en")`
     - `npm run preprocess -- --trackId <trackId>`
3. Check for likely lyric-timing problems before opening the viewer:
   - all tracks: `npm run check:lyrics`
   - one track: `npm run check:lyrics -- --trackId <trackId>`

`check:lyrics` flags:
- words with no lyric line index
- lyric lines with no `timing.lyricsLines` row
- large timing gaps between lyric lines
- lyric lines that land inside `instrumental` / `drop` / `breakdown` sections

## Static Release Packaging (Vercel + ARweave)
Use one static package output that works for both:
- Vercel static hosting
- Arweave upload (same folder contents)

Command:
- `npm run build:package`
  - Runs `build:release`
  - Copies app build output
  - Copies selected tracks and required assets
  - Pre-resolves per-track recipes into static files
  - Writes output to `release/site`

Options:
- `npm run build:package -- --trackId <id1,id2,...>`
  - Include only specific tracks
- `npm run build:package -- --outDir <dir>`
  - Change output folder

Output layout:
- `release/site/index.html`
- `release/site/assets/...`
- `release/site/tracks/index.json`
- `release/site/tracks/<trackId>.track.json`
- `release/site/recipes/<trackId>.json`

Notes:
- Release mode is read-only (authoring event writes are disabled).
- Viewer in release mode loads static per-track recipe files instead of `/recipes/resolve`.

Optional filters:
- `npm run stems -- --trackId <trackId>`
- `npm run beats -- --trackId <trackId>`
- `npm run whisperx -- --trackId <trackId> --language en --device cpu --model small`

Per-track failures do not abort the whole run; errors are written to:
- `assets/<workId>/<trackId>/ai-preprocess.log.json`

## Hint Events + Effective State
Authoring mode supports lightweight beat/downbeat hint events from the dev viewer.

- Local-only track files:
  - `assets/<workId>/<trackId>/events.jsonl` (append-only hint events)
  - `assets/<workId>/<trackId>/effective.json` (reduced effective timing/overlay state)
- Beat-grid override:
  - If AI beat detection lands on a subdivision that is too fast (for example eighth notes when quarter notes would be better), add `"beatReducer": { "aiBeatDivisor": 2 }` to `tracks/<trackId>.track.json`.
  - Then regenerate only the reduced timing state with `node tools/reduce-effective-all.mjs --trackId <trackId>`.
  - `aiBeatDivisor: 2` keeps every second AI beat; larger values decimate further.
- Dev viewer hint hotkeys:
  - `d`: downbeat hint at current playhead
  - `b`: beat hint at current playhead
  - `1`/`2`/`3`/`4`: bar-beat hint (`beatInBar`)
  - `v`: cycle viewer mode (`player` -> `hint-edit` -> `primitive-lab` -> `transition-lab`)
- Authoring persistence:
  - Hints are written via local dev API and reduced with debounce.
  - Reducer also runs after `beats` / `whisperx` updates.
- Release mode:
  - Viewer is read-only for hints (no event writes).
  - Use deterministic reducer before release:
    - `npm run reduce:effective`
    - `npm run build:release`

