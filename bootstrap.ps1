# bootstrap.ps1
$ErrorActionPreference = "Stop"

# Folder structure
$dirs = @(
  "apps/dev-viewer/src",
  "packages/engine/src",
  "packages/recipes",
  "packages/preprocess",
  "schemas",
  "tools",
  "dev-assets",          # ignored, for local mp3/wav/images
  "tracks"               # optional: checked-in example track.json (small)
)

foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# .gitignore
$gitignorePath = ".gitignore"
if (-not (Test-Path $gitignorePath)) {
@"
# Node
node_modules/
dist/
build/
.cache/
.vite/
*.log

# Python
.venv/
venv/
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/

# Env / secrets
.env
.env.*
!.env.example

# OS / Editor
.DS_Store
Thumbs.db
.vscode/
.idea/

# Dev media assets (keep out of git)
dev-assets/
release-bundles/
"@ | Set-Content -Encoding UTF8 $gitignorePath
}

# README
$readmePath = "README.md"
if (-not (Test-Path $readmePath)) {
@"
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

"@ | Set-Content -Encoding UTF8 $readmePath
}

# Root package.json (workspace)
$pkgPath = "package.json"
if (-not (Test-Path $pkgPath)) {
@"
{
  "name": "gen-music-visualizer",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
"@ | Set-Content -Encoding UTF8 $pkgPath
}

# Track schema stub
$trackSchemaPath = "schemas/track.schema.json"
if (-not (Test-Path $trackSchemaPath)) {
@"
{
  "\$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Track v0",
  "type": "object",
  "required": ["trackId", "slug", "title", "audio", "composer"],
  "properties": {
    "trackId": { "type": "string" },
    "slug": { "type": "string" },
    "title": { "type": "string" },
    "audio": {
      "type": "object",
      "required": ["filename", "path"],
      "properties": {
        "filename": { "type": "string" },
        "path": { "type": "string" },
        "cidOrTx": { "type": "string" },
        "mime": { "type": "string" },
        "bytes": { "type": "integer" },
        "durationMs": { "type": "integer" },
        "contentHash": { "type": "string" }
      },
      "additionalProperties": true
    },
    "composer": {
      "type": "object",
      "required": ["rawText"],
      "properties": {
        "rawText": { "type": "string" },
        "headerMap": { "type": "object", "additionalProperties": true }
      },
      "additionalProperties": true
    },
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "labelRaw"],
        "properties": {
          "id": { "type": "string" },
          "labelRaw": { "type": "string" },
          "labelNorm": { "type": "string" },
          "t0Ms": { "type": "integer" },
          "t1Ms": { "type": "integer" },
          "notesRaw": { "type": "string" }
        },
        "additionalProperties": true
      }
    },
    "lyrics": {
      "type": "object",
      "properties": {
        "rawText": { "type": "string" },
        "lines": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["t0Ms", "text"],
            "properties": {
              "t0Ms": { "type": "integer" },
              "t1Ms": { "type": "integer" },
              "text": { "type": "string" },
              "sectionId": { "type": "string" }
            },
            "additionalProperties": true
          }
        }
      },
      "additionalProperties": true
    }
  },
  "additionalProperties": true
}
"@ | Set-Content -Encoding UTF8 $trackSchemaPath
}

# Example track.json from your metadata (no timings yet)
$exampleTrackPath = "tracks/two-tones-one-reset.track.json"
if (-not (Test-Path $exampleTrackPath)) {
@"
{
  "trackId": "ttor_v1_0",
  "slug": "two-tones-one-reset",
  "title": "Two Tones, One Reset",
  "audio": {
    "filename": "two-tones-one-reset.mp3",
    "path": "../dev-assets/two-tones-one-reset.mp3",
    "cidOrTx": "",
    "mime": "audio/mpeg"
  },
  "composer": {
    "rawText": "[Title: Two Tones, One Reset]\n[Theme: Random]\n[Variation: Random 2]\n[Gradients: 2]\n[Seed: 86]\n[Style: minimalist instrumental, soloist and accompanist, experimental ambient, glass textures, clean studio recording]\n[Image: soft two-color gradient with subtle motion]\n[Caption: A minimal refresh — same idea, new breath.]\n[Composer Version: v1.0]\n\n[Intro]\n[Glass harmonica enters alone, slow sustained tones, wide stereo.]\n\n[Development]\n[Analog modular synth fades in beneath, low harmonic pulse, gentle filter movement.]\n\n[Refresh]\n[The opening motif repeats with slight timing variation, as if reloaded.]\n\n[Ending]\n[The synth drops out first, leaving a single glass harmonic that fades into silence.]\n",
    "headerMap": {
      "Title": "Two Tones, One Reset",
      "Theme": "Random",
      "Variation": "Random 2",
      "Gradients": "2",
      "Seed": "86",
      "Style": "minimalist instrumental, soloist and accompanist, experimental ambient, glass textures, clean studio recording",
      "Image": "soft two-color gradient with subtle motion",
      "Caption": "A minimal refresh — same idea, new breath.",
      "Composer Version": "v1.0"
    }
  },
  "sections": [
    { "id": "intro", "labelRaw": "Intro", "notesRaw": "Glass harmonica enters alone, slow sustained tones, wide stereo." },
    { "id": "development", "labelRaw": "Development", "notesRaw": "Analog modular synth fades in beneath, low harmonic pulse, gentle filter movement." },
    { "id": "refresh", "labelRaw": "Refresh", "notesRaw": "The opening motif repeats with slight timing variation, as if reloaded." },
    { "id": "ending", "labelRaw": "Ending", "notesRaw": "The synth drops out first, leaving a single glass harmonic that fades into silence." }
  ]
}
"@ | Set-Content -Encoding UTF8 $exampleTrackPath
}

Write-Host "Bootstrap complete."
Write-Host "Next: npm init in apps/dev-viewer and packages/engine, or tell me if you want me to generate those starter package.json files too."
