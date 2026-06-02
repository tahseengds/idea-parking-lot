import OpenAI from "openai";

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

const SYSTEM = `You are a sharp product and engineering thinking partner inside an "idea parking lot" app. You help people take a one-line idea and develop it into something concrete and buildable: branching it into rich directions, connecting it to other ideas, answering questions about it, and producing real plans, specs, and strategy documents.

Be specific, practical, and implementation-oriented. Prefer concrete detail over generic advice. Never pad with filler.`;

// ---- low-level streaming -------------------------------------------------

async function rawStream(messages, { signal, maxTokens = 2048, temperature = 0.7 } = {}) {
  const c = client();
  if (!c) throw new Error("AI is not configured");
  return c.chat.completions.create(
    { model: MODEL, max_tokens: maxTokens, temperature, stream: true, messages },
    { signal }
  );
}

// Stream raw text deltas (for chat and markdown documents).
export async function* streamText(messages, opts = {}) {
  const stream = await rawStream(messages, {
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.5,
    signal: opts.signal,
  });
  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta?.content || "";
    if (d) yield d;
  }
}

// Stream a sequence of top-level JSON objects, yielding each as it completes.
// Brace/string state machine — robust to compact or pretty-printed JSON.
async function* streamObjects(messages, opts = {}) {
  const stream = await rawStream(messages, {
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.8,
    signal: opts.signal,
  });
  let buf = "";
  let pos = 0;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;

  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta?.content || "";
    if (!d) continue;
    buf += d;
    while (pos < buf.length) {
      const ch = buf[pos];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        if (depth === 0) objStart = pos;
        depth++;
      } else if (ch === "}") {
        if (depth > 0) {
          depth--;
          if (depth === 0 && objStart >= 0) {
            try {
              yield JSON.parse(buf.slice(objStart, pos + 1));
            } catch {
              /* skip malformed */
            }
            objStart = -1;
          }
        }
      }
      pos++;
    }
  }
}

// ---- branches (rich, structured) -----------------------------------------

function branchPrompt(idea) {
  const tags = idea.tags?.length ? `\nExisting tags: ${idea.tags.join(", ")}` : "";
  return `Idea to branch from:
"${idea.text}"${tags}${idea.detail ? `\n\nExisting detail:\n${idea.detail}` : ""}

Generate 4 distinct, deeply-developed directions this idea could branch into. Each must be a concrete, implementation-oriented concept — NOT a vague one-liner. Make them genuinely different angles.

Return each direction as a JSON object (objects may span multiple lines) with EXACTLY these fields:
{
  "title": "short, specific name for this direction",
  "concept": "2-4 sentences clearly describing what it is",
  "targetUsers": "who it is for",
  "coreFeatures": ["concrete feature", "concrete feature", "concrete feature"],
  "workflow": "how it works end to end, step by step",
  "technical": "key technical considerations: stack, architecture, data, integrations",
  "businessValue": "why it matters and the value it creates",
  "challenges": "the hardest parts and real risks",
  "expansion": "where it could grow next",
  "tags": ["3", "lowercase", "tags"]
}

Output ONLY the JSON objects, one after another. No markdown fences, no commentary.`;
}

export async function* streamBranches(idea, opts = {}) {
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: branchPrompt(idea) },
  ];
  for await (const obj of streamObjects(messages, { ...opts, maxTokens: 6000 })) {
    if (obj && typeof obj.title === "string" && typeof obj.concept === "string") {
      yield {
        title: obj.title,
        concept: obj.concept,
        targetUsers: obj.targetUsers || "",
        coreFeatures: Array.isArray(obj.coreFeatures) ? obj.coreFeatures.filter((x) => typeof x === "string") : [],
        workflow: obj.workflow || "",
        technical: obj.technical || "",
        businessValue: obj.businessValue || "",
        challenges: obj.challenges || "",
        expansion: obj.expansion || "",
        tags: Array.isArray(obj.tags) ? obj.tags.filter((t) => typeof t === "string") : [],
      };
    }
  }
}

