# Idea Parking Lot

Dump random one-line ideas the moment they hit you, then tag, search, and
triage them later. When you want to think bigger, let Claude **branch** an idea
into related concepts you hadn't considered, or **connect** it to the other
ideas you've already parked.

## Features

- **Quick capture** — type an idea, press Enter, it's parked. Add comma-separated tags inline.
- **Tags** — every idea can carry tags; click any tag (or a pill in the tag cloud) to filter.
- **Search** — live full-text filter across all ideas.
- **Triage** — mark ideas **done**, **archive** them, edit text inline (double-click), or delete.
- **AI · Branch ✦** — Claude suggests ~5 adjacent concepts/directions for any idea; save the good ones with one click.
- **AI · Connect ⇄** — Claude finds non-obvious links between an idea and the rest of your parking lot, and proposes a synthesized idea that bridges them.

## Stack

- **Backend:** Node.js + Express, with the built-in `node:sqlite` for storage (no native build step).
- **AI:** the official [`@anthropic-ai/sdk`](https://www.npmjs.com/package/@anthropic-ai/sdk), using structured outputs + adaptive thinking. Defaults to `claude-opus-4-8`.
- **Frontend:** a single static page of vanilla JS/CSS — no build tooling.

## Getting started

Requires **Node 22.5+** (for built-in SQLite).

```bash
npm install
npm start
```

Open http://localhost:3000.

The core app (capture, tag, search, done/archive) works out of the box. To turn
on the **Branch** and **Connect** AI features, give it an Anthropic API key:

```bash
cp .env.example .env        # then edit .env and paste your key
# or just:
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Get a key at <https://console.anthropic.com/>. When a key is present the AI
buttons appear on each idea; without one, the rest of the app runs normally.

## Configuration

All optional, via environment variables (or a `.env` file — loaded automatically):

| Variable            | Default            | Purpose                                  |
| ------------------- | ------------------ | ---------------------------------------- |
| `ANTHROPIC_API_KEY` | _(unset)_          | Enables the Branch / Connect AI features |
| `MODEL`             | `claude-opus-4-8`  | Which Claude model to use                |
| `PORT`              | `3000`             | HTTP port                                |
| `DB_PATH`           | `./ideas.db`       | SQLite database file location            |

## API

| Method   | Path                      | Description                              |
| -------- | ------------------------- | ---------------------------------------- |
| `GET`    | `/api/config`             | Whether AI is enabled                    |
| `GET`    | `/api/ideas`              | List ideas (`?search=`, `?tag=`, `?status=`) |
| `POST`   | `/api/ideas`              | Create `{ text, tags }`                  |
| `PATCH`  | `/api/ideas/:id`          | Update `{ text?, tags?, status? }`       |
| `DELETE` | `/api/ideas/:id`          | Delete an idea                           |
| `GET`    | `/api/tags`               | All tags with counts                     |
| `POST`   | `/api/ideas/:id/branch`   | AI: related concepts branching off       |
| `POST`   | `/api/ideas/:id/connect`  | AI: connections to other ideas + synthesis |

`status` is one of `active`, `done`, `archived`.

## Notes

- Data lives in a local SQLite file (`ideas.db`), which is gitignored.
- The `node:sqlite` module is still marked experimental in Node 22; the start script suppresses the warning.
