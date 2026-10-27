# Poses the show never drew cleanly (step 5)

The forty keyed frames gave one clean whole figure (the bed scene, `pose-sit.png`). Every
other pose she needs on the desk is cropped by the frame edge or behind D. These get made
with an image model, with the show frames as style references, then cut and registered the
same way the bed drawing was (`tools/make-pose.py`).

## The poses

| name | what | reference frames (`Media/capri/frames/`) |
|---|---|---|
| crouch | crouched small, arms around her knees, mane settled, head turned to look at you | body-ep04-0367 (small, between two people), ep03-1451 |
| point-sky | the needle-finger point up and away, body stretched after it, mane streaming back | capri-grin-pointing.jpg (upper body), body-ep03-1127 |
| drape | one arm draped over a shoulder from behind, the other hand on her hip, grin | body-ep04-0809, body-ep04-0812 (behind D) |
| float | floating up, legs trailing, arms loose, mane as a halo | body-ep03-0946, body-ep03-0953 |
| cackle | the cackle: head back, mouth the white jagged grin, mane flared wide, arms out | ep04-0377..0393 (face), frames-sheet.jpg |
| sprawl | thrown back, "No way!", arms up, legs splayed | body-ep03-0946 |

## The prompt (FrameSprite or Kling image, one pose at a time)

Style references: three to five frames from the table, plus `frames-body-sheet.jpg` for the
palette. Then:

> Capri from Cyberpunk: Edgerunners season 2, full figure, transparent background, nothing
> else in frame. A girl-shaped silhouette cut out of jagged shards: hot pink and red with a
> white star-speckle texture, black negative space inside the body, a thin violet edge-light on
> every shard, acid green for the hands, forearms, shins and the small face plate. Two blue
> concentric-ring eyes, no nose, a wide white jagged grin. The hair is a huge cloud of the same
> pink speckle shards, far bigger than the body. Long angular limbs, elbows and knees as sharp
> points, fingers like green needles. Flat shapes, hard edges, no shading, no skin, no outfit.
> Pose: {one line from the table}. Studio Trigger key drawing, cel style, 2D, clean lineless
> vector-like shapes, the same character as the references.

Negative: realistic, 3D render, soft shading, gradients, skin, clothing, extra characters,
background, text, watermark, blurry, muted colours.

Settings that worked for other character sheets: square or 3:4, the highest resolution the
plan allows (she is downscaled anyway), four candidates per pose, pick the one whose face
plate and hand shapes match the references, not the prettiest.

## After a pose is generated

```
python tools/make-pose.py <generated.png> crouch --anchor feet
```

The script mattes her out (same palette rule as `cut-pose.py`), scales her so the face plate
is the sprite's size, writes `assets/capri/pose-crouch.png`, and prints the anchor to paste
into `POSES` in `src/renderer/js/poses.js`. Check the printed face-plate width against the
drawing: green next to the face (a collar, a raised hand) fools it, and `--face-width N`
overrides. Then look at it on the desk:

```
npm run desk:dev
curl -X POST -H "content-type: application/json" -d "{\"name\":\"pose\",\"pose\":\"crouch\"}" http://127.0.0.1:47823/debug/command
```

## What this needs from Dennis

An art account: FrameSprite (sprite-sheet native, pixel-leaning) or Kling image (cleaner cel
look, better with style references), or a Higgsfield plan with image credits (the MCP is
already connected; the free tier has none). One pose costs a handful of credits; the six
above with four candidates each is under a hundred.