// ---- connections ---------------------------------------------------------

function connectPrompt(idea, others) {
  const list = others.map((o) => `[${o.id}] ${o.text}`).join("\n");
  return `Target idea:
"${idea.text}"

My other ideas (each prefixed with its id):
${list}

Identify which of my other ideas connect to the target in a meaningful, non-obvious way. Only genuine connections (few or none is fine). Use the exact integer ids. Then, if compelling, add ONE synthesized idea that bridges them.

Output JSON objects, one after another. For each connection:
{"type":"connection","relatedId":123,"relationship":"one sentence on the non-obvious link"}
Optionally, as the LAST object:
{"type":"synthesis","text":"one new idea combining threads"}
No markdown, no commentary.`;
}

export async function* streamConnections(idea, others, opts = {}) {
  if (!others.length) return;
  const messages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: connectPrompt(idea, others) },
  ];
  for await (const obj of streamObjects(messages, opts)) {
    if (!obj) continue;
    if (obj.type === "synthesis" && typeof obj.text === "string") {
      yield { kind: "synthesis", text: obj.text };
    } else if (Number.isFinite(Number(obj.relatedId))) {
      yield { kind: "connection", relatedId: Number(obj.relatedId), relationship: String(obj.relationship || "") };
    }
  }
}

// ---- "Work on Idea" : chat + document artifacts --------------------------

function ideaContext(idea) {
  let ctx = `We are developing this idea:\n\nTitle: ${idea.text}`;
  if (idea.tags?.length) ctx += `\nTags: ${idea.tags.join(", ")}`;
  if (idea.detail) ctx += `\n\nDetail:\n${idea.detail}`;
  return ctx;
}

// Free-form chat about an idea. `history` is [{role, content}], `message` is new.
export async function* streamChat(idea, history, message, opts = {}) {
  const messages = [
    { role: "system", content: `${SYSTEM}\n\n${ideaContext(idea)}\n\nAnswer questions and help develop this specific idea. Use Markdown. Be concrete.` },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];
  yield* streamText(messages, { ...opts, temperature: 0.5, maxTokens: 4096 });
}

export const ARTIFACTS = {
  plan: {
    title: "Plan & Roadmap",
    instruction:
      "Produce a detailed development plan and roadmap: phases, what to build in each, sequencing, and a realistic timeline. Be concrete about scope.",
  },
  spec: {
    title: "Technical Spec",
    instruction:
      "Write a technical specification: functional requirements, non-functional requirements, system architecture, key components, data model, main APIs/interfaces, and notable technical decisions with trade-offs.",
  },
  business: {
    title: "Business Plan",
    instruction:
      "Write a concise business plan: problem, solution, target market and size, value proposition, business/revenue model, competition, key risks, and what success looks like.",
  },
  mvp: {
    title: "MVP Scope",
    instruction:
      "Define a lean MVP scope: the smallest set of must-have features to validate the core value, explicitly list what is OUT of scope for v1, define success metrics, and give a rough effort estimate.",
  },
  gtm: {
    title: "Go-to-Market",
    instruction:
      "Create a go-to-market strategy: positioning statement, target segments, messaging, acquisition channels, a concrete launch plan, and pricing approach.",
  },
  milestones: {
    title: "Milestones & Tasks",
    instruction:
      "Break this into milestones. For each milestone: a clear goal, the concrete tasks to get there, and the deliverable that marks it done. Order them sensibly.",
  },
};

export function artifactTitle(kind) {
  return ARTIFACTS[kind]?.title || "Document";
}

export async function* streamArtifact(idea, kind, opts = {}) {
  const spec = ARTIFACTS[kind];
  if (!spec) throw new Error("Unknown document type");
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `${ideaContext(idea)}\n\n${spec.instruction}\n\nFormat as clean, well-structured Markdown with headings. Be specific and practical — avoid generic boilerplate. Do not wrap the whole document in code fences.`,
    },
  ];
  yield* streamText(messages, { ...opts, temperature: 0.55, maxTokens: 5000 });
}
