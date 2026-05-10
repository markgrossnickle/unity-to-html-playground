# Number Tracer

Drag from the orange dot along a dotted outline to trace the digits 0–9. Each
digit is made of one or more strokes (e.g. `0` is one continuous loop, `4` is
two strokes). Finish one stroke to advance to the next; finish all strokes to
celebrate and auto-advance to the next number.

## How it plays

| Action               | Behaviour                                          |
|----------------------|-----------------------------------------------------|
| Touch an orange dot  | Locks the trace head onto that endpoint            |
| Drag along the path  | Solid line fills in behind your finger             |
| Stray off the path   | The head pauses — no reset, just come back on      |
| Reach the far end    | "Ding", advance to the next stroke                 |
| Finish every stroke  | "Ta-da", color cycle, "Yay!" — next number in 1.5s |
| Top-bar **Prev/Next**| Jump between digits                                |
| Top-bar **Restart**  | Clear the current digit and try again              |

## Files

```
examples/number-tracer/
├── index.html              page chrome (back link, toolbar)
├── main.ts                 Phaser bootstrap + toolbar wiring
├── style.css               toolbar + canvas styles
└── src/
    ├── TraceScene.ts       layout, drag-trace logic, render layers
    ├── numberPaths.ts      hand-authored stroke paths for 0–9
    └── audio.ts            Web Audio "ding" + "ta-da" (lazy AudioContext)
```

## Stroke authoring

Each digit's strokes live in `src/numberPaths.ts` as point arrays in
**drawing order** — the natural way a kid is taught the digit (top-down for
vertical strokes, left-to-right for horizontal). Strokes are built from line
segments, cubic Béziers, and ellipse arcs, sampled densely (≈40–80 points each)
so the per-frame proximity check feels smooth.

Coordinates are authored in a fixed 400×600 art box; the scene scales and
centers them at runtime. No external asset files — everything draws from
`Phaser.GameObjects.Graphics`.

## Path-following logic

- Touch within 44px of either endpoint locks the trace head onto that end and
  picks a forward or backward direction.
- On each move event we search up to 8 path indices ahead (in the chosen
  direction) and snap the head to the closest point within 32px.
- Reaching the far endpoint completes the stroke. Lifting your finger within
  28px of the far endpoint also completes it.
- Lifting mid-stroke resets the head back to the start endpoint — the dotted
  ghost stays the same so the user can simply try again.
