import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createIdea,
  getIdea,
  listIdeas,
  updateIdea,
  deleteIdea,
  allTags,
} from "./db.js";
import { aiEnabled, branchIdea, connectIdea } from "./ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Small wrapper so async handlers forward errors to the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- config --------------------------------------------------------------

app.get("/api/config", (req, res) => {
  res.json({ aiEnabled: aiEnabled() });
});

// ---- ideas CRUD ----------------------------------------------------------

app.get("/api/ideas", (req, res) => {
  const { search = "", tag = "", status = "" } = req.query;
  res.json(listIdeas({ search, tag, status }));
});

app.get("/api/tags", (req, res) => {
  res.json(allTags());
});

app.post("/api/ideas", (req, res) => {
  const { text, tags } = req.body || {};
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "An idea needs some text." });
  }
  res.status(201).json(createIdea({ text, tags: tags || [] }));
});

app.patch("/api/ideas/:id", (req, res) => {
  const idea = updateIdea(Number(req.params.id), req.body || {});
  if (!idea) return res.status(404).json({ error: "Idea not found." });
  res.json(idea);
});

app.delete("/api/ideas/:id", (req, res) => {
  const ok = deleteIdea(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: "Idea not found." });
  res.status(204).end();
});

// ---- AI ------------------------------------------------------------------

app.post(
  "/api/ideas/:id/branch",
  wrap(async (req, res) => {
    if (!aiEnabled()) {
      return res.status(503).json({ error: "AI is not configured. Set ANTHROPIC_API_KEY and restart." });
    }
    const idea = getIdea(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: "Idea not found." });
    const branches = await branchIdea(idea);
    res.json({ branches });
  })
);

app.post(
  "/api/ideas/:id/connect",
  wrap(async (req, res) => {
    if (!aiEnabled()) {
      return res.status(503).json({ error: "AI is not configured. Set ANTHROPIC_API_KEY and restart." });
    }
    const idea = getIdea(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: "Idea not found." });

    // Compare against other non-archived ideas.
    const others = listIdeas({})
      .filter((o) => o.id !== idea.id && o.status !== "archived")
      .map((o) => ({ id: o.id, text: o.text }));

    const result = await connectIdea(idea, others);

    // Enrich connections with the related idea objects for rendering.
    const enriched = result.connections
      .map((c) => {
        const related = getIdea(c.relatedId);
        return related ? { relationship: c.relationship, idea: related } : null;
      })
      .filter(Boolean);

    res.json({ connections: enriched, synthesis: result.synthesis || "" });
  })
);

// ---- error handling ------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`\n  Idea Parking Lot running at http://localhost:${PORT}`);
  console.log(`  AI features: ${aiEnabled() ? "enabled" : "disabled (set ANTHROPIC_API_KEY to enable)"}\n`);
});
