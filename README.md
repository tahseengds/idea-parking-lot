# Idea Parking Lot

Dump random one-line ideas the moment they hit you, then tag, search, and
triage them later. When you want to think bigger, let the AI **branch** an idea
into related concepts you hadn't considered, or **connect** it to the other
ideas you've already parked.

Installable as a **PWA** and deployable to **Vercel**.

## Features

- **Quick capture** — type an idea, press Enter, it's parked. Add comma-separated tags inline. Press <kbd>/</kbd> anywhere to jump to the capture box.
- **Tags** — click any tag (or a tag-cloud pill) to filter. Edit an idea's text **and tags** inline (✎ or double-click).
- **Search & sort** — live full-text filter with a result count; sort by newest, oldest, or A–Z.
- **Triage** — mark ideas **done**, **archive** them, or delete (with **Undo**). Per-status counts show on the filter chips, and your search/sort/filter view is remembered between visits.
- **Export** — download everything as a Markdown file, grouped by status.
- **AI · Branch ✦** — get ~5 adjacent concepts for any idea, **streamed in live** as they're generated; save one or **Save all**.
- **AI · Connect ⇄** — find non-obvious links between an idea and the rest of your lot (also streamed), plus a synthesized idea that bridges them.
- **Light & dark themes** — toggle in the header; remembers your choice and respects your system preference by default.
- **PWA** — installable, with an offline-capable app shell and an offline indicator.

## Stack

- **Backend:** Node.js + Express.
- **AI:** [Fireworks AI](https://fireworks.ai/) (OpenAI-compatible) via the `openai` SDK. Default model `accounts/fireworks/routers/kimi-k2p6-turbo`.
- **Storage:** built-in `node:sqlite` locally (zero-config), or **libSQL/Turso** over HTTP when a database URL is set (persists on serverless).
- **Frontend:** a single static page of vanilla JS/CSS, plus a service worker — no build tooling.

## Run locally

Requires **Node 22.5+** (for built-in SQLite).

```bash
npm install
npm start
```

Open http://localhost:3000. The core app (capture, tag, search, triage, export)
works out of the box and stores data in a local `ideas.db`.

To enable the **Branch** and **Connect** AI features, add a Fireworks key:

```bash
cp .env.example .env        # edit .env and paste your key
# or:
export FIREWORKS_API_KEY=fw_...
npm start
```

When a key is present the AI buttons appear on each idea; without one, the rest
of the app runs normally.

## Deploy to Vercel

1. **Provision a database** (serverless filesystems are ephemeral, so the local
   SQLite file won't persist). Create a free [Turso](https://turso.tech/)
   database and grab its URL + auth token.
2. **Import the repo** into Vercel.
3. **Set environment variables** in the Vercel project:

   | Variable              | Value                                            |
   | --------------------- | ------------------------------------------------ |
   | `FIREWORKS_API_KEY`   | your Fireworks key                               |
   | `TURSO_DATABASE_URL`  | `libsql://your-db.turso.io`                      |
   | `TURSO_AUTH_TOKEN`    | your Turso token                                 |

4. **Deploy.** `vercel.json` routes all traffic to the Express app in
   `api/index.js`; the table is created automatically on first request.

> Without `TURSO_DATABASE_URL`, a Vercel deploy still runs but stores data in
> `/tmp`, which is wiped between cold starts — fine for a demo, not for real use.

## Configuration

| Variable             | Default                                          | Purpose                                        |
| -------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `FIREWORKS_API_KEY`  | _(unset)_                                        | Enables the Branch / Connect AI features       |
| `MODEL`              | `accounts/fireworks/routers/kimi-k2p6-turbo`     | Model name                                     |
| `FIREWORKS_BASE_URL` | `https://api.fireworks.ai/inference/v1`          | OpenAI-compatible base URL                     |
| `TURSO_DATABASE_URL` | _(unset)_                                        | Use libSQL/Turso instead of local SQLite       |
| `TURSO_AUTH_TOKEN`   | _(unset)_                                        | Auth token for the libSQL database             |
| `PORT`               | `3000`                                           | HTTP port (local only)                         |
| `DB_PATH`            | `./ideas.db`                                     | Local SQLite file location                     |

## API

| Method   | Path                      | Description                                  |
| -------- | ------------------------- | -------------------------------------------- |
| `GET`    | `/api/config`             | Whether AI is enabled                        |
| `GET`    | `/api/ideas`              | List ideas (`?search=`, `?tag=`, `?status=`, `?sort=newest\|oldest\|az`) |
| `POST`   | `/api/ideas`              | Create `{ text, tags }`                      |
| `PATCH`  | `/api/ideas/:id`          | Update `{ text?, tags?, status? }`           |
| `DELETE` | `/api/ideas/:id`          | Delete an idea                               |
| `GET`    | `/api/tags`               | All tags with counts                         |
| `GET`    | `/api/stats`              | Idea counts by status                        |
| `POST`   | `/api/ideas/:id/branch`   | AI: related concepts (non-streaming)         |
| `POST`   | `/api/ideas/:id/connect`  | AI: connections + synthesis (non-streaming)  |
| `GET`    | `/api/ideas/:id/branch/stream`  | AI: branches streamed via SSE          |
| `GET`    | `/api/ideas/:id/connect/stream` | AI: connections streamed via SSE       |

`status` is one of `active`, `done`, `archived`.

## Project layout

```
app.js              Express app (routes); shared by local + Vercel
server.js           Local entrypoint (npm start)
api/index.js        Vercel serverless entrypoint
db.js               Storage: node:sqlite or libSQL/Turso
ai.js               Fireworks (OpenAI-compatible) calls
public/             Static frontend + service worker + manifest + icons
scripts/gen-icons.mjs  Regenerates the PWA icons (no deps)
vercel.json         Routes all requests to the Express app
```

## Notes

- Local data lives in `ideas.db` (gitignored).
- `node:sqlite` is experimental in Node 22; the start script suppresses the warning.
- Regenerate icons after changing the brand: `node scripts/gen-icons.mjs`.
