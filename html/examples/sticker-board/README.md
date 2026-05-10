# Sticker Board

A blank playmat you decorate with cartoon stickers. No physics — once placed,
a sticker stays where you put it. Per-sticker transforms (position, rotation,
scale) persist to localStorage so the board survives a refresh.

## Interactions

| Action               | Desktop                           | Mobile                |
|----------------------|-----------------------------------|-----------------------|
| Place                | drag a thumbnail onto the board   | drag a thumbnail      |
| Re-position          | drag the sticker                  | drag the sticker      |
| Rotate               | Shift + drag                      | two-finger rotate     |
| Scale                | mouse wheel over the sticker      | pinch                 |
| Delete (single)      | drag back into the drawer · or right-click → confirm | drag back into the drawer · or long-press → confirm |
| Clear all            | toolbar **Clear** button          | toolbar **Clear** button |

## Files

```
examples/sticker-board/
├── index.html              page chrome (back link, toolbar, drawer)
├── main.ts                 Phaser bootstrap + drawer/scene wiring
├── style.css               toolbar + drawer styles
├── src/
│   ├── StickerScene.ts     placement / drag / rotate / scale / delete
│   ├── drawer.ts           DOM-side bottom drawer
│   └── persistence.ts      localStorage load/save (validated on read)
└── assets/                 12 PNG stickers from scripts/generate-sticker-assets.mjs
```

## Regenerating art

```sh
npm run gen-sticker-assets
```

Stickers are drawn programmatically with `node-canvas` — bold outlines and
flat fills so they read at any rotation or scale.
