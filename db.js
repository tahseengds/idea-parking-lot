import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pluggable backend. Two implementations expose the same { query, run, exec }
// async surface:
//   - node:sqlite   → local file, zero-config, used for local dev.
//   - libSQL (HTTP) → Turso/libSQL, persists on serverless (Vercel).
// Selected by whether TURSO_DATABASE_URL / LIBSQL_URL is set.
let backend = null;
let initPromise = null;

const LIBSQL_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || "";

async function makeLibsqlBackend() {
  const { createClient } = await import("@libsql/client/web");
  const c = createClient({
    url: LIBSQL_URL,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN,
  });
  return {
    kind: "libsql",
    query: async (sql, params = []) => (await c.execute({ sql, args: params })).rows,
    run: async (sql, params = []) => {
      const r = await c.execute({ sql, args: params });
      return {
        lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null,
        changes: Number(r.rowsAffected || 0),
      };
    },
    exec: async (sql) => {
      await c.execute(sql);
    },
  };
}

async function makeSqliteBackend() {
  const { DatabaseSync } = await import("node:sqlite");
  const path =
    process.env.DB_PATH || (process.env.VERCEL ? "/tmp/ideas.db" : join(__dirname, "ideas.db"));
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return {
    kind: "sqlite",
    query: (sql, params = []) => db.prepare(sql).all(...params),
    run: (sql, params = []) => {
      const i = db.prepare(sql).run(...params);
      return { lastInsertRowid: Number(i.lastInsertRowid), changes: i.changes };
    },
    exec: (sql) => db.exec(sql),
  };
}

export function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      backend = LIBSQL_URL ? await makeLibsqlBackend() : await makeSqliteBackend();
      await backend.exec(`
        CREATE TABLE IF NOT EXISTS ideas (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          text       TEXT    NOT NULL,
          tags       TEXT    NOT NULL DEFAULT '[]',
          status     TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
          created_at TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);
      return backend;
    })();
  }
  return initPromise;
}

export function dbKind() {
  return backend ? backend.kind : "uninitialized";
}

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
    id: Number(row.id),
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

export async function createIdea({ text, tags }) {
  const info = await backend.run("INSERT INTO ideas (text, tags) VALUES (?, ?)", [
    text.trim(),
    JSON.stringify(normalizeTags(tags)),
  ]);
  return getIdea(Number(info.lastInsertRowid));
}

export async function getIdea(id) {
  const rows = await backend.query("SELECT * FROM ideas WHERE id = ?", [id]);
  return rowToIdea(rows[0]);
}

const SORTS = {
  newest: "datetime(created_at) DESC, id DESC",
  oldest: "datetime(created_at) ASC, id ASC",
  az: "LOWER(text) ASC, id ASC",
};

export async function listIdeas({ search = "", tag = "", status = "", sort = "newest" } = {}) {
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
    where.push("EXISTS (SELECT 1 FROM json_each(ideas.tags) WHERE json_each.value = ?)");
    params.push(tag.trim().replace(/^#/, "").toLowerCase());
  }

  const order = SORTS[sort] || SORTS.newest;
  const sql =
    "SELECT * FROM ideas" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    ` ORDER BY (status = 'archived') ASC, ${order}`;

  const rows = await backend.query(sql, params);
  return rows.map(rowToIdea);
}

export async function countByStatus() {
  const rows = await backend.query(
    "SELECT status, COUNT(*) AS count FROM ideas GROUP BY status",
    []
  );
  const out = { active: 0, done: 0, archived: 0, total: 0 };
  for (const r of rows) {
    const n = Number(r.count);
    if (r.status in out) out[r.status] = n;
    out.total += n;
  }
  return out;
}

export async function updateIdea(id, patch) {
  const existing = await getIdea(id);
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
  await backend.run(`UPDATE ideas SET ${fields.join(", ")} WHERE id = ?`, params);
  return getIdea(id);
}

export async function deleteIdea(id) {
  const r = await backend.run("DELETE FROM ideas WHERE id = ?", [id]);
  return r.changes > 0;
}

export async function allTags() {
  const rows = await backend.query(
    `SELECT json_each.value AS tag, COUNT(*) AS count
       FROM ideas, json_each(ideas.tags)
      GROUP BY json_each.value
      ORDER BY count DESC, tag ASC`,
    []
  );
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
}

export { normalizeTags };
