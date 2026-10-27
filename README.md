# capri-shell

Capri on the desk. She is the *Project Capricorn* construct from Cyberpunk:
Edgerunners season 2, drawn on twos under a shader, and she is Reze's body:
the brain on the box (brain-bridge) talks through her, moves her and voices
her. Forked from [capri-desktop](https://github.com/mochiiwuff/capri-desktop)
(MIT, see NOTICE), with Ollama and the Claude Code hooks taken out.

## How she is wired

- `src/main/reze.js`: the link. A runtime socket to the brain's edge (`/ws`)
  stays open; every `input:text` frame carrying one of her markers becomes a
  cue. Chat goes to the gateway (`/v1/chat/completions`, streamed), her voice
  comes from `/v1/audio/speech` (the Fish clone of her).
- `src/renderer/js/link.js`: the cues acted out. `[bridge-move] here` puts her
  next to the cursor, `[bridge-express] smile` is a face and a short act,
  `[bridge-speak] line` shows the line and plays it in her voice,
  `[bridge-stop]` cuts her off.
- `src/main/bridge.js`: a local port (127.0.0.1:47823). `POST /cue
  {"text": "[bridge-move] here"}` does what the brain would; `/debug/*` drives
  the overlay in `--dev`.

Settings come from the environment first, then her config: `CAPRI_BRAIN`
(the edge origin), `CAPRI_BRAIN_KEY`, `CAPRI_RUNTIME_TOKEN`, `CAPRI_MODEL`
(who answers, from the gateway roster), `CAPRI_VOICE`.

## Run

```
npm install
npm run desk       # detached from the terminal (npm start ties her to it)
npm run desk:dev   # with the debug routes on her local port
npm test
```

## Versions

- 0.7.0: cels. A short image-to-video clip from one of her drawings (Kling turbo, three
  seconds) is cut to frames on twos, keyed and packed by `tools/make-cels.py`; the desk loops
  a cel set frame by frame (poses.js `play`). First set: the crouch idle, 37 cels.
- 0.6.4: the point redone on show frames only (Dennis: the first did not look like her).
- 0.6.3: make-pose takes `--height` (the figure's height in sprite px) and cuts at full resolution.
- 0.6.2: the cackle (retry with the show's laugh frames only; one of four kept).
- 0.6.1: the point at the sky (round 2, one of four kept).
- 0.6.0: the first generated pose, the crouch (Nano Banana with show frames as references, one
  of four candidates kept), registered through tools/make-pose.py, which now keys a flat
  background out before the matte.
- 0.5.3: she survives the lid. After sleep or the lock screen the overlay is put back on top and
  checked; a page that stopped drawing, a lost GL context or a dead renderer reloads her (no intro, no hello again).
- 0.5.2: her hello lands on the intro's "hi", her face on the glass, when the brain has it ready in time.
- 0.5.1: the first start of a day is the morning line (what matters today, from the brain).
- 0.5.0: her own words. She says hello in her voice when she comes up on the desk, and
  comments on the machine (the battery running low, too many windows) with a line the brain
  writes as her, at most one every twenty minutes. `CAPRI_QUIET=1` keeps her quiet at start.
- 0.4.1: review fixes. Wake wakes her before the hop, a stroll she cannot take becomes a plain
  move, a flung Capri faces the way she flew and bounces off the top of the screen, the drag
  trail is the last 150 ms, the launcher only stops a process that answers as her.
- 0.4.0: the behaviors. The brain's move spots sit, peek, hide, possess, sleep, wake and
  stroll (spring hops along the bottom); a drag released with speed is a throw (walls, air
  drag, a bounce). `npm run desk` stops a running instance first. Debug routes drag and state.
- 0.3.0: she answers as herself. The desk asks the brain for the `capri` model, a skin with
  its own soul, lean, memory and audit in the vault (brain-bridge `src/capri-skin.js`);
  Discord stays Reze. `CAPRI_MODEL=reze` talks to the brain as Reze instead.
- 0.2.0: the life layer (life.js: breath, weight shift, glances, the mane lagging a move),
  spring glides for short moves with a hard landing, two beats keyed from show frames
  (lean, recoil: a smeared snap frame and a hold), the show's own sitting drawing snapping
  in on the seat (poses.js, tools/cut-pose.py), the point cut-in, and `npm run desk`.
- 0.1.0: the fork. She stands on the desk, links to the brain, and teleports
  to the cursor when it needs you. Chat and voice go through the gateway.
