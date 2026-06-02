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
  countByStatus,
  createArtifact,
  listArtifacts,
  deleteArtifact,
  addMessage,
  listMessages,
} from "./db.js";
import {
  aiEnabled,
  streamBranches,
  streamConnections,
  streamChat,
  streamArtifact,
  artifactTitle,
  ARTIFACTS,
} from "./ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Kick off storage init once (idempotent). No top-level await — that can break
// the serverless bundle; instead every request waits on this promise.
const dbReady = initDb();

const app = express();
app.use(express.json());
app.use(async (req, res, next) => {
  try {
    await dbReady;
    next();
  } catch (e) {
    next(e);
  }
});
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
    const { search = "", tag = "", status = "", sort = "newest" } = req.query;
    res.json(await listIdeas({ search, tag, status, sort }));
  })
);

app.get(
  "/api/tags",
  wrap(async (req, res) => {
    res.json(await allTags());
  })
);

app.get(
  "/api/stats",
  wrap(async (req, res) => {
    res.json(await countByStatus());
  })
);

app.post(
  "/api/ideas",
  wrap(async (req, res) => {
    const { text, tags, detail, parentId } = req.body || {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "An idea needs some text." });
    }
    res.status(201).json(await createIdea({ text, tags: tags || [], detail: detail || "", parentId: parentId ?? null }));
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

// ---- AI streaming (SSE) --------------------------------------------------

// Flatten the nested idea tree into a list (top-level + all descendants).
function flattenIdeas(tree) {
  const out = [];
  const walk = (arr) => {
    for (const o of arr) {
      out.push(o);
      if (o.children) walk(o.children);
    }
  };
  walk(tree);
  return out;
}

function sseInit(res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
}
function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get(
  "/api/ideas/:id/branch/stream",
  wrap(async (req, res) => {
    sseInit(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    try {
      if (!aiEnabled()) throw new Error("AI is not configured. Set FIREWORKS_API_KEY.");
      const idea = await getIdea(Number(req.params.id));
      if (!idea) throw new Error("Idea not found.");

      for await (const b of streamBranches(idea, { signal: ac.signal })) {
        if (res.writableEnded) break;
        sseSend(res, "branch", b);
      }
      if (!res.writableEnded) sseSend(res, "done", {});
    } catch (e) {
      if (!ac.signal.aborted && !res.writableEnded) sseSend(res, "failed", { message: e.message });
    }
    if (!res.writableEnded) res.end();
  })
);

app.get(
  "/api/ideas/:id/connect/stream",
  wrap(async (req, res) => {
    sseInit(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    try {
      if (!aiEnabled()) throw new Error("AI is not configured. Set FIREWORKS_API_KEY.");
      const idea = await getIdea(Number(req.params.id));
      if (!idea) throw new Error("Idea not found.");

      const others = flattenIdeas(await listIdeas({}))
        .filter((o) => o.id !== idea.id && o.status !== "archived")
        .map((o) => ({ id: o.id, text: o.text }));

      for await (const e of streamConnections(idea, others, { signal: ac.signal })) {
        if (res.writableEnded) break;
        if (e.kind === "synthesis") {
          sseSend(res, "synthesis", { text: e.text });
        } else {
          const related = await getIdea(e.relatedId);
          if (related) sseSend(res, "connection", { relationship: e.relationship, idea: related });
        }
      }
      if (!res.writableEnded) sseSend(res, "done", {});
    } catch (e) {
      if (!ac.signal.aborted && !res.writableEnded) sseSend(res, "failed", { message: e.message });
    }
    if (!res.writableEnded) res.end();
  })
);

// ---- Work on Idea: workspace, chat, documents ----------------------------

app.get(
  "/api/ideas/:id/workspace",
  wrap(async (req, res) => {
    const idea = await getIdea(Number(req.params.id));
    if (!idea) return res.status(404).json({ error: "Idea not found." });
    const [messages, artifacts] = await Promise.all([
      listMessages(idea.id),
      listArtifacts(idea.id),
    ]);
    res.json({ idea, messages, artifacts, aiEnabled: aiEnabled(), kinds: kindList() });
  })
);

function kindList() {
  return Object.entries(ARTIFACTS).map(([kind, v]) => ({ kind, title: v.title }));
}

// Streamed chat about an idea (POST + SSE). Persists both turns.
app.post(
  "/api/ideas/:id/chat",
  wrap(async (req, res) => {
    sseInit(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    try {
      if (!aiEnabled()) throw new Error("AI is not configured. Set FIREWORKS_API_KEY.");
      const idea = await getIdea(Number(req.params.id));
      if (!idea) throw new Error("Idea not found.");
      const message = (req.body?.message || "").toString().trim();
      if (!message) throw new Error("Empty message.");

      const history = await listMessages(idea.id);
      const userMsg = await addMessage({ ideaId: idea.id, role: "user", content: message });
      sseSend(res, "user", userMsg);

      let full = "";
      for await (const delta of streamChat(idea, history, message, { signal: ac.signal })) {
        if (res.writableEnded) break;
        full += delta;
        sseSend(res, "token", { text: delta });
      }
      if (ac.signal.aborted) return;
      const assistantMsg = await addMessage({ ideaId: idea.id, role: "assistant", content: full });
      if (!res.writableEnded) sseSend(res, "done", { message: assistantMsg });
    } catch (e) {
      if (!ac.signal.aborted && !res.writableEnded) sseSend(res, "failed", { message: e.message });
    }
    if (!res.writableEnded) res.end();
  })
);

// Streamed document generation (POST + SSE). Persists the artifact when done.
app.post(
  "/api/ideas/:id/artifacts",
  wrap(async (req, res) => {
    sseInit(res);
    const ac = new AbortController();
    req.on("close", () => ac.abort());
    try {
      if (!aiEnabled()) throw new Error("AI is not configured. Set FIREWORKS_API_KEY.");
      const idea = await getIdea(Number(req.params.id));
      if (!idea) throw new Error("Idea not found.");
      const kind = (req.body?.kind || "").toString();
      if (!ARTIFACTS[kind]) throw new Error("Unknown document type.");

      let full = "";
      for await (const delta of streamArtifact(idea, kind, { signal: ac.signal })) {
        if (res.writableEnded) break;
        full += delta;
        sseSend(res, "token", { text: delta });
      }
      if (ac.signal.aborted) return;
      const artifact = await createArtifact({
        ideaId: idea.id,
        kind,
        title: artifactTitle(kind),
        content: full,
      });
      if (!res.writableEnded) sseSend(res, "done", { artifact });
    } catch (e) {
      if (!ac.signal.aborted && !res.writableEnded) sseSend(res, "failed", { message: e.message });
    }
    if (!res.writableEnded) res.end();
  })
);

app.delete(
  "/api/ideas/:id/artifacts/:artifactId",
  wrap(async (req, res) => {
    const ok = await deleteArtifact(Number(req.params.artifactId));
    if (!ok) return res.status(404).json({ error: "Document not found." });
    res.status(204).end();
  })
);

// ---- error handling ------------------------------------------------------

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Something went wrong." });
});

export default app;
