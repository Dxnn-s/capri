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
npm start          # or: npm run dev
npm test
```

## Versions

- 0.1.0: the fork. She stands on the desk, links to the brain, and teleports
  to the cursor when it needs you. Chat and voice go through the gateway.
