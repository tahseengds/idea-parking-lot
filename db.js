import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function addColumnIfMissing(table, column, def) {
  const cols = await backend.query(`PRAGMA table_info(${table})`, []);
  if (!cols.some((c) => c.name === column)) {
    await backend.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
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
      // Migrations for existing databases.
      await addColumnIfMissing("ideas", "parent_id", "INTEGER");
      await addColumnIfMissing("ideas", "detail", "TEXT");

      await backend.exec(`
        CREATE TABLE IF NOT EXISTS artifacts (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          idea_id    INTEGER NOT NULL,
          kind       TEXT    NOT NULL,
          title      TEXT    NOT NULL,
          content    TEXT    NOT NULL DEFAULT '',
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);
      await backend.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          idea_id    INTEGER NOT NULL,
          role       TEXT    NOT NULL,
          content    TEXT    NOT NULL,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
    detail: row.detail || "",
    parentId: row.parent_id != null ? Number(row.parent_id) : null,
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

// ---- ideas ---------------------------------------------------------------

export async function createIdea({ text, tags, detail = "", parentId = null }) {
  const info = await backend.run(
    "INSERT INTO ideas (text, tags, detail, parent_id) VALUES (?, ?, ?, ?)",
    [text.trim(), JSON.stringify(normalizeTags(tags)), detail || "", parentId == null ? null : Number(parentId)]
  );
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

// Returns top-level ideas (parent_id IS NULL) matching the filters, each with a
// nested `children` array (its branches, recursively).
export async function listIdeas({ search = "", tag = "", status = "", sort = "newest" } = {}) {
  const where = ["parent_id IS NULL"];
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
  const top = (
    await backend.query(
      `SELECT * FROM ideas WHERE ${where.join(" AND ")} ORDER BY (status = 'archived') ASC, ${order}`,
      params
    )
  ).map(rowToIdea);

  if (!top.length) return [];

  const childRows = await backend.query(
    "SELECT * FROM ideas WHERE parent_id IS NOT NULL ORDER BY datetime(created_at) ASC, id ASC",
    []
  );
  const byParent = new Map();
  for (const r of childRows) {
    const idea = rowToIdea(r);
    if (!byParent.has(idea.parentId)) byParent.set(idea.parentId, []);
    byParent.get(idea.parentId).push(idea);
  }
  const attach = (idea) => {
    idea.children = byParent.get(idea.id) || [];
    idea.children.forEach(attach);
    return idea;
  };
  top.forEach(attach);
  return top;
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
  if (typeof patch.detail === "string") {
    fields.push("detail = ?");
    params.push(patch.detail);
  }
  if ("parentId" in patch) {
    const pid = patch.parentId == null ? null : Number(patch.parentId);
    if (pid !== id) {
      fields.push("parent_id = ?");
      params.push(pid);
    }
  }

  if (!fields.length) return existing;

  fields.push("updated_at = datetime('now')");
  params.push(id);
  await backend.run(`UPDATE ideas SET ${fields.join(", ")} WHERE id = ?`, params);
  return getIdea(id);
}

export async function deleteIdea(id) {
  const idea = await getIdea(id);
  if (!idea) return false;

  // Collect the id and all descendant ids.
  const ids = [id];
  let frontier = [id];
  while (frontier.length) {
    const ph = frontier.map(() => "?").join(",");
    const kids = await backend.query(`SELECT id FROM ideas WHERE parent_id IN (${ph})`, frontier);
    const kidIds = kids.map((k) => Number(k.id));
    ids.push(...kidIds);
    frontier = kidIds;
  }
  const ph = ids.map(() => "?").join(",");
  await backend.run(`DELETE FROM artifacts WHERE idea_id IN (${ph})`, ids);
  await backend.run(`DELETE FROM messages WHERE idea_id IN (${ph})`, ids);
  const r = await backend.run(`DELETE FROM ideas WHERE id IN (${ph})`, ids);
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

export async function countByStatus() {
  const rows = await backend.query(
    "SELECT status, COUNT(*) AS count FROM ideas WHERE parent_id IS NULL GROUP BY status",
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

// ---- artifacts -----------------------------------------------------------

function rowToArtifact(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    ideaId: Number(row.idea_id),
    kind: row.kind,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function createArtifact({ ideaId, kind, title, content = "" }) {
  const info = await backend.run(
    "INSERT INTO artifacts (idea_id, kind, title, content) VALUES (?, ?, ?, ?)",
    [Number(ideaId), kind, title, content]
  );
  return getArtifact(Number(info.lastInsertRowid));
}

export async function getArtifact(id) {
  const rows = await backend.query("SELECT * FROM artifacts WHERE id = ?", [id]);
  return rowToArtifact(rows[0]);
}

export async function listArtifacts(ideaId) {
  const rows = await backend.query(
    "SELECT * FROM artifacts WHERE idea_id = ? ORDER BY datetime(created_at) DESC, id DESC",
    [Number(ideaId)]
  );
  return rows.map(rowToArtifact);
}

export async function deleteArtifact(id) {
  const r = await backend.run("DELETE FROM artifacts WHERE id = ?", [Number(id)]);
  return r.changes > 0;
}

// ---- messages (workspace chat) -------------------------------------------

function rowToMessage(row) {
  return { id: Number(row.id), ideaId: Number(row.idea_id), role: row.role, content: row.content, createdAt: row.created_at };
}

export async function addMessage({ ideaId, role, content }) {
  const info = await backend.run("INSERT INTO messages (idea_id, role, content) VALUES (?, ?, ?)", [
    Number(ideaId),
    role,
    content,
  ]);
  const rows = await backend.query("SELECT * FROM messages WHERE id = ?", [Number(info.lastInsertRowid)]);
  return rowToMessage(rows[0]);
}

export async function listMessages(ideaId) {
  const rows = await backend.query(
    "SELECT * FROM messages WHERE idea_id = ? ORDER BY datetime(created_at) ASC, id ASC",
    [Number(ideaId)]
  );
  return rows.map(rowToMessage);
}

export { normalizeTags };
