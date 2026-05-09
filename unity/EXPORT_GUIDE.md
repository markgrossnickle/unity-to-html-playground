# Export Guide: Unity 2D Animation → Phaser

End-to-end recipe. You start with a layered 2D rig and an `AnimationClip` in Unity. You finish with three files (`animation.json`, `atlas.png`, `atlas.json`) the Phaser runtime in `html/` can play back.

## Prerequisites

- Unity 6.x (tested mentally against 6000.x; no 6-only API is used so older Unity versions are likely fine).
- [TexturePacker](https://www.codeandweb.com/texturepacker) for atlas packing. The free tier is sufficient.
- The Phaser runtime in `html/src/runtime/PhaserAnimPlayer.ts`.

## 1. Install the editor script

Copy `unity/Editor/` from this repo into your Unity project's `Assets/Editor/` folder. After the next compile, Unity will show a new menu: **Tools → Phaser Anim Exporter**.

```
YourUnityProject/
  Assets/
    Editor/
      PhaserAnimExporter.cs   ← drop here
```

Anything inside an `Assets/Editor/` folder is editor-only and is not included in player builds, so this won't bloat your game.

## 2. Set up a test rig (if you don't already have one)

If you just want to verify the pipeline:

1. New 2D scene.
2. Author or import three placeholder sprites — call them `torso`, `head`, `arm`.
3. Create an empty GameObject `Rig`. Parent three `SpriteRenderer` GameObjects under it: `torso`, `head`, `arm`. Assign sprites; set `Sorting Order` to 0 / 2 / 1 respectively (head on top, arm in the middle, torso at the back).
4. Set Project Settings → Editor → **Pixels Per Unit = 1** if you want the exported `x/y` values to be in screen pixels. (Optional, but matches the spec; otherwise multiply on the runtime side.)
5. Animation window → Create new clip `wave.anim`. Record:
   - On the root `Rig`: nothing. Animate children.
   - On `torso`: a small `localPosition.y` bob (e.g. 0 → 2 → 0 over 2s).
   - On `head`: `localPosition.y` 40 → 44 → 40, plus a `m_Sprite` swap halfway through if you have a second head sprite.
   - On `arm`: a `localEulerAnglesRaw.z` swing 0 → 30 → 0.
6. Save.

## 3. Export

1. **Tools → Phaser Anim Exporter**.
2. Drag `Rig` (the root GameObject) into **Rig root**.
3. Drag `wave.anim` into **Animation clip**.
4. Click **Browse** and choose an empty folder anywhere on disk *outside* `Assets/` (so Unity doesn't try to import the output).
5. Click **Export**.

You'll get:

```
<output>/
  animation.json
  sprites/
    torso.png
    head.png
    arm.png
    ...
```

The Console will log a summary line — number of layers, number of unique sprites, JSON byte size, total atlas-input size. If something was skipped (an unsupported curve, an animator-driven property), it's listed there too.

## 4. Pack the atlas

In the same `<output>/` folder, run TexturePacker:

```sh
texturepacker \
  --format phaser3 \
  --data atlas.json \
  --sheet atlas.png \
  --trim-mode None \
  --shape-padding 2 \
  sprites
```

(GUI users: open TexturePacker, drag `sprites/`, set Framework to **Phaser (JSONHash)**, output `atlas.json` + `atlas.png` next to `animation.json`.)

Important:

- **Trim mode = None** keeps each frame's source bounds intact. The runtime sets sprite origin from atlas frame metadata, but for the simplest behavior keep frames untrimmed.
- **Frame names = filename** (TexturePacker default). The animation JSON references frames by name.
- Don't enable rotation. The runtime reads frames as plain images.

## 5. Drop into the Phaser example

Replace the contents of `html/examples/animation-playback/assets/`:

```
html/examples/animation-playback/assets/
  animation.json   ← from Unity
  atlas.png        ← from TexturePacker
  atlas.json       ← from TexturePacker
```

Then:

```sh
cd html
npm install        # first time only
npm run dev
```

Open the printed URL. The landing page lists the example. Click "Animation Playback".

## 6. Common issues

- **"animation plays but layers are in the wrong order."** Check `SpriteRenderer.sortingOrder` on each layer in your Unity rig — that's what the exporter reads for `depth`.
- **"frame swaps don't appear."** Confirm the atlas frame name matches the sprite name in Unity (look at the Unity asset name, not the file name on disk; for atlas slices these can differ). Frame name mismatches show up as missing frames in Phaser's console.
- **"motion is huge/tiny."** Pixels-per-unit mismatch. Either re-author with PPU=1 or scale the player container on the runtime side.
- **"position is mirrored vertically."** You're applying Y without flipping. Either use `PhaserAnimPlayer` (it flips for you) or negate Y in your custom runtime.
- **"export skipped properties: SpriteRenderer.m_Color"** — expected; only the curve types listed in `SPEC.md` are supported. Add more in `MapFloatProperty` if you need them.
