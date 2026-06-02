import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, "ideas.db");

const db = new DatabaseSync(DB_PATH);

// Pragmas for sane concurrent reads and durability.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS ideas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    text       TEXT    NOT NULL,
    tags       TEXT    NOT NULL DEFAULT '[]',  -- JSON array of strings
    status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// ---- helpers -------------------------------------------------------------

function rowToIdea(row) {
  if (!row) return null;
  let tags = [];
  try {
    tags = JSON.parse(row.tags);
    if (!Array.isArray(tags)) tags = [];
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    text: row.text,
    tags,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().replace(/^#/, "").toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ---- queries -------------------------------------------------------------

const stmts = {
  insert: db.prepare("INSERT INTO ideas (text, tags) VALUES (?, ?)"),
  byId: db.prepare("SELECT * FROM ideas WHERE id = ?"),
  delete: db.prepare("DELETE FROM ideas WHERE id = ?"),
};

export function createIdea({ text, tags }) {
  const info = stmts.insert.run(text.trim(), JSON.stringify(normalizeTags(tags)));
  return getIdea(Number(info.lastInsertRowid));
}

export function getIdea(id) {
  return rowToIdea(stmts.byId.get(id));
}

export function listIdeas({ search = "", tag = "", status = "" } = {}) {
  const where = [];
  const params = [];

  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (search) {
    where.push("LOWER(text) LIKE ?");
    params.push(`%${search.toLowerCase()}%`);
  }
  if (tag) {
    // tags is a JSON array; match the exact tag token within it.
    where.push("EXISTS (SELECT 1 FROM json_each(ideas.tags) WHERE json_each.value = ?)");
    params.push(tag.trim().replace(/^#/, "").toLowerCase());
  }

  const sql =
    "SELECT * FROM ideas" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY (status = 'archived') ASC, datetime(created_at) DESC, id DESC";

  return db.prepare(sql).all(...params).map(rowToIdea);
}

export function updateIdea(id, patch) {
  const existing = getIdea(id);
  if (!existing) return null;

  const fields = [];
  const params = [];

  if (typeof patch.text === "string" && patch.text.trim()) {
    fields.push("text = ?");
    params.push(patch.text.trim());
  }
  if (Array.isArray(patch.tags)) {
    fields.push("tags = ?");
    params.push(JSON.stringify(normalizeTags(patch.tags)));
  }
  if (typeof patch.status === "string" && ["active", "done", "archived"].includes(patch.status)) {
    fields.push("status = ?");
    params.push(patch.status);
  }

  if (!fields.length) return existing;

  fields.push("updated_at = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE ideas SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return getIdea(id);
}

export function deleteIdea(id) {
  return stmts.delete.run(id).changes > 0;
}

export function allTags() {
  const rows = db
    .prepare(
      `SELECT json_each.value AS tag, COUNT(*) AS count
         FROM ideas, json_each(ideas.tags)
        GROUP BY json_each.value
        ORDER BY count DESC, tag ASC`
    )
    .all();
  return rows.map((r) => ({ tag: r.tag, count: r.count }));
}

export { normalizeTags };
