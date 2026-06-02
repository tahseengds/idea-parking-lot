import OpenAI from "openai";

// Fireworks AI is OpenAI-compatible. Default to the Kimi router model.
const MODEL = process.env.MODEL || "accounts/fireworks/routers/kimi-k2p6-turbo";
const BASE_URL = process.env.FIREWORKS_BASE_URL || "https://api.fireworks.ai/inference/v1";

function apiKey() {
  return process.env.FIREWORKS_API_KEY || process.env.OPENAI_API_KEY || "";
}

let _client = null;
function client() {
  if (!apiKey()) return null;
  if (!_client) _client = new OpenAI({ apiKey: apiKey(), baseURL: BASE_URL });
  return _client;
}

export function aiEnabled() {
  return Boolean(apiKey());
}

const SYSTEM = `You are a creative thinking partner inside an idea parking lot — a tool where someone dumps quick, one-line ideas.

Your job is to help them think laterally: surface adjacent concepts they might not have considered, and find non-obvious connections between ideas they've already captured.

Principles:
- Be specific and concrete, never generic filler.
- Favour ideas that are genuinely different angles, not restatements.
- Keep each suggestion to a single crisp line; put the reasoning in the detail field.
- Match the user's domain and altitude — if the idea is a product, think product; if it's research, think research.
- Output JSON Lines: one compact JSON object per line, nothing else. No markdown, no array brackets, no prose.`;

// Parse a single streamed line into a JSON object, tolerating fences/bullets.
function tryParseLine(line) {
  let s = line.trim();
  if (!s || s.startsWith("```")) return null;
  if (!s.startsWith("{")) {
    const i = s.indexOf("{");
    if (i === -1) return null;
    s = s.slice(i);
  }
  const last = s.lastIndexOf("}");
  if (last !== -1) s = s.slice(0, last + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Stream the model's output and yield one parsed JSON object per complete line.
async function* streamLines(userPrompt, { signal } = {}) {
  const c = client();
  if (!c) throw new Error("AI is not configured");

  const stream = await c.chat.completions.create(
    {
      model: MODEL,
      max_tokens: 2048,
      temperature: 0.7,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
    },
    { signal }
  );

  let buf = "";
  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content || "";
    if (!delta) continue;
    buf += delta;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const obj = tryParseLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      if (obj) yield obj;
    }
  }
  const tail = tryParseLine(buf);
  if (tail) yield tail;
}

function branchPrompt(idea) {
  return `Here is an idea I just captured:

"${idea.text}"${idea.tags.length ? `\nTags: ${idea.tags.join(", ")}` : ""}

Give me exactly 5 related concepts I might not have thought of — adjacent ideas, unexpected applications, or directions this opens up. Each should stand on its own as a new idea I could save.

Output exactly 5 lines, one compact JSON object per line:
{"title":"a single crisp one-line idea","detail":"one or two sentences on why it's worthwhile and how it relates","tags":["1-3","short","lowercase"]}`;
}

function connectPrompt(idea, others) {
  const list = others.map((o) => `[${o.id}] ${o.text}`).join("\n");
  return `Target idea:
"${idea.text}"

My other ideas (each prefixed with its id):
${list}

Identify which of my other ideas connect to the target idea in a meaningful, non-obvious way. Only include genuine connections (it's fine to return few or none). Use the exact integer ids from the list. Then, if there's a compelling combination, add ONE synthesized idea that bridges them — as the final line.

Output JSON Lines, one compact object per line. For each connection:
{"type":"connection","relatedId":123,"relationship":"one sentence on the non-obvious link"}
Optionally, as the LAST line only:
{"type":"synthesis","text":"one new idea combining threads"}`;
}

/**
 * Stream branch suggestions. Yields { title, detail, tags } objects.
 */
export async function* streamBranches(idea, opts = {}) {
  for await (const obj of streamLines(branchPrompt(idea), opts)) {
    if (obj && typeof obj.title === "string") {
      yield {
        title: obj.title,
        detail: typeof obj.detail === "string" ? obj.detail : "",
        tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === "string") : [],
      };
    }
  }
}

/**
 * Stream connections. Yields { kind: "connection", relatedId, relationship }
 * and at most one { kind: "synthesis", text }.
 */
export async function* streamConnections(idea, others, opts = {}) {
  if (!others.length) return;
  for await (const obj of streamLines(connectPrompt(idea, others), opts)) {
    if (!obj) continue;
    if (obj.type === "synthesis" && typeof obj.text === "string") {
      yield { kind: "synthesis", text: obj.text };
    } else if (Number.isFinite(Number(obj.relatedId))) {
      yield { kind: "connection", relatedId: Number(obj.relatedId), relationship: String(obj.relationship || "") };
    }
  }
}

// ---- non-streaming wrappers (used by the plain POST endpoints) ------------

export async function branchIdea(idea) {
  const out = [];
  for await (const b of streamBranches(idea)) out.push(b);
  return out;
}

export async function connectIdea(idea, others) {
  const connections = [];
  let synthesis = "";
  for await (const e of streamConnections(idea, others)) {
    if (e.kind === "synthesis") synthesis = e.text;
    else connections.push({ relatedId: e.relatedId, relationship: e.relationship });
  }
  return { connections, synthesis };
}
