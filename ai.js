import Anthropic from "@anthropic-ai/sdk";

// Default to the most capable model; override with MODEL if desired.
const MODEL = process.env.MODEL || "claude-opus-4-8";

// The client reads ANTHROPIC_API_KEY from the environment. We construct it
// lazily so the rest of the app runs fine without a key configured.
let _client = null;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// A stable system prompt shared across calls (cache_control marks it for
// prompt caching; it only engages once the prefix is large enough, but it's
// the right shape and costs nothing otherwise).
const SYSTEM = `You are a creative thinking partner inside an idea parking lot — a tool where someone dumps quick, one-line ideas.

Your job is to help them think laterally: surface adjacent concepts they might not have considered, and find non-obvious connections between ideas they've already captured.

Principles:
- Be specific and concrete, never generic filler.
- Favour ideas that are genuinely *different* angles, not restatements.
- Keep each suggestion to a single crisp line; put the reasoning in the detail field.
- Match the user's domain and altitude — if the idea is a product, think product; if it's research, think research.`;

function parseJson(message) {
  const block = message.content.find((b) => b.type === "text");
  if (!block) throw new Error("No text content in model response");
  return JSON.parse(block.text);
}

const BRANCH_SCHEMA = {
  type: "object",
  properties: {
    branches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A single crisp one-line idea, ready to save as its own entry." },
          detail: { type: "string", description: "One or two sentences on why this is a worthwhile direction and how it relates." },
          tags: { type: "array", items: { type: "string" }, description: "1-3 short lowercase tags." },
        },
        required: ["title", "detail", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["branches"],
  additionalProperties: false,
};

const CONNECT_SCHEMA = {
  type: "object",
  properties: {
    connections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          relatedId: { type: "integer", description: "The id of the related idea from the provided list." },
          relationship: { type: "string", description: "One sentence on the non-obvious link between the two ideas." },
        },
        required: ["relatedId", "relationship"],
        additionalProperties: false,
      },
    },
    synthesis: {
      type: "string",
      description: "One new idea that combines threads across the connected ideas, or empty string if none is compelling.",
    },
  },
  required: ["connections", "synthesis"],
  additionalProperties: false,
};

/**
 * Generate related concepts that branch off a single idea.
 */
export async function branchIdea(idea) {
  const c = client();
  if (!c) throw new Error("AI is not configured");

  const prompt = `Here is an idea I just captured:

"${idea.text}"${idea.tags.length ? `\nTags: ${idea.tags.join(", ")}` : ""}

Give me exactly 5 related concepts I might not have thought of — adjacent ideas, unexpected applications, or directions this opens up. Each should stand on its own as a new idea I could save.`;

  const message = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: BRANCH_SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  return parseJson(message).branches;
}

/**
 * Find connections between a target idea and a list of other ideas.
 * `others` is an array of { id, text }.
 */
export async function connectIdea(idea, others) {
  const c = client();
  if (!c) throw new Error("AI is not configured");

  if (!others.length) return { connections: [], synthesis: "" };

  const list = others.map((o) => `[${o.id}] ${o.text}`).join("\n");
  const prompt = `Target idea:
"${idea.text}"

My other ideas (each prefixed with its id):
${list}

Identify which of my other ideas connect to the target idea in a meaningful, non-obvious way. Only include genuine connections (it's fine to return few or none). Use the exact ids from the list. Then, if there's a compelling combination, propose one new synthesized idea that bridges them.`;

  const message = await c.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: CONNECT_SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  return parseJson(message);
}
