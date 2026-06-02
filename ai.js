import OpenAI from "openai";

// Fireworks AI is OpenAI-compatible. Default to the Kimi router model.
const MODEL = process.env.MODEL || "accounts/fireworks/routers/kimi-k2p6-turbo";
const BASE_URL = process.env.FIREWORKS_BASE_URL || "https://api.fireworks.ai/inference/v1";

function apiKey() {
  return process.env.FIREWORKS_API_KEY || process.env.OPENAI_API_KEY || "";
}

// Construct the client lazily so the rest of the app runs without a key.
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
- Always respond with valid JSON only, matching the requested shape exactly. No markdown, no prose outside the JSON.`;

// Pull a JSON object out of a model response, tolerating stray code fences.
function parseJson(content) {
  if (!content) throw new Error("Empty response from the model");
  let text = content.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  // Fall back to the outermost { ... } if there's leading/trailing chatter.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1) text = text.slice(first, last + 1);
  }
  return JSON.parse(text);
}

async function complete(userPrompt) {
  const c = client();
  if (!c) throw new Error("AI is not configured");

  const res = await c.chat.completions.create({
    model: MODEL,
    max_tokens: 2048,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  return parseJson(res.choices?.[0]?.message?.content);
}

/**
 * Generate related concepts that branch off a single idea.
 * Returns an array of { title, detail, tags }.
 */
export async function branchIdea(idea) {
  const prompt = `Here is an idea I just captured:

"${idea.text}"${idea.tags.length ? `\nTags: ${idea.tags.join(", ")}` : ""}

Give me exactly 5 related concepts I might not have thought of — adjacent ideas, unexpected applications, or directions this opens up. Each should stand on its own as a new idea I could save.

Respond with JSON of exactly this shape:
{"branches":[{"title":"a single crisp one-line idea","detail":"one or two sentences on why it's worthwhile and how it relates","tags":["1-3","short","lowercase"]}]}`;

  const data = await complete(prompt);
  const branches = Array.isArray(data.branches) ? data.branches : [];
  return branches
    .filter((b) => b && typeof b.title === "string")
    .map((b) => ({
      title: b.title,
      detail: typeof b.detail === "string" ? b.detail : "",
      tags: Array.isArray(b.tags) ? b.tags.filter((t) => typeof t === "string") : [],
    }));
}

/**
 * Find connections between a target idea and a list of other ideas.
 * `others` is an array of { id, text }. Returns { connections, synthesis }.
 */
export async function connectIdea(idea, others) {
  if (!others.length) return { connections: [], synthesis: "" };

  const list = others.map((o) => `[${o.id}] ${o.text}`).join("\n");
  const prompt = `Target idea:
"${idea.text}"

My other ideas (each prefixed with its id):
${list}

Identify which of my other ideas connect to the target idea in a meaningful, non-obvious way. Only include genuine connections (it's fine to return few or none). Use the exact integer ids from the list. Then, if there's a compelling combination, propose one new synthesized idea that bridges them.

Respond with JSON of exactly this shape:
{"connections":[{"relatedId":123,"relationship":"one sentence on the non-obvious link"}],"synthesis":"one new idea combining threads, or empty string"}`;

  const data = await complete(prompt);
  const connections = Array.isArray(data.connections) ? data.connections : [];
  return {
    connections: connections
      .filter((c) => c && Number.isFinite(Number(c.relatedId)))
      .map((c) => ({ relatedId: Number(c.relatedId), relationship: String(c.relationship || "") })),
    synthesis: typeof data.synthesis === "string" ? data.synthesis : "",
  };
}
