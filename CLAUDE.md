# CLAUDE.md

## What this is

"På resande fot" (*pasparet-laglek*): a Swedish-language, local-network team quiz game with four simultaneous browser views:

| Role key  | View             | Purpose |
|-----------|------------------|---------|
| `host`    | Spelledare       | Edits questions, starts/advances/reveals, awards points |
| `dressin` | Lag Dressin      | Team 1 phone |
| `forsta`  | Lag Första klass | Team 2 phone |
| `screen`  | Storbild         | Big-screen/TV display (plays sounds/video/map) |

Question types: `destination` (resmål: 5 clues worth 10/8/6/4/2 pts, a team pulls the "nödbroms" to lock in an answer, plus up to 2 follow-up questions), `music` (host uploads an MP4, 2 questions with answers), `closest` ("Närmast vinner": teams drop map pins, closest to the true location wins; no auto-scoring).

All UI text, code comments and user-facing errors are in **Swedish**; keep new text in Swedish. `README.md` (Swedish) is the user/host manual.

## Run and test

```bash
npm start        # node server.js → http://localhost:3000 (PORT=... to change)
npm test         # node --test --test-isolation=none server.test.js client.test.js
```

- Node >= 20. **No dependencies, no `npm install`, no build step**: only Node built-ins on the server and plain vanilla JS in the browser.
- Server listens on `0.0.0.0` so phones/TV on the same Wi-Fi can connect via `http://<LAN-IP>:3000`.
- `DATA_DIR` env var overrides the `data/` directory (the server tests use a temp dir via this).
- `server.test.js` starts a real HTTP listener, so it fails with `EPERM` in sandboxes that forbid binding ports; that is an environment limit, not a bug. `client.test.js` runs `public/app.js` in a `node:vm` context with fake `document`/`fetch`, with no browser.
- Login: users type only an access code (`data/codes.json`; defaults include `ledare`, `förstaklass`, `dressin`, `x2000`, `mälartåg`, `loket`, `storbild`); the code decides the role. All role codes must be distinct and non-empty or the server refuses to boot. Inactive teams cannot log in. Sessions are in-memory, so restarting logs everyone out.

## Structure

```
server.js            entire backend (~335 lines, dense, one-statement-per-line style)
public/index.html    one-line shell; loads /map.js then /app.js
public/app.js        entire frontend: login, all four role views, audio, SSE client
public/map.js        canvas map for "closest" questions (Mercator, pan/zoom, pins)
public/style.css     styles
public/assets/       nodbroms.png, dressin.ogg, forstaklass.ogg, resmal-loop.mp3, land.geojson (Natural Earth coastlines)
data/game.json       questions + live game state + scores (persisted)
data/codes.json      access codes (auto-created with defaults if missing)
data/media/          uploaded <uuid>.mp4/.png/.jpg/.webp
server.test.js / client.test.js
```

### Backend (`server.js`)

- Single `http.createServer` with one big `handler`; no framework, no router. Exports `{ server }` and only calls `listen` when run directly (`require.main === module`), which is how the tests import it.
- State is one in-memory object `db = { questions, game, scores }`, written atomically (`.tmp` + rename) by `save()` after every mutation. There is no separate DB.
- `game` = `{ phase: 'waiting'|'active'|'revealed', questionId, clueIndex, round, answers, brakes, followupIndex/followupRevealed/followupAnswers, musicShown/musicRevealed/musicAnswers, closestStage (0-3), closestAnswers }`. `round` increments on each `/api/game/start`; clients echo it back in answer/brake requests to reject stale actions.
- **`view(role)` is the security boundary and the core of the design.** Each role gets a different projection of state: teams never receive the answer (before reveal), future clues, or the other team's answer; the screen gets only what should be displayed; only the host gets the full `game`, `questions`, etc. When adding state or fields, decide per role what `view()` exposes, and never leak facit to team/screen views early.
- Realtime: `GET /api/events` is a Server-Sent Events stream; `broadcast()` pushes `view(role)` to every open stream after each mutation. `GET /api/state` returns the same projection once.
- All mutating endpoints are `POST /api/...`, JSON body (100 KB cap), with an Origin==Host CSRF check. Role gating: team endpoints (`brake`, `answer`, `followup-answer`, `music-answer`, `closest-answer`) are checked first; everything after the `if (role !== 'host')` line is host-only (`score/add`, `question/save|delete|move`, `game/start|next|reveal|music-question|music-reveal|closest-stage|followup|followup-reveal|wait`). Game-flow transitions validate current phase/type and return 409 otherwise.
- Question input goes through `validQuestion()` (length clamps, 5 clues required, 2 music questions, viewport/answer-in-scope checks for `closest`).
- Media: host uploads stream via `POST /api/video/upload` (`video/mp4`, ≤250 MB) and `/api/image/upload` (png/jpg/webp, ≤20 MB), with magic-byte checks and UUID filenames. `GET /api/video/:f` (with Range support) and `/api/image/:f` are served **only to the screen role and only while that question is the active one**. The `.ogg`/`.mp3` assets are likewise screen-only; `/view/<role>` pages require being logged in as that role.
- Static files are whitelisted explicitly (no directory serving); responses use `Cache-Control: no-store`.

### Frontend (`public/app.js`)

- One IIFE, re-renders `#app.innerHTML` from a single `state` object via `render()` on every SSE message. Uses an `esc()` helper to escape interpolated text; keep using it for any user-supplied content.
- On load: `GET /api/me`; if logged in, opens `EventSource('/api/events')`. Login form posts the code to `/api/login`.
- The screen view handles Web Audio (brake sounds, looping destination music) and needs a user click on "Aktivera ljud" because of browser autoplay rules. It de-dupes brake events with the `seenBrakes` set.
- `public/map.js` exposes the map widget used by host (picking the answer + visible viewport) and by teams/screen (pins). It draws from the local `land.geojson`, so no internet or tile server is needed.

## Conventions and gotchas

- Match the existing terse, dense style when editing `server.js`/`app.js`; don't reformat wholesale.
- `data/` is **committed to git**, including `codes.json`, `game.json` (live game state, which will show as modified after any play session) and ~240 MB of uploaded media. Be careful not to commit accidental game-state churn or `.DS_Store`; `.gitignore` only lists `node_modules/`.
- Scoring is manual for `closest` and for follow-up/music answers; the server only auto-tracks the points *offered* for a destination answer (`answers[role].points`), and the host awards totals through `/api/score/add` (±1–100, never below 0). Host sets `activeTeams` (2–5 of the five catalog teams) via `POST /api/teams` while `phase === 'waiting'`.
- Only one team can pull the brake per clue level; `next` clue resets `brakes`.
- Intended for a trusted LAN over plain HTTP; there is no rate limiting or HTTPS.
