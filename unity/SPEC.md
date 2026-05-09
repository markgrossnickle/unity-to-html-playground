# Phaser Animation JSON Spec

The format produced by `PhaserAnimExporter.cs` and consumed by `PhaserAnimPlayer.ts`. Versionless; if we ever need to break compatibility, add a top-level `"version": 2` field and branch on it.

## File set

A single export produces:

- `animation.json` — this file.
- `sprites/<name>.png` — one PNG per unique `Sprite` referenced by the clip (atlas slices are extracted to their own PNG). Feed this folder to TexturePacker to produce the atlas — the JSON keys never reference sprite source paths, only frame *names*, so the atlas can be packed however you like.

The user is expected to run TexturePacker (or any equivalent) on `sprites/` to produce `atlas.png` + `atlas.json` in [Phaser 3](https://phaser.io) JSON-Hash or JSON-Array format. Frame names must equal the original sprite names — the default TexturePacker behavior.

## Top level

```jsonc
{
  "name":      "character_run",   // string — clip name (informational)
  "duration":  2.0,               // number — seconds; matches Unity AnimationClip.length
  "frameRate": 30,                // number — clip's authored frame rate (informational; runtime uses real time)
  "atlas":     "atlas.json",      // string — relative path to the atlas JSON the runtime should load
  "layers":    [ ... ],
  "tracks":    { ... }
}
```

## `layers`

Ordered, lowest depth first (drawn first / behind).

```jsonc
{
  "name":         "torso",        // string — Unity transform path relative to the rig root, e.g. "body/torso"
  "defaultFrame": "torso_01",     // string — frame to show when no spriteFrame track exists or no key has fired yet
  "depth":        0               // number — taken from SpriteRenderer.sortingOrder on the rig at export time
}
```

## `tracks`

Object keyed by `layer.name`. Each layer has zero or more of these tracks. A track absent from this object means "the layer is static on that channel" — the runtime leaves it at its default.

| Track          | Type                       | Units                                      | Interpolation |
|----------------|----------------------------|--------------------------------------------|---------------|
| `x`            | `[time, value][]`          | pixels (Unity local-position units; PPU=1) | linear        |
| `y`            | `[time, value][]`          | pixels (Unity-style: Y is up-positive)     | linear        |
| `rotation`     | `[time, value][]`          | degrees (Unity-style: CCW is positive)     | linear        |
| `scaleX`       | `[time, value][]`          | multiplier (1.0 = no scale)                | linear        |
| `scaleY`       | `[time, value][]`          | multiplier                                 | linear        |
| `spriteFrame`  | `[time, frameName][]`      | atlas frame name (string)                  | step (held)   |

`time` is seconds from the start of the clip. Times must be non-decreasing within a track. Keyframe times are preserved verbatim from the Unity clip — the exporter does not resample to a fixed frame rate.

### Interpolation semantics

- **Transform tracks** (`x`, `y`, `rotation`, `scaleX`, `scaleY`): linear interpolation between adjacent keyframes. Before the first key, hold the first value. After the last key, hold the last value.
- **`spriteFrame`**: step interpolation. The active frame is the value of the most recent key whose `time ≤ currentTime`. Before the first key, the layer shows `defaultFrame`.

### Coordinate-system note

Unity is Y-up, Phaser is Y-down. Unity rotation is CCW-positive, Phaser rotation is CW-positive. The exporter writes **Unity-native values** unchanged; the runtime negates Y and rotation when it applies them to Phaser game objects so authored intent matches what you see on screen. If you write a custom runtime, do the same flip.

### PPU note

`x` and `y` are emitted as Unity `localPosition` values verbatim. Author your rig with **pixels-per-unit = 1** (one Unity unit = one screen pixel) for the cleanest mapping. If your rig was authored at PPU=100, multiply the values you read by 100 — or fix it at the rig and re-export, which is cheaper.

## Example

```json
{
  "name": "wave",
  "duration": 2.0,
  "frameRate": 30,
  "atlas": "atlas.json",
  "layers": [
    { "name": "torso", "defaultFrame": "torso_01", "depth": 0 },
    { "name": "head",  "defaultFrame": "head_01",  "depth": 1 }
  ],
  "tracks": {
    "torso": {
      "x":        [[0, 0], [1, 4], [2, 0]],
      "rotation": [[0, 0], [1, 5], [2, 0]]
    },
    "head": {
      "y":           [[0, 40], [1, 44], [2, 40]],
      "spriteFrame": [[0, "head_01"], [0.5, "head_02"], [1.0, "head_01"]]
    }
  }
}
```

## Not in scope

The exporter intentionally does not emit:

- Tangent / Bezier handles. Unity clips can hold per-key in/out tangents; we discard them and rely on linear interpolation. If a future clip uses heavily curved transforms, add a `"interpolation": "bezier"` track variant rather than expanding linear tracks.
- Color, alpha, or material-property tracks. Easy to add — wire them through `MapFloatProperty` in the exporter and apply them in the runtime.
- Animation events. Unity events are C# method calls; they don't translate.
- Z-translation, 3D rotation, 3D scale.
- Hierarchy reparenting or visibility toggles.
