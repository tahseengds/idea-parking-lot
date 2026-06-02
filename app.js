import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  initDb,
  createIdea,
  getIdea,
  listIdeas,
  updateIdea,
  deleteIdea,
  allTags,
} from "./db.js";
import { aiEnabled, branchIdea, connectIdea } from "./ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialise storage before the app handles any request.
await initDb();

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Async handler wrapper → forwards rejections to the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- config --------------------------------------------------------------

app.get("/api/config", (req, res) => {
  res.json({ aiEnabled: aiEnabled() });
});

// ---- ideas CRUD ----------------------------------------------------------

app.get(
  "/api/ideas",
  wrap(async (req, res) => {
    const { search = "", tag = "", status = "" } = req.query;
    res.json(await listIdeas({ search, tag, status }));
  })
);

app.get(
  "/api/tags",
  wrap(async (req, res) => {
    res.json(await allTags());
  })
);

app.post(
  "/api/ideas",
  wrap(async (req, res) => {
    const { text, tags } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "An idea needs some text." });
    }
    res.status(201).json(await createIdea({ text, tags: tags || [] }));
  })
);

app.patch(
  "/api/ideas/:id",
  wrap(async (req, res) => {
    const idea = await updateIdea(Number(req.params.id), req.body || {});
    if (!idea) return res.status(404).json({ error: "Idea not found." });
    res.json(idea);
  })
);

app.delete(
  "/api/ideas/:id",
  wrap(async (req, res) => {
    const ok = await deleteIdea(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "Idea not found." });
    res.status(204).end();
  })
);

// ---- AI ------------------------------------------------------------------

app.post(
  "/api/ideas/:id/branch",
  wrap(async (req, res) => {
    if (!aiEnabled()) {
      return res.status(503).json({ error: "AI is not configured. Set FIREWORKS_API_KEY and restart." });
    }
    const idea = await getIdea(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: "Idea not found." });
    const branches = await branchIdea(idea);
    res.json({ branches });
  })
);

app.post(
  "/api/ideas/:id/connect",
  wrap(async (req, res) => {
    if (!aiEnabled()) {
      return res.status(503).json({ error: "AI is not configured. Set FIREWORKS_API_KEY and restart." });
    }
    const idea = await getIdea(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: "Idea not found." });

    const all = await listIdeas({});
    const others = all
      .filter((o) => o.id !== idea.id && o.status !== "archived")
      .map((o) => ({ id: o.id, text: o.text }));

    const result = await connectIdea(idea, others);

    const enriched = [];
    for (const c of result.connections) {
      const related = await getIdea(c.relatedId);
      if (related) enriched.push({ relationship: c.relationship, idea: related });
    }

    res.json({ connections: enriched, synthesis: result.synthesis || "" });
  })
);

// ---- error handling ------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Something went wrong." });
});

export default app;
