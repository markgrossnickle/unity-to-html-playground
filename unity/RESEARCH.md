# Unity 2D → HTML/Web: Pipeline Research Memo

**Status:** Research draft, May 2026
**Audience:** Engineers picking a pipeline for taking 2D animation work that currently lives in Unity and running it in a browser.
**TL;DR (one paragraph):** Unity's official answer is a WebGL/WebAssembly build. It works, it has gotten genuinely better in Unity 6.3 LTS, and on desktop it is fine. On mobile (and especially iOS Safari) it is still a hostile environment — large bundles, audio quirks, WebGL 1.0 fallback, memory ceilings. For anything that isn't "ship a Unity game to the web," the right move is almost always to **author in a tool with a real web runtime in the first place** (Spine, Rive, Lottie, Live2D, or just sprite-sheets) and use Unity as a *consumer* rather than the source of truth. The single highest-leverage decision in this space is whether your asset's authoring format has a first-class web runtime — once you've answered that, everything else is plumbing.

---

## Table of Contents

1. [Unity WebGL build (the official path)](#1-unity-webgl-build-the-official-path)
2. [Sprite-sheet / atlas export from Unity](#2-sprite-sheet--atlas-export-from-unity)
3. [Skeletal 2D rigs](#3-skeletal-2d-rigs)
4. [PSB / multi-layer sprite workflows](#4-psb--multi-layer-sprite-workflows)
5. [Timeline / Cinemachine — what is portable, what is engine-locked](#5-timeline--cinemachine--what-is-portable-what-is-engine-locked)
6. [Audio and interactivity](#6-audio-and-interactivity)
7. [Recommended pipelines for our three project shapes](#7-recommended-pipelines)
8. [Tooling versions and gotchas as of May 2026](#8-tooling-versions-and-gotchas-as-of-may-2026)
9. [Decision matrix](#9-decision-matrix-quick-reference)
10. [Open questions and follow-ups](#10-open-questions-and-follow-ups)

---

## 1. Unity WebGL build (the official path)

### 1.1 What it actually is

Unity's WebGL "platform" is a build target that compiles your C# game code to WebAssembly via IL2CPP, ships a JavaScript loader that boots up a virtual machine in the browser, and renders into a `<canvas>` element using WebGL 2.0 (with a WebGL 1.0 fallback path that is still relevant in 2026 for older mobile Safari builds). The build output is a folder containing:

- `index.html` — the loader page Unity gives you (most teams replace or wrap this).
- `Build/<name>.loader.js` — the JS bootstrapper.
- `Build/<name>.framework.js` — Unity's JS-side runtime glue.
- `Build/<name>.wasm` — your compiled engine + game code.
- `Build/<name>.data` — your asset bundle (textures, audio, scenes, etc.).
- `TemplateData/` — favicon, splash, etc.

In Unity 6.3 LTS (Dec 2025), the WebGL stack was meaningfully revamped: ~12,000 lines of code were removed from URP for smaller iteration size and smaller builds, depth blit support was added, MSAA resolve happens automatically when needed, and WebGL2/GLES3 fallbacks are handled correctly. Unity also officially declared WebGL on *mobile* a supported configuration in Unity 6 — which is a marketing claim more than a stability claim, but the situation is materially better than it was a couple of years ago.

### 1.2 What it does well

- **Code parity.** The same `MonoBehaviour` you wrote for Standalone runs in the browser. There is no separate "web port." This is the single best thing about this pipeline.
- **Full Unity feature surface.** Animator state machines, Timeline, particle systems, custom shaders (with caveats), 2D Animation, Cinemachine, physics, audio mixers — all of it runs.
- **Stable input model.** Mouse, touch, keyboard, gamepad, accelerometer all surface through Unity's input systems with the usual quirks but no surprises.
- **WebGPU is on the horizon (but not yet).** Unity has a WebGPU graphics backend in preview as of 6.3. It is not the default and not production-ready, but for forward-looking projects it removes some of the worst WebGL 1.0 fallback pain on iOS once Apple ships full WebGPU support.

### 1.3 What it does badly (the honest list)

- **Bundle size.** A "trivial" 2D scene comes out to ~5–10 MB. A non-trivial project routinely hits 30–60 MB compressed, 100+ MB uncompressed. Brotli helps; CDN caching helps; nothing eliminates it. This is a *killer* for marketing-site use cases where you need first-paint < 2s.
- **Cold-start time.** Even with a small bundle, the WebAssembly compile + asset decompress + scene-load cost is multiple seconds on mid-range mobile. There is no way to render a single frame before the engine boots.
- **iOS Safari is still a minefield.**
  - Safari on iOS has historically been WebGL 1.0–only; WebGL 2.0 support has rolled in but is not universal across iOS versions you'll see in the wild.
  - IndexedDB does not work for content running inside an `<iframe>` on Safari, which breaks Unity's caching layer when your build is embedded.
  - Memory ceiling: iOS Safari aggressively reaps tabs that exceed ~300–500 MB of memory. Unity's heap allocations push you toward this faster than you'd think.
- **Audio quirks (see §6 for detail).** The most common production bug: silent mode on iOS silently mutes WebAudio nodes that Unity uses for `DecompressOnLoad` clips, but not for `CompressedInMemory` clips. This is non-obvious and tends to ship in production before anyone catches it.
- **No multithreading on Safari historically.** Unity uses `SharedArrayBuffer` for threaded WebAssembly, which requires COOP/COEP cross-origin isolation headers. Safari now supports it, but if you embed in a CMS or a marketing iframe you will lose it. Most Unity WebGL builds currently ship single-threaded.
- **No native fullscreen on iOS.** Unity's fullscreen API call lands on Safari's "doesn't actually go fullscreen" behavior. You have to design around the chrome being there.
- **No instant CDN-friendly streaming.** The `.data` bundle is monolithic. Addressables help but add complexity.
- **Shader subsetting.** Compute shaders, certain texture array operations, some HDRP features either don't work or fall back. URP is the only sensible choice for WebGL.

### 1.4 When to use Unity WebGL anyway

- The project is already a Unity game and porting to a web engine would be a rewrite.
- The audience is desktop-first or you ship inside a wrapped webview where you control the environment.
- You need physics, complex state machines, or the full Unity feature surface, and budget rules out a rewrite in Phaser/Pixi.
- You are deploying to a portal that expects WebGL builds (itch.io, CrazyGames, GameJolt, Poki, etc.) — these portals are tuned for Unity bundles.

### 1.5 When to avoid

- Marketing site hero animations. Use Lottie, Rive, video, or a sprite-sheet — not a 30 MB WASM blob — for a 6-second loop.
- iOS-Safari-first audiences (consumer apps, social embeds).
- Anything that needs to interleave with React/Vue components naturally — Unity's `<canvas>` is an island. You can pipe events in/out via `SendMessage` and `[DllImport("__Internal")]`, but it is friction.
- Tight first-paint budgets (< 3s on 4G mobile).

### 1.6 Bundle-size playbook (if you must)

In rough priority order, the levers that actually move the needle:
1. **Strip engine code aggressively.** Strip Engine Code = High, Managed Stripping Level = High. Expect to chase reflection-related runtime errors; budget for it.
2. **Brotli compression.** Disable Unity's "decompression fallback" and serve `.br` directly with proper `Content-Encoding`. This is a 30–40% size win over gzip.
3. **Texture atlas + ASTC/ETC2 with WebGL 2.0 builds.** ASTC is supported on most modern mobile; falls back to ETC2. Avoid uncompressed RGBA where you can.
4. **Audio: Vorbis at moderate quality, not uncompressed PCM.** Keep music as streaming, SFX as `CompressedInMemory` (this also fixes the iOS silent-mode bug — see §6).
5. **Addressables with remote groups** if you can split first-load from later-load content.
6. **Disable physics2D, animator, particles** in Player Settings if you don't use them. Each is multi-MB.

### 1.7 Embedding into a web app

- The standard Unity loader exposes `createUnityInstance(canvas, config)` returning a `unityInstance`. Hold onto it; you can call `unityInstance.SendMessage(go, method, value)` from JS and call `unityInstance.Quit()` to tear down.
- Bidirectional comms: from C# call `Application.ExternalCall` (deprecated) or use `[DllImport("__Internal")] static extern void JSFunc()` against a `.jslib` plug-in. From JS call `SendMessage`. Pass JSON strings; don't try to share complex object graphs.
- React integration: `react-unity-webgl` is the maintained wrapper. It handles mount/unmount lifecycle and message bus correctly. Note that mounting/unmounting has cost — Unity teardown is not free, do not stick a Unity instance inside a list-virtualized component.

### 1.8 Hosting checklist

- Serve `Build/*.wasm` with `Content-Type: application/wasm` (Brotli-compressed, `Content-Encoding: br`).
- Set `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` if you want threaded WASM. Drop them if you're embedded in iframes that you can't control.
- Cache `Build/*` aggressively with hashed filenames; cache `index.html` for short windows only.

---

## 2. Sprite-sheet / atlas export from Unity

This is the "lowest common denominator" pipeline: extract the visual frames out of Unity, ship them as PNG/WebP atlases plus a small JSON metadata file, and play them back in the browser with PixiJS, Phaser, plain `<canvas>`, or even CSS animations. It works for everything that is fundamentally a flipbook, and for mechanim-driven sprite swaps. It does *not* preserve game logic, animator state machines, or anything beyond raw visual frames.

### 2.1 The fundamental mismatch

Unity's "Animation Clip" (`.anim` asset) is not a sequence of pre-rendered frames. It is a curve-based keyframe data structure that can animate *any property* on *any component*, including `SpriteRenderer.sprite`, `Image.sprite`, transforms, color, custom material properties, etc. There is no built-in "export this clip as a sprite sheet" button, because Unity doesn't think of clips that way.

You have two practical exit strategies:

- **Bake at runtime → Recorder.** Run the animation in the editor, capture each frame with Unity Recorder, post-process into an atlas. Lossy, simple, works for everything visual.
- **Parse the AnimationClip metadata.** Walk the curves with an editor script and write a JSON of (frame, sprite-name, transform). Smaller output, but only handles clips that *are* in fact pure sprite-swap clips with optional transform.

### 2.2 Bake via Unity Recorder

The Unity Recorder package (currently `com.unity.recorder` 4.0.x in Unity 6.3) supports `Image Sequence` recorders that can output PNG/JPG/EXR per frame. Workflow:

1. Install `com.unity.recorder` via Package Manager.
2. Window → General → Recorder → Recorder Window.
3. Add `Image Sequence` recorder, set Source to Game View or a Targeted Camera, format to PNG with alpha, frame rate to your animation's frame rate, output path to an outside-Assets folder.
4. Set up your scene so the camera frames just the animated GameObject against a transparent background. URP "Transparent" camera background is the easy way; for built-in pipeline you may need a render-texture trick.
5. Press Start Recording, advance through your animation (Timeline, scripted, or just play the clip), Stop.

You now have `frame_0001.png … frame_NNNN.png`. **Recorder does not pack these into an atlas.** Use one of:

- **TexturePacker** (CodeAndWeb) — the workhorse. Has explicit "PixiJS", "Phaser 3", "Unity", "Spine", "Cocos2d" output presets, supports trim/rotate/extrude, normal-map atlases, and JSON-Hash / JSON-Array formats. Free tier exists; paid tier removes splash and adds command-line use.
- **Free Texture Packer** (open source) — usable but rougher edges.
- **SpriteForge** — newer browser-based tool with multi-engine export including PixiJS, Phaser 3, Unity, Godot, Spine, Cocos2d, plus normal-map support. Useful if you don't want desktop tooling.
- **ShoeBox** — free, Adobe AIR-based, still works but unmaintained. Avoid for new projects.

The TexturePacker JSON-Array output looks like:

```json
{
  "frames": [
    { "filename": "walk_001.png",
      "frame": {"x":0,"y":0,"w":64,"h":96},
      "rotated": false,
      "trimmed": true,
      "spriteSourceSize": {"x":4,"y":2,"w":64,"h":96},
      "sourceSize": {"w":72,"h":100} },
    ...
  ],
  "meta": { "image": "atlas.png", "size":{"w":1024,"h":1024}, "scale":"1" }
}
```

Both PixiJS (`PIXI.Assets.load('atlas.json')` → `Spritesheet` → `AnimatedSprite`) and Phaser (`this.load.atlas('hero','atlas.png','atlas.json')`) consume this directly. The "animations" object in the JSON can be hand-authored or output by TexturePacker if you name frames with a numeric suffix per animation (e.g. `walk_001.png`, `walk_002.png`, `idle_001.png`).

**Recommended frame-rate strategy:** Author at the original Unity rate (often 24 or 30 fps), but consider exporting at half-rate for purely-decorative motion (idles, ambient loops). Most viewers won't notice 12 fps for ambient loops and you halve the storage cost.

**Pros:** Universal, format-agnostic, works for *any* animated content (skeletal, particle, shader-driven — all becomes pixels). Trivial to play back.

**Cons:** Storage. A 60-frame 512×512 walk cycle is ~5 MB compressed. You lose all dynamic capability (no runtime tinting beyond simple color filters, no rig-aware swap). Not appropriate for characters with many animation states.

### 2.3 Parse AnimationClip metadata to JSON

If your Unity clip is a plain SpriteRenderer/Image sprite-swap clip — i.e. it animates `m_Sprite` property and maybe `localPosition`, `localRotation`, `color` — you can extract it directly without baking pixels. Editor script approach:

```csharp
using UnityEditor;
using UnityEngine;

public static class ClipExporter {
    [MenuItem("Tools/Export Selected Clip to JSON")]
    public static void Export() {
        var clip = Selection.activeObject as AnimationClip;
        if (clip == null) return;
        var bindings = AnimationUtility.GetObjectReferenceCurveBindings(clip);
        foreach (var b in bindings) {
            var keys = AnimationUtility.GetObjectReferenceCurve(clip, b);
            // keys[i].time, keys[i].value (Sprite reference)
            // serialize spriteName + time per keyframe
        }
        // similarly: AnimationUtility.GetCurveBindings(clip) for float curves
        //  -> AnimationUtility.GetEditorCurve(clip, b) -> AnimationCurve.keys
    }
}
```

Output format we'd use on the web side:

```json
{
  "name": "hero_walk",
  "duration": 1.0,
  "frameRate": 24,
  "tracks": [
    {"path":"Body","property":"sprite","keys":[
      {"t":0.0,"v":"walk_01"},
      {"t":0.083,"v":"walk_02"}
    ]},
    {"path":"Body","property":"position.y","keys":[
      {"t":0.0,"v":0},{"t":0.5,"v":2},{"t":1.0,"v":0}
    ]}
  ]
}
```

Pair this with a TexturePacker atlas keyed by `spriteName` and you have a runtime-tweakable timeline that takes ~kilobytes of JSON.

**Pros:** Tiny output. Runtime tweakable (you can re-tint, re-time, swap atlases). Preserves Unity-side authorial intent.

**Cons:** You must restrict yourself to clips that animate cleanly-translatable properties. The moment a clip touches a custom MonoBehaviour field, a material parameter, or invokes an animation event, you'll lose semantics in the export. Custom editor work required.

### 2.4 Animator state machines — don't try to port them

Unity's `AnimatorController` (state machines, parameters, transitions, blend trees, sub-state-machines) is the single least-portable piece of Unity. There is no clean export. If your character has an Animator with five states and a velocity blend-tree, your options are:

- Re-implement the state machine in JS (typically a hand-coded `switch` or a small library like XState driving sprite-sheet playback).
- Bake each state to its own image-sequence and switch atlases on the JS side based on game state.

Don't sink time looking for a tool that translates `.controller` files to web — there isn't a maintained one.

### 2.5 GIF / WebP / APNG / video

For the very simplest "drop a moving image into a webpage" use-case, skip atlases entirely:

| Format    | Pros | Cons | When |
|-----------|------|------|------|
| **GIF**   | Universally supported, drag-and-drop into any CMS | 256 colors, no alpha (1-bit only), 5–10× larger than equivalent WebP | Fallback only, or banner ads |
| **APNG**  | Full alpha, lossless, supported in all modern browsers | Older safari versions had patchy support; large files | When you need alpha and quality and hate yourself a little |
| **WebP (animated)** | Alpha, much smaller than APNG, good browser support in 2026 | Limited authoring tooling; slight quality artifacts at low quality | **The current best default for short alpha-channel loops** |
| **WebM (VP9)** | Tiny, supports alpha (with `webm` + alpha channel), great quality | No iOS Safari alpha-channel support — alpha shows as black on iOS. Use `<video>`, not `<img>`. | Desktop-first, no-alpha video; or HEVC fallback for iOS |
| **MP4 (H.264/HEVC)** | Universal | No alpha at all in H.264; HEVC alpha works on Apple, fragments elsewhere | Opaque background hero loops |

Practical 2026 recipe for "alpha-channel hero loop, all platforms": ship **WebP-animated** as primary, **HEVC-with-alpha MP4** as iOS-Safari fallback, **APNG** as a last-ditch fallback. The cost is producing three encodes — not ideal, but it sidesteps every browser quirk.

### 2.6 Lottie / dotLottie

Lottie is After-Effects-native; **there is no maintained Unity → Lottie exporter as of May 2026.** The only realistic Lottie pipeline is: animate in After Effects, export with Bodymovin (or Lottie Creator), play with `lottie-web` (or the much smaller `dotlottie-web` for the .lottie binary format). The Airbnb `lottie-web` runtime is mature, the format is well-suited to vector UI motion (icons, micro-interactions), and `.lottie` binary now has decent tooling.

If your asset is *already* in Unity and your team isn't an AE shop, Lottie is not the path. Don't try to coerce Unity into Lottie output via screen-recording — you lose all the size advantages that make Lottie attractive.

A note for completeness: there is an unofficial **Lottie *importer* for Unity** that *plays back* `.json` Lottie files inside Unity (so you can use AE animations as in-game assets). This is the *opposite* of the direction we want and doesn't help here.

### 2.7 Aseprite as an alternate authoring source

Worth flagging because it's the cleanest sprite-sheet pipeline in the industry: animate in **Aseprite**, export with the built-in JSON sprite-sheet exporter, consume in Unity (via `aseprite-importer-for-unity`) *and* in PixiJS/Phaser from the same JSON. If you have ownership over the authoring tool choice, Aseprite-as-source beats Unity-as-source for any pixel-art use case.

---

## 3. Skeletal 2D rigs

Once you move beyond flipbook animation into "this character has bones, deformable mesh, IK, skinning, sprite swap across attachments," you cross a threshold. Your two options are roughly:

- **Author in Unity's 2D Animation package**, then either ship Unity WebGL or eat the pain of trying to export a rig.
- **Author in a tool with a real cross-platform runtime**, use Unity for layout/glue if needed, ship the same source-of-truth rig to the web.

Empirically, option #2 wins almost every time the asset needs to land on the web.

### 3.1 Unity's built-in 2D Animation package — and why it's a one-way road

The `com.unity.2d.animation` package (currently 11.x in Unity 6.3) provides everything Spine does on the authoring side: skinning editor, bones, IK, weight painting, sprite swap categories, sprite library assets, and a PSD importer that turns layered Photoshop files into rigged prefabs. It is genuinely good for a Unity-internal pipeline.

The catch: **the rigged output is a Unity prefab tied to Unity's animation system.** There is no exporter to a portable format. If you rig a character in Unity 2D Animation, your only realistic web path is Unity WebGL.

This is the single biggest "trap" in the Unity-to-web pipeline. Teams adopt 2D Animation because it's free and bundled, then discover months later that they have no migration path to a smaller web runtime. **If there is any chance your character will need to ship to web outside a Unity build, do not author it in Unity 2D Animation.**

### 3.2 Spine — the gold standard

Esoteric Software's Spine is the dominant cross-platform 2D skeletal animation tool. The current state in May 2026:

- **Spine Editor**: 4.2 stable (March 2026), 4.3-beta (April 2026 update).
- **spine-unity 4.2**: stable runtime, supports Unity 2017.1 through 6000.3 (Unity 6.3).
- **spine-unity 4.3-beta**: tracks 4.3-beta editor, same Unity version range.
- **Pricing (2026):** Spine Essential $69 (no meshes, no advanced features), Spine Professional ~$330 one-time. Spine Enterprise required for studios > $500K USD revenue. Both Essential and Pro export to all formats.

**Web runtime:** `spine-ts` is the official TypeScript runtime, with WebGL and Canvas backends and a polished `SpinePlayer` widget that lets you drop a Spine animation into any page with ~10 lines of JS. There's also a Pixi adapter (`@esotericsoftware/spine-pixi-v8`) and a Phaser adapter.

**Pipeline shape:**
1. Author in Spine. Export to skeleton JSON or binary (`.json` or `.skel`), atlas (`.atlas` + PNG), and a meta describing the rig.
2. Import into Unity using spine-unity (drop the three files in the project, the importer creates a `SkeletonDataAsset`).
3. Animate, mix, and drive at runtime using `SkeletonAnimation` / `SkeletonGraphic` MonoBehaviours.
4. For web: ship the **same** `.json/.atlas/.png` triplet to your web app, load with spine-ts.

This is the single best property of Spine: **the asset is the source of truth, not a Unity-rigged thing.** You get rig parity across native game (Unity), iOS native (spine-cpp/spine-libgdx), Android (spine-libgdx/spine-android), and web (spine-ts), with bone-perfect identical output.

**Pros:**
- True portability. Same `.json` plays identically in Unity, iOS, Android, and web.
- Excellent runtime. spine-ts is mature, fast, and small (~150 KB minified gzip for the WebGL build).
- Industry standard — most freelance 2D animators already know Spine.
- The web `SpinePlayer` is genuinely good UX for marketing/portfolio embeds.
- IK, mesh deformation, weighted bones, free-form deform, path constraints, transform constraints all preserved end-to-end.

**Cons:**
- License cost, especially Pro at ~$330/seat. Worth it for any studio doing serious 2D, but a barrier for hobbyist projects.
- Authoring tool has a learning curve. Animators coming from Unity need ~1 week to feel productive.
- Mesh deformation features (the things that make Spine *worth* the Pro license) are not in Essential.
- Older spine-ts versions had subtle differences from spine-unity in tint-black handling and some blend modes — verify your effects look identical in both before shipping.

**When to pick:** Any project with bone-rigged 2D characters that needs to ship to multiple platforms, or to web alongside a native version. **This is the default recommendation for cross-platform character animation in 2026.**

### 3.3 DragonBones — open-source alternative

DragonBones is the open-source competitor to Spine. The data format (`_ske.json` / `_tex.json` / `_tex.png`) is similar in spirit. The web runtime (`DragonBonesJS`) is functional and BSD-licensed. There is a Unity runtime (`DragonBonesUnity`).

**State in May 2026:** the DragonBones project is *barely* maintained. The last meaningful commit on `DragonBonesUnity` is years stale; the JS runtime sees occasional fixes. The desktop authoring tool (DragonBones Pro) is still downloadable and free, but development has stagnated. The pipeline still works — many shipped 2D mobile games use it — but you are not getting bug fixes or new features.

**Pros:** Free, format-portable to web, "good enough" feature set for non-mesh-deform characters.

**Cons:** Effectively a frozen-in-time tool. Don't pick it for new 2026 projects unless cost is the dominant constraint and you've tested the runtime against your needs.

**When to pick:** Hobbyist budget, willing to accept tooling that isn't actively developed. Otherwise, prefer Spine.

### 3.4 Live2D Cubism

Live2D is a different paradigm — it's designed for 2D characters that *appear* 3D, achieved through deformation of layered 2D art rather than rigid bones. The use-cases are mostly anime-style faces, vtuber avatars, and dialogue-heavy character art. Inconveniently for a Unity-to-web pipeline:

**State in May 2026:** Cubism 5 SDK R5 (released April 2026). SDK exists for Unity, Web, and Native. The data format is `.moc3` (binary motion+model) plus textures, and it's identical across platforms — meaning you can author in Cubism Editor, import into Unity via the Cubism SDK for Unity, *and* run the same `.moc3` on the web with the Cubism SDK for Web. Excellent in principle.

**The catch (and it's a big one):** When exporting a Cubism-driven Unity scene to **WebGL**, lip-sync from audio does not work. This is a known SDK limitation — Cubism's audio-driven lip-sync hooks into native audio analysis that doesn't survive the WebGL build. You can pre-bake lip-sync curves into the motion data, but real-time mic-driven sync is off-limits in Unity-WebGL. If your project is "vtuber avatar with live lip-sync," you have to **author with Cubism** and **render with the Cubism SDK for Web directly**, bypassing Unity entirely.

**Pros:** Best-in-class for face/expression-heavy character work. Cross-platform format. Active development.

**Cons:** Only suitable for the specific kind of character animation it's designed for. Pricing is per-revenue (free for indies under a threshold, expensive at studio scale). The Unity-WebGL audio lip-sync gap forces a fork in the pipeline.

**When to pick:** vtuber-style or expression-heavy character work where the asset is fundamentally a layered face, not a body rig with bones. Don't pick for general body animation.

### 3.5 Rive — the rising challenger

Rive is the most interesting newcomer in this space and as of 2026 is becoming a real alternative to Lottie *and* Spine.

**State in May 2026:** Rive for Unity is now in the Unity Asset Store (officially supported, published Jan 2026). It supports Unity's WebGL builds, vector feathering, data binding, state machines, responsive layouts, and reusable components. Out-of-band assets (uploading shared assets once across multiple `.riv` files) was a 2026 addition that significantly improves memory management for complex projects.

**The pipeline:**
1. Author in the Rive Editor (web-based or desktop).
2. Export `.riv` files.
3. Use Rive for Web (`@rive-app/canvas` or `@rive-app/webgl-advanced`) on the web — runtime is small (~100 KB gzipped) and renders to canvas/WebGL/WebGPU.
4. Use Rive for Unity to consume the *same* `.riv` files inside a Unity scene if needed.

**Pros:**
- Format is genuinely portable: same `.riv` runs on web, Unity, iOS, Android, Flutter, React Native.
- The state-machine model is built into the *asset*, not the engine — so logic survives the round-trip, unlike Unity Animator.
- Tiny runtime, vector-based output, scales cleanly.
- Free for individuals and small teams; revenue-based pricing for organizations.
- Data binding lets you drive animation parameters from your app state declaratively.
- WebGPU support is shipping faster than Unity's.

**Cons:**
- Newer ecosystem; smaller community than Spine.
- Vector-only — not a fit for pixel art or photographic content.
- If you have an existing Spine-shaped pipeline, no clean migration path.
- The Unity integration is good but younger than spine-unity; expect occasional rough edges.

**When to pick:** Greenfield projects, especially UI-heavy or product-marketing animation with clear state-machine logic. **Probably the best 2026 choice for "interactive vector animation that needs to run on web and inside Unity."**

### 3.6 Comparison table — skeletal/2D character runtimes

| Tool | Unity runtime | Web runtime | Format portable? | Mesh deform | IK | Pricing | Maintenance |
|------|--------------|-------------|------------------|-------------|-----|---------|-------------|
| **Unity 2D Animation** | Native | None | **No** (Unity-only) | Yes | Yes | Free | Active |
| **Spine** | spine-unity (official) | spine-ts (official) | **Yes** | Yes (Pro) | Yes | $69 / ~$330 / Enterprise | Very active |
| **DragonBones** | DragonBonesUnity | DragonBonesJS | Yes | Limited | Yes | Free | Stagnant |
| **Live2D Cubism** | Cubism SDK for Unity | Cubism SDK for Web | Yes (`.moc3`) | Yes (the whole point) | N/A (different paradigm) | Free for indie / paid above | Active |
| **Rive** | Rive for Unity (Asset Store) | `@rive-app/*` | **Yes** (`.riv`) | Yes (vector) | Limited | Free / revenue-tiered | Very active |

---

## 4. PSB / multi-layer sprite workflows

Unity's PSD Importer (`com.unity.2d.psdimporter`) consumes Photoshop `.psb` files (the "big" PSD format that supports files larger than 2 GB) and turns each layer into a sprite, with the entire layer hierarchy preserved as a Prefab. Combined with the 2D Animation package, you can pull layered Photoshop art and rig it inline in Unity — bones, weights, IK, the whole thing.

### 4.1 How it works in Unity

- Drop a `.psb` into the project. The importer auto-runs.
- The importer creates: an atlas of all the layer sprites packed together, a Prefab that recreates the layer hierarchy as nested GameObjects, optionally a Sprite Library Asset for sprite-swap categories.
- Open the **Skinning Editor** to bone, weight, and configure the rig directly in Unity, without round-tripping back to Photoshop.
- Subsequent re-imports from Photoshop preserve your Unity-side rigging as long as layer names match.

This is genuinely a slick authoring loop *inside Unity*.

### 4.2 What round-trips to web?

- **Layer art** as individual sprites — yes, via the atlas the importer generated. You can extract the underlying packed texture and the metadata, ship to web.
- **Layer hierarchy** — also exportable, via the Prefab, but requires writing a custom serializer (no built-in JSON dump).
- **Bones, weights, IK, animation clips** — *no portable export*. This is the same trap as §3.1 — if you rig a PSB character in Unity 2D Animation, you can't get the rig out.

**Practical recommendation:** if you're using PSB-import to *organize* layered art that you'll later rig elsewhere, that's fine — you can always re-import the original PSB into Spine, Rive, or directly into a web tool. If you're using PSB-import to rig in Unity for a Unity-WebGL build only, that's also fine. The trap is using it to rig for export to "any web environment" because there is no clean export.

### 4.3 Spine's PSD importer is the alternative

Spine ships a PSD-to-Spine importer that does the same layer-hierarchy-to-rig translation, but produces Spine assets that *do* round-trip to web. If your starting point is Photoshop and your endpoint is web, **import the PSD/PSB into Spine, not Unity.**

### 4.4 The Photoshop "Generate Image Assets" trick

For dead-simple cases where you just want each layer as a PNG with the correct positioning, Photoshop's **Generate → Image Assets** feature (rename a layer with a `.png` suffix, Photoshop spits out the PNG) gives you per-layer PNGs in one click. Combine with TexturePacker for an atlas. This is unrelated to Unity but worth knowing — for many "layered illustration with subtle animation" use cases it's the lightest tool.

---

## 5. Timeline / Cinemachine — what is portable, what is engine-locked

### 5.1 Timeline

Unity's Timeline (`com.unity.timeline`) is a multi-track sequencer for orchestrating animation, audio, and signals. It's a rich tool — and almost entirely Unity-engine-locked.

**Portable:**
- The *concept* of a timeline. You can hand-replicate one in JS using GSAP, Anime.js, or a simple `requestAnimationFrame` loop driving keyframes.
- The *outputs* of a timeline, if you bake to video/image-sequence with Unity Recorder. Press play, record frames, ship.

**Not portable:**
- The `.playable` data format. There's no exporter.
- Custom track types and PlayableBehaviours (these are C# scripts that run inside Unity).
- Signal emissions, marker callbacks, sub-timeline references, control tracks targeting GameObjects.
- Animation overrides, blends, mixers — all evaluated by Unity's playable graph.

**Practical:** If you have a Timeline-driven cutscene that absolutely must ship to web, your options are (a) Unity WebGL, or (b) bake to video/image-sequence and play that back. There is no third option.

### 5.2 Cinemachine

Cinemachine is virtual camera logic — follow rigs, dolly tracks, blends, noise, framing. It is *purely* a Unity runtime concept; the cameras are MonoBehaviours that read game-state and spit out camera transforms.

**Portable:** None of it. Cinemachine has no analog outside Unity, and its runtime can't be detached from the engine.

**Workaround:** If your animation is fundamentally camera-driven (e.g., a scrolling reveal, a character walking through a scene), and you need to ship it as a static piece, bake the final camera path to image-sequence/video. You lose all interactivity but the visual output is preserved.

---

## 6. Audio and interactivity

### 6.1 Audio in Unity WebGL — the iOS Safari trap

The single most-shipped production bug from Unity-WebGL projects targeting mobile:

**iOS Silent Mode Switch behaves differently for compressed vs. uncompressed audio.** Unity's `DecompressOnLoad` audio clips become `WebAudioBufferSourceNode`s, which iOS Safari classifies as "audible content" and mutes when silent mode is on. `CompressedInMemory` clips become `MediaElementSourceNode`s, which iOS treats as "media playback" and respects independent of silent mode.

**Fix:** set the load type on every audio clip to `CompressedInMemory` (Audio Import Settings → Web → Load Type). Yes, this is a per-clip setting. Yes, you should script the bulk-edit. Yes, every team trips on this.

Other production gotchas:
- **First audio playback must follow a user gesture.** Web Audio's autoplay policy. Unity handles this if your first audio is triggered after a click; ambient audio that plays on scene load will be silent until user interaction. Wire up a "tap to start" gate.
- **Web Speech API on iOS** must be invoked once from a touch event before it works programmatically. Common workaround: in the WebGL template, attach a `touchend` handler that fires a 0-volume `SpeechSynthesisUtterance` to "prime" the API.
- **Microphone access changes WebGL volume on iOS.** Acquiring a mic via `getUserMedia` boosts global audio volume noticeably. Annoying but rarely breaking.
- **Audio memory.** Unity decodes audio into RAM. On iOS Safari with a 300 MB tab budget, large audio bundles will cause tab kills. Stream music; don't decompress an album into memory.

### 6.2 Audio outside Unity WebGL

If you've extracted to sprite-sheets / Spine / Rive on the web, you choose your own audio stack:
- **Howler.js** — the de-facto web game audio library. Handles the Web Audio quirks, sprite playback, autoplay gating, and falls back gracefully. Tiny.
- **Web Audio API directly** — fine if you only need basic playback.
- **Tone.js** — heavyweight, only if you're doing music synthesis or scheduling-heavy work.

For most animation-with-audio web projects, Howler is the right answer.

### 6.3 Interactivity beyond passive playback

What "interactive" means determines what you need:

| What you want | Easiest implementation |
|---------------|------------------------|
| **Click-to-play / pause** | Plain HTML controls on top of `<canvas>` or `<video>` |
| **Hover state** | CSS `:hover` if static, `mouseenter` listener if dynamic |
| **Branching: pick A or B at a moment** | Multiple Spine animations and a state machine in JS, OR multiple Rive state-machine paths, OR a UI overlay that swaps which video plays |
| **Hit-testable regions on a character** | PixiJS/Phaser scene graph with hit areas, or Rive listeners (Rive has built-in pointer event hit-testing on shapes) |
| **Scroll-driven animation** | Lottie or Rive both excel here; for sprite-sheets, scrub `currentFrame` against `scrollY` |
| **Physics / collisions** | Phaser (Arcade or Matter) or PixiJS + Matter.js. Don't pull Unity in just for physics. |
| **Multiplayer / networked state** | Out of scope of this memo, but: web socket + a state authority. Unity WebGL multiplayer works but adds a lot of weight. |
| **Save state across sessions** | `localStorage` or IndexedDB. Note Unity's IndexedDB does *not* work in iframes on Safari. |

For "interactive minigame on a marketing site," the canonical 2026 stack is **Pixi v8 + Spine + Howler + GSAP** if your characters are skeletal, or **Phaser 3 + Aseprite atlases + Howler** if your characters are pixel-art. Avoid pulling Unity into a marketing-site interactive unless the game already exists in Unity.

---

## 7. Recommended pipelines

Three concrete project shapes, three opinionated picks. Each is what we'd actually choose, not a survey of options.

### 7.1 Hero animation for a marketing site (6-second loop, full-bleed, all platforms)

**Pick:** **Rive** (or animated WebP if the asset is dead simple).

**Pipeline:**
1. Animator authors in Rive Editor.
2. Export `.riv`.
3. Embed with `@rive-app/canvas` (~100 KB gzipped). Lazy-load on viewport intersection.
4. Provide animated WebP fallback at 360p for `prefers-reduced-motion: reduce` and old-browser scenarios.

**Why not Unity WebGL:** 30 MB bundle for a 6-second loop is unjustifiable. First paint will tank.

**Why not Lottie:** If your team is After Effects–native, Lottie is fine. If they're not, Rive is a faster authoring loop and a more capable runtime. Rive also gives you state-machine interactivity essentially for free if you later want it.

**Why not Spine:** Spine works, but you'll pay $330/seat for tooling that's overkill for a single hero loop. Use Spine when you have a *character library* across multiple animations and platforms.

**Cost:** 0–1 week of authoring effort (depending on animator's Rive familiarity), plus integration (~half a day).

### 7.2 Interactive web mini-game (clickable characters, branching, embedded in a product page)

**Pick:** **Phaser 3 (or PixiJS v8) + Spine + Howler + GSAP.**

**Pipeline:**
1. Animator rigs and animates characters in Spine. Exports `.json/.atlas/.png` triplet.
2. Engineer scaffolds a Phaser 3 project (or PixiJS if scene-graph rendering is more useful than full game-engine features).
3. Loads Spine assets via `@esotericsoftware/spine-phaser` or `@esotericsoftware/spine-pixi-v8`.
4. Game logic lives in plain TypeScript. State machines via XState or hand-rolled.
5. Audio via Howler with sprite playback for SFX, streaming for music.
6. Bundle and ship as a single ESM module embedded into the host page.

**Why not Unity WebGL:** 30–60 MB bundle, multi-second cold start, fights the surrounding React app. Phaser bundle is < 1 MB, integrates cleanly, doesn't fight the DOM.

**Why not just sprite-sheets:** If the character has > 5 distinct animations or any rig-driven nuance (turn-around angles, IK reach, expression overlays), sprite-sheets become unmanageable. Spine pays for itself.

**Why Phaser over PixiJS:** Phaser is "game engine," PixiJS is "scene graph." If you have collisions, scenes, input mapping, scoring — Phaser. If you have a custom interaction model and don't need those built-ins — PixiJS.

**Cost:** 2–4 weeks of engineering for a small interactive piece, depending on complexity. Spine license $330/animator-seat.

### 7.3 Cross-platform character with shared rig (mobile native + web + Unity standalone)

**Pick:** **Spine.** This is the prototypical Spine use case and there isn't really a second-place option.

**Pipeline:**
1. Source-of-truth: Spine project files in version control (text-mode `.spine` JSON for diff-ability). Treat the Spine project the way you'd treat code.
2. CI exports `.json/.atlas/.png` (or `.skel/.atlas/.png` binary for production) on every commit.
3. **Unity build** consumes via spine-unity (`SkeletonAnimation` or `SkeletonGraphic` components).
4. **Web build** consumes via spine-ts. Pick a renderer (WebGL is the default; Pixi adapter if you have Pixi infra).
5. **iOS / Android native** consume via spine-cpp / spine-libgdx if you need it.
6. Animation parity across platforms is tested by rendering the same animation at 60 fps on each platform and diffing screenshots — same source data, same output (within shader/blend rounding).

**Why not 2D Animation:** Trapped in Unity. No native iOS/Android port without rebuilding the rig.

**Why not Rive:** Rive *would* work for many cases here, especially if the rig is vector. But for raster-based character art, mesh-deformed warriors, and the "we want our 2D animator to feel at home" criterion, Spine still wins. If your characters are vector and stylized, reconsider Rive.

**Cost:** Spine licenses for animation team. CI export pipeline (a day or two). Per-platform integration is straightforward.

---

## 8. Tooling versions and gotchas as of May 2026

### 8.1 Versions to pin

| Component | Version (May 2026) | Notes |
|-----------|-------------------|-------|
| Unity LTS | **6.3 LTS (6000.3)** | Released Dec 2025. 2-year support. Significant WebGL improvements over 6.0. |
| Unity 2D Animation | 11.x | Bundled with 2D feature set. Active. |
| Unity 2D PSD Importer | 11.x | Active. Uses same package system. |
| Unity Recorder | 4.0.x | PNG/JPG/EXR sequence + MP4 + WebM. WebM with alpha works, MP4 with alpha does not. |
| spine-unity | **4.2 stable**, 4.3-beta | Track Spine editor version. 4.3 still beta as of April 2026. |
| Spine editor | 4.2 stable, 4.3-beta | $69 Essential / ~$330 Pro. |
| Live2D Cubism | **5 SDK R5** (April 2026) | Lip-sync from audio broken in WebGL. |
| Rive Unity | Asset Store, Jan 2026 release | Supports Unity WebGL. |
| Rive web runtime | `@rive-app/canvas`, `@rive-app/webgl-advanced` | Active. WebGPU shipping. |
| DragonBones | Stagnant | Use only if free is the gating constraint. |
| TexturePacker | 7.x | Active. PixiJS, Phaser, Unity, Spine, Cocos2d export presets. |
| Lottie web | `lottie-web` 5.x, `dotlottie-web` 0.x | Active. |
| PixiJS | v8 | Stable. Spine adapter is `@esotericsoftware/spine-pixi-v8`. |
| Phaser | 3.x current; Phaser 4 in progress | Stable. Active development. |
| Howler.js | 2.2.x | Stable. The Web Audio quirks are *its* problem, not yours. |

### 8.2 Recent breakage / gotchas

- **Unity 6 dropped some legacy WebGL fallback paths.** If you're upgrading from Unity 2021 LTS or 2022 LTS, expect to revisit your custom WebGL templates. The `index.html` template structure changed in Unity 6.
- **URP is the only sensible WebGL render pipeline.** Built-in works but is increasingly second-class. HDRP does not work.
- **WebGPU is in preview** (Unity 6.3) but not production-ready. Don't ship on it yet; do experiment.
- **Spine 4.2 → 4.3 binary skel format shifted.** Match runtime version to exported binary version exactly. Mixing 4.2 export with 4.3 runtime (or vice versa) will silently misrender deformed meshes.
- **Live2D WebGL audio lip-sync is still broken** even on the latest 5 SDK R5. Pre-bake lip-sync data, or move outside Unity-WebGL for that workflow.
- **`SharedArrayBuffer` requires COOP/COEP headers**, which break iframe embeds. If your Unity build is going into an embedded marketing page, you'll likely run single-threaded.
- **Anima2D is dead.** Officially deprecated and folded into 2D Animation years ago. If you find an old tutorial referencing Anima2D, ignore it.
- **`UnityWebRequest` over Web on iOS Safari** has occasional silent failures with mixed-content URLs (HTTPS page → HTTP API). Modern, but worth testing.
- **iOS Safari WebGL 1.0 fallback is still a thing** on older iOS versions (iOS 14 and below). If your audience tail includes those, expect shader issues.
- **Brotli decompression in Unity's JS loader.** As of Unity 6, native browser `Content-Encoding: br` is preferred. Unity's bundled JS-side decompression fallback is slower; use server-side Brotli with proper headers.
- **Photoshop CC 2024+ changed PSD layer effect handling** in ways that occasionally trip Unity's PSD importer (and Spine's). If artists complain about layers vanishing, look at layer effects (drop shadows, glows) — flatten them.
- **WebP-with-alpha encoding** in `ffmpeg` requires `-c:v libwebp_anim` and a recent build (6.0+). Older `ffmpeg` will silently produce non-animated WebP.
- **Aseprite licensing change** (2024) — if you're sourcing pixel-art from Aseprite, the GitHub source-build path is gone; you need a Steam/itch/Humble license. Mention this to artists.

### 8.3 Things you might find online that are no longer correct

- "Unity doesn't support WebGL on mobile" — outdated; Unity 6 declared mobile WebGL supported. The reality is "supported but constrained" — see §1.3.
- "Spine costs $X" with X older than 2024 — pricing has shifted. Confirm at esotericsoftware.com.
- "DragonBones is the open-source Spine" — true, but the project is not actively maintained. Don't pick for new work in 2026.
- "Use `Application.ExternalCall` to call JS" — deprecated. Use `[DllImport("__Internal")]` with `.jslib` plug-ins.
- "Anima2D is the standard rigging tool for Unity 2D" — Anima2D was deprecated and replaced by `com.unity.2d.animation` years ago.
- "Lottie has a Unity exporter" — there isn't a maintained Unity → Lottie exporter. There *is* a Lottie *importer* for Unity (other direction).

---

## 9. Decision matrix (quick reference)

For a fast judgment call on an incoming task. Read down the rows, pick the row that fits, follow the recommendation.

| Project shape | Audience | Asset style | Recommended |
|---------------|----------|-------------|-------------|
| Marketing-site hero loop | All web platforms | Vector / clean illustration | **Rive** (fallback: animated WebP + HEVC-alpha video) |
| Marketing-site hero loop | All web platforms | Pixel art / hand-drawn frames | **Animated WebP** + sprite-sheet alternate |
| Existing Unity game → web port | Desktop-first | Anything | **Unity WebGL** (eat the bundle) |
| Web mini-game w/ skeletal characters | Mobile + desktop | 2D rigged characters | **Phaser 3 + Spine + Howler** |
| Web mini-game w/ pixel art | Mobile + desktop | Pixel art | **Phaser 3 + Aseprite atlas + Howler** |
| Cross-platform character library | Native + web | Skeletal | **Spine** (single source, runtimes per platform) |
| Cross-platform character | Native + web | Vector / UI motion | **Rive** |
| Vtuber-style face character | Web | Layered face art | **Live2D Cubism**, render with Cubism Web SDK directly (skip Unity for web build) |
| Cinematic / cutscene | Web | Anything | Bake to **WebM/MP4 video** with Unity Recorder; ship `<video>` element |
| Already rigged in Unity 2D Animation, need web | Web | Skeletal | Either ship Unity WebGL, or **rebuild rig in Spine** (no clean export exists) |

---

## 10. Open questions and follow-ups

These are worth resolving before locking a pipeline for a specific project:

1. **Bundle-size targets.** What's our actual budget for first-paint? Without a number, every pipeline is "fine." With "< 500 KB to first interaction," half the options drop out.
2. **Audience iOS Safari mix.** What % of expected viewers are on iOS Safari? This dictates how seriously we take §1.3 and §6.1.
3. **Animator skillset.** Are our animators Spine-native, Rive-native, AE-native, or Unity-native? The pipeline that fits the existing skillset wins by default unless the constraints force a change.
4. **Source-of-truth versioning.** Spine `.spine` projects in git work as long as you use JSON mode. Rive `.riv` is binary. If the team relies on diff-able authoring assets, this matters.
5. **Whether we need a single shared playground app.** This repo (`unity-to-html-playground`) suggests "let's build minimal demos of multiple pipelines side-by-side." A scaffolding plan: one `unity/` project with three sample animations (hero loop, character with state machine, layered scene) and three corresponding `html/` demos showing the pipelines from §7.1, §7.2, §7.3. That gives us comparison material for future decisions.
6. **CI / automated build pipeline.** None of these pipelines are useful long-term if rebuilding the web asset requires manual export steps. Worth scoping out: Spine command-line export, Rive headless export (limited), Unity batch-mode WebGL builds.
7. **License audit.** Spine Pro license per animator seat, possible Unity Pro requirements above revenue threshold, Live2D Cubism above revenue threshold, Rive paid tier triggers. None are bank-breaking individually; together they need a budget line.

---

## Sources

- [Unity 6.3 LTS release notes — official manual](https://docs.unity3d.com/6000.3/Documentation/Manual/WhatsNewUnity63.html)
- [Eliot's WebGL Notes for 2026 — Unity Discussions](https://discussions.unity.com/t/eliots-webgl-notes-for-2026/1701530)
- [Unity to WebGL Porting for Mobile Games: Full 2026 Guide — iLogos](https://ilogos.biz/unity-to-webgl-porting-guide/)
- [Unity 6.3 LTS overview — CG Channel](https://www.cgchannel.com/2025/12/unity-6-3-lts-is-out-see-5-key-features-for-cg-artists/)
- [Unity Manual: Web browser compatibility](https://docs.unity3d.com/6000.4/Documentation/Manual/webgl-browsercompatibility.html)
- [Unity Manual: Audio in Web](https://docs.unity3d.com/Manual/webgl-audio.html)
- [Spine: Runtimes overview](http://esotericsoftware.com/spine-runtimes)
- [spine-unity download page](https://en.esotericsoftware.com/spine-unity-download)
- [Spine purchase page (pricing)](https://esotericsoftware.com/spine-purchase)
- [spine-runtimes 4.2 CHANGELOG (GitHub)](https://github.com/EsotericSoftware/spine-runtimes/blob/4.2/CHANGELOG.md)
- [Rive for Unity announcement (Asset Store, Jan 2026)](https://rive.app/blog/rive-for-unity-updated-and-in-the-unity-asset-store)
- [Rive for Unity feature update](https://rive.app/blog/rive-for-unity-new-features-and-platform-compatibility)
- [Rive Unity getting started](https://rive.app/docs/game-runtimes/unity/getting-started)
- [Live2D Cubism SDK manual](https://docs.live2d.com/en/cubism-sdk-manual/top/)
- [Live2D Cubism 5.3 features](https://docs.live2d.com/en/cubism-sdk-manual/cubism-5-3-new-functions/)
- [Cubism Unity Components (GitHub)](https://github.com/Live2D/CubismUnityComponents)
- [DragonBones Unity (GitHub)](https://github.com/DragonBones/DragonBonesUnity)
- [Unity 2D Animation package — Sprite Swapping (10.0)](https://docs.unity3d.com/Packages/com.unity.2d.animation@10.0/manual/SpriteSwapIntro.html)
- [Unity 2D Animation feature page](https://unity.com/features/2danimation)
- [Unity Recorder Image Sequence properties (4.0)](https://docs.unity3d.com/Packages/com.unity.recorder@4.0/manual/RecorderImage.html)
- [Lottie documentation hub](https://airbnb.io/lottie/)
- [dotLottie introduction](https://dotlottie.io/intro/)
- [PixiJS Spritesheet documentation](https://pixijs.download/dev/docs/assets.Spritesheet.html)
- [TexturePacker — PixiJS sprite sheets tutorial](https://www.codeandweb.com/texturepacker/tutorials/how-to-create-sprite-sheets-and-animations-with-pixijs)
- [Phaser.js 2026 overview — Seeles](https://www.seeles.ai/resources/blogs/phaser-js-game-development-2026)
- [Unity 2D Animation vs. Spine comparison — RetroStyle Games](https://retrostylegames.com/blog/unity-2d-animation-vs-spine/)
- [SpriteForge — multi-engine sprite sheet generator](https://spriteforge.online/)
- [aseprite-importer-for-unity (GitHub)](https://github.com/2YY/aseprite-importer-for-unity)
- [Unity Issue Tracker: WebGL Speech API on iOS Safari](https://issuetracker.unity3d.com/issues/webgl-web-speech-api-calls-do-not-return-audio-output-on-the-ios-safari-browser)
