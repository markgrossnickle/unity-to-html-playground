# Sound Pads

A 4×4 grid of brightly colored launchpad-style buttons. Tap a pad and it
plays a note from a C major pentatonic scale spread across two octaves
(C4 → C7), so any combination — including button mashing — sounds pleasant.

## What this exercises

- **Web Audio API**, no library. One shared `AudioContext` is created on the
  first user gesture. Each tap spins up a fresh `OscillatorNode` +
  `GainNode` chain, runs an ADSR envelope (5 ms attack → 80 ms decay to
  sustain 0.4 → 250 ms release), and disconnects when the note ends.
- **Multi-touch.** The scene allocates four pointers, so multiple fingers
  can press different pads simultaneously and each plays its own envelope.
- **Keyboard fallback.** Top to bottom, the four pad rows are bound to
  `1 2 3 4`, `Q W E R`, `A S D F`, `Z X C V`. Held keys don't re-trigger.
- **Phaser visual feedback.** Each pad is a rounded `Graphics` rect with a
  brighter overlay and a soft halo behind it. On press: scale 1.08, fade
  the overlay to 1, fade the halo in, and a small ripple expands from the
  tap point. The whole flash is under 100 ms in, ~220 ms out.

## Files

```
examples/sound-pads/
├── index.html        page chrome (back link, top bar)
├── main.ts           Phaser bootstrap (Phaser.AUTO, no physics)
├── style.css         dark page chrome
├── src/
│   ├── PadScene.ts   builds the responsive grid; pointer + keyboard input
│   ├── audio.ts      Web Audio synth (init + playNote)
│   └── notes.ts      pad → { slug, color, frequency, key }
└── README.md
```

## Notes

- No assets. Pads are drawn at runtime; colors are HSV rotated through 360°
  across 16 pads so the grid reads as a wraparound rainbow.
- Layout is `Phaser.Scale.RESIZE`; pads relayout on viewport resize so the
  grid fills the available space on both desktop and a 375 px mobile
  viewport (tap targets stay well above 44 px).
