# parse-line-art.mjs

Auto-parse a black-on-white line-art PNG into the `<slug>_lines.png` +
`<slug>_labels.png` pair the coloring-book runtime understands. Drops the
need to hand-author each region: every closed white area in your input
becomes its own colorable region, the surrounding white space becomes the
auto-background (id 255), and the black ink becomes the outline.

## CLI

```sh
node scripts/parse-line-art.mjs \
  --in path/to/line-art.png \
  --out-dir examples/coloring-book/assets \
  --slug myslug \
  [--threshold 128] \
  [--min-region 50] \
  [--erode 1]
```

Flags:

| flag | default | meaning |
| --- | --- | --- |
| `--in` | (required) | input PNG path (resolved against cwd) |
| `--out-dir` | (required) | where to write `<slug>_lines.png` + `<slug>_labels.png` |
| `--slug` | (required) | slug used for the output filenames |
| `--threshold` | `128` | grayscale value below which a pixel is considered outline |
| `--min-region` | `50` | drop components smaller than this many pixels (they get reassigned to outline) |
| `--erode` | `1` | how many erode passes to absorb antialiased outline edges |

Output:

- `<slug>_lines.png` — transparent PNG, opaque black where the outline is.
- `<slug>_labels.png` — RGBA. R channel encodes region id (1..254 for
  hand-painted regions, 255 for the auto-background), alpha=255 inside any
  region, alpha=0 on outline / dropped pixels. No antialiasing.

## Where to put input images

Put your raw line-art PNGs in
`examples/coloring-book/source-art/`. That path lives outside `assets/`
so the generator can re-derive the labels/lines pair without losing the
human-authored input.

## Expected input characteristics

- **Black on white.** The parser converts to grayscale and thresholds. Pure
  black ink and pure white background works out-of-the-box.
- **Closed regions.** A gap in an outline merges the two regions on either
  side of it. Most "color leak" issues at runtime come from gaps in the
  source art, not from the parser.
- **Antialiasing.** If your input was rendered with AA on, soft outline
  edges will threshold to fillable and create a thin halo region around
  every shape. Bump `--erode` to `2` or `3` to absorb the halo. The
  generator we ship uses node-canvas with antialiasing on for the visible
  outlines but draws each subject thick enough that 1-px erosion is
  sufficient.
- **Resolution.** Anywhere from 512² to 1500² works well. Smaller images
  parse faster but give the player less room to land taps on small
  regions; larger images bloat the asset bundle.

## Common gotchas

- **Regions merging unexpectedly.** Almost always a gap somewhere in the
  outline. Open the input in a pixel editor; trace where one region
  bleeds into another. Increasing `--erode` thickens outlines and can
  bridge tiny gaps; lowering `--threshold` makes more pixels count as
  outline (also helps).
- **Dropped intended regions.** If a feature you wanted to be colorable
  came back missing, it was probably below `--min-region`. Lower it to
  `20` or so. (The default is conservative because tiny regions are
  finicky to tap on a phone.)
- **Background didn't get id 255.** This happens when no fillable
  component touches the image border — usually because `--erode` was
  cranked so high it sealed off the edge. Drop the erode count.
- **More than 254 regions.** The parser caps at 254 foreground regions
  plus the background. Anything past the cap is demoted to outline. If
  you legitimately have that many regions, the picture is probably too
  dense for tap-to-fill anyway.

## Programmatic use

The script also exports a `parseLineArt(opts)` function that returns the
parse summary, used by `generate-autoparsed-batch.mjs` to render all the
ready-to-color subjects in one go.
