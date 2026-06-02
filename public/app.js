// ---- tiny helpers --------------------------------------------------------

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
};

// ---- icons (inline SVG, stroke = currentColor) ---------------------------

const ICONS = {
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  sparkle:
    '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M18 14l.7 1.9 1.8.7-1.8.7L18 19l-.7-1.7-1.8-.7 1.8-.7z"/>',
  link: '<path d="M9 12h6"/><path d="M9 7H7a5 5 0 0 0 0 10h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  undo: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>',
  archive:
    '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  unarchive:
    '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M12 19v-7"/><path d="M9 15l3-3 3 3"/>',
  trash:
    '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M12 3v12"/><path d="m7 11 5 4 5-4"/><path d="M5 21h14"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
};

function icon(name) {
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" class="icon" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return document.importNode(doc.documentElement, true);
}

// Build an icon-only button with an accessible label/tooltip.
function iconBtn(name, label, onclick, cls = "") {
  const b = el("button", { className: `icon-btn ${cls}`.trim(), title: label, onclick });
  b.setAttribute("aria-label", label);
  b.append(icon(name));
  return b;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// Toast with an inline action button (e.g. Undo).
function toastAction(msg, label, onAction) {
  const t = $("#toast");
  t.classList.remove("error");
  const btn = el("button", { className: "toast-action", textContent: label });
  let used = false;
  btn.addEventListener("click", () => {
    if (used) return;
    used = true;
    t.hidden = true;
    clearTimeout(toastTimer);
    onAction();
  });
  t.replaceChildren(document.createTextNode(msg + " "), btn);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 6000);
}

function timeAgo(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (isNaN(secs)) return "";
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function parseTags(str) {
  return str
    .split(",")
    .map((s) => s.trim().replace(/^#/, "").toLowerCase())
    .filter(Boolean);
}

// ---- state ---------------------------------------------------------------

const SAVED = (() => {
  try {
    return JSON.parse(localStorage.getItem("ipl-view") || "{}");
  } catch {
    return {};
  }
})();

const state = {
  search: SAVED.search || "",
  status: SAVED.status || "",
  tag: SAVED.tag || "",
  sort: SAVED.sort || "newest",
  aiEnabled: false,
};

function saveView() {
  localStorage.setItem(
    "ipl-view",
    JSON.stringify({ search: state.search, status: state.status, tag: state.tag, sort: state.sort })
  );
}

// ---- rendering -----------------------------------------------------------

function ideaCard(idea) {
  const card = el("div", { className: `idea status-${idea.status}` });

  const text = el("div", { className: "idea-text", textContent: idea.text });
  text.title = "Double-click to edit";
  text.addEventListener("dblclick", () => enterEdit(idea, card));

  const tags = el(
    "div",
    { className: "idea-tags" },
    ...idea.tags.map((t) =>
      el("span", {
        className: "t",
        textContent: "#" + t,
        title: `Filter by #${t}`,
        onclick: () => setTag(t),
      })
    )
  );

  const actions = el("div", { className: "idea-actions" });

  if (state.aiEnabled) {
    actions.append(
      iconBtn("sparkle", "Branch off related ideas", () => openBranch(idea), "accent"),
      iconBtn("link", "Find connections to other ideas", () => openConnect(idea), "accent"),
      el("div", { className: "spacer" })
    );
  }

  actions.append(
    iconBtn("edit", "Edit text & tags", () => enterEdit(idea, card)),
    idea.status === "done"
      ? iconBtn("undo", "Mark active", () => patchStatus(idea, "active"))
      : iconBtn("check", "Mark done", () => patchStatus(idea, "done")),
    idea.status === "archived"
      ? iconBtn("unarchive", "Unarchive", () => patchStatus(idea, "active"))
      : iconBtn("archive", "Archive", () => patchStatus(idea, "archived")),
    iconBtn("trash", "Delete", () => removeIdea(idea), "danger")
  );

  const meta = el(
    "div",
    { className: "idea-meta" },
    tags,
    el("span", { className: "created", textContent: timeAgo(idea.createdAt) })
  );

  card.append(text, meta, actions);
  return card;
}

// Replace a card's contents with an inline editor for text + tags.
function enterEdit(idea, card) {
  const textIn = el("input", { type: "text", value: idea.text, maxLength: 500 });
  const tagsIn = el("input", {
    type: "text",
    value: idea.tags.join(", "),
    placeholder: "tags, comma separated",
  });
  const save = el("button", { className: "edit-save", textContent: "Save" });
  const cancel = el("button", { className: "edit-cancel", textContent: "Cancel" });

  const editor = el(
    "div",
    { className: "idea-edit" },
    textIn,
    tagsIn,
    el("div", { className: "edit-actions" }, save, cancel)
  );
  card.replaceChildren(editor);
  textIn.focus();
  textIn.setSelectionRange(textIn.value.length, textIn.value.length);

  const doSave = async () => {
    const next = textIn.value.trim();
    if (!next) return toast("An idea needs some text", true);
    try {
      await api(`/api/ideas/${idea.id}`, {
        method: "PATCH",
        body: { text: next, tags: parseTags(tagsIn.value) },
      });
      await refresh();
      toast("Saved");
    } catch (e) {
      toast(e.message, true);
    }
  };

  save.addEventListener("click", doSave);
  cancel.addEventListener("click", () => refresh());
  for (const input of [textIn, tagsIn]) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSave();
      }
      if (e.key === "Escape") refresh();
    });
  }
}

async function refresh() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  if (state.tag) params.set("tag", state.tag);
  if (state.sort) params.set("sort", state.sort);

  const [ideas, tags, stats] = await Promise.all([
    api("/api/ideas?" + params.toString()),
    api("/api/tags"),
    api("/api/stats"),
  ]);

  const list = $("#ideas");
  list.replaceChildren(...ideas.map(ideaCard));
  $("#empty").hidden = ideas.length > 0;

  const filtered = state.search || state.tag || state.status;
  $("#count").textContent = ideas.length
    ? `${ideas.length} idea${ideas.length === 1 ? "" : "s"}${filtered ? " (filtered)" : ""}`
    : "";

  updateChipCounts(stats);
  renderTagCloud(tags);
  saveView();
}

function updateChipCounts(stats) {
  const map = { "": stats.total, active: stats.active, done: stats.done, archived: stats.archived };
  for (const chip of document.querySelectorAll("#status-filters .chip")) {
    const n = map[chip.dataset.status] ?? 0;
    let c = chip.querySelector(".chip-count");
    if (!c) {
      c = el("span", { className: "chip-count" });
      chip.append(c);
    }
    c.textContent = n;
  }
}

function renderTagCloud(tags) {
  const cloud = $("#tag-cloud");
  cloud.replaceChildren(
    ...tags.map((t) =>
      el(
        "button",
        {
          className: "tag-pill" + (state.tag === t.tag ? " active" : ""),
          onclick: () => setTag(state.tag === t.tag ? "" : t.tag),
        },
        "#" + t.tag,
        el("span", { className: "count", textContent: t.count })
      )
    )
  );
}

// ---- actions -------------------------------------------------------------

async function patchStatus(idea, status) {
  try {
    await api(`/api/ideas/${idea.id}`, { method: "PATCH", body: { status } });
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

async function removeIdea(idea) {
  try {
    await api(`/api/ideas/${idea.id}`, { method: "DELETE" });
    await refresh();
    // Offer a quick undo (recreates the idea with the same text/tags/status).
    toastAction("Deleted", "Undo", async () => {
      try {
        const recreated = await api("/api/ideas", {
          method: "POST",
          body: { text: idea.text, tags: idea.tags },
        });
        if (idea.status !== "active") {
          await api(`/api/ideas/${recreated.id}`, { method: "PATCH", body: { status: idea.status } });
        }
        await refresh();
        toast("Restored");
      } catch (e) {
        toast(e.message, true);
      }
    });
  } catch (e) {
    toast(e.message, true);
  }
}

function setTag(tag) {
  state.tag = tag;
  refresh();
}

// ---- AI panel ------------------------------------------------------------

function openPanel(title, sourceText) {
  $("#panel-title").textContent = title;
  $("#panel-source").textContent = sourceText;
  $("#panel-body").replaceChildren(
    el("div", { className: "loader" }, el("div", { className: "spinner" }), "Thinking…")
  );
  $("#panel").hidden = false;
  $("#panel").setAttribute("aria-hidden", "false");
  $("#scrim").hidden = false;
}

let currentStream = null;

function closePanel() {
  if (currentStream) {
    currentStream.close();
    currentStream = null;
  }
  $("#panel").hidden = true;
  $("#panel").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

// Open an SSE stream and route named events to handlers. `handlers` may include
// any server event name plus `done` and `failed`.
function streamPanel(url, handlers) {
  if (currentStream) currentStream.close();
  const es = new EventSource(url);
  currentStream = es;
  let finished = false;
  const finish = () => {
    finished = true;
    es.close();
    if (currentStream === es) currentStream = null;
  };

  for (const [name, fn] of Object.entries(handlers)) {
    if (name === "done" || name === "failed") continue;
    es.addEventListener(name, (ev) => fn(JSON.parse(ev.data)));
  }
  es.addEventListener("done", () => {
    finish();
    handlers.done?.();
  });
  es.addEventListener("failed", (ev) => {
    finish();
    handlers.failed?.(JSON.parse(ev.data));
  });
  es.onerror = () => {
    if (finished) return;
    finish();
    handlers.failed?.({ message: "Connection lost." });
  };
}

function streamingTail(label) {
  return el("div", { className: "loader stream-tail" }, el("div", { className: "spinner" }), label);
}

function openBranch(idea) {
  openPanel("Branches", `“${idea.text}”`);
  const body = $("#panel-body");
  const cards = [];
  let tail = null;

  const saveAllBtn = el("button", { className: "ghost-btn" }, icon("plus"), "Save all");
  saveAllBtn.addEventListener("click", () => {
    saveAllBtn.disabled = true;
    let saved = 0;
    for (const card of cards) {
      const btn = card.querySelector(".add-btn");
      if (btn && !btn.classList.contains("added")) {
        btn.click();
        saved++;
      }
    }
    saveAllBtn.textContent = saved ? `Saved ${saved}` : "All saved";
  });
  const row = el("div", { className: "save-all-row" }, saveAllBtn);

  streamPanel(`/api/ideas/${idea.id}/branch/stream`, {
    branch: (b) => {
      if (!cards.length) {
        tail = streamingTail("generating…");
        body.replaceChildren(row, tail);
      }
      const card = suggestionCard(b);
      cards.push(card);
      body.insertBefore(card, tail);
    },
    done: () => {
      tail?.remove();
      if (!cards.length) {
        body.replaceChildren(el("p", { className: "panel-note" }, "No branches came back. Try again."));
      }
    },
    failed: (d) => {
      tail?.remove();
      if (!cards.length) {
        body.replaceChildren(el("p", { className: "panel-note" }, d.message || "Something went wrong."));
      }
    },
  });
}

function suggestionCard(b) {
  const addBtn = el("button", { className: "add-btn" }, icon("plus"), "Save");
  addBtn.addEventListener("click", async () => {
    if (addBtn.classList.contains("added")) return;
    try {
      await api("/api/ideas", { method: "POST", body: { text: b.title, tags: b.tags || [] } });
      addBtn.classList.add("added");
      addBtn.textContent = "Saved";
      refresh();
    } catch (e) {
      toast(e.message, true);
    }
  });

  return el(
    "div",
    { className: "suggestion" },
    el("h3", { textContent: b.title }),
    el("p", { textContent: b.detail }),
    el(
      "div",
      { className: "sug-foot" },
      el(
        "div",
        { className: "sug-tags" },
        ...(b.tags || []).map((t) => el("span", { className: "t", textContent: "#" + t }))
      ),
      addBtn
    )
  );
}

function synthesisCard(text) {
  const addBtn = el("button", { className: "add-btn" }, icon("plus"), "Save this");
  addBtn.addEventListener("click", async () => {
    if (addBtn.classList.contains("added")) return;
    try {
      await api("/api/ideas", { method: "POST", body: { text, tags: ["synthesis"] } });
      addBtn.classList.add("added");
      addBtn.textContent = "Saved";
      refresh();
    } catch (e) {
      toast(e.message, true);
    }
  });
  return el(
    "div",
    { className: "synthesis" },
    el("div", { className: "label" }, "Synthesis"),
    el("p", { textContent: text }),
    addBtn
  );
}

function openConnect(idea) {
  openPanel("Connections", `“${idea.text}”`);
  const body = $("#panel-body");
  let tail = streamingTail("looking for links…");
  body.replaceChildren(tail);
  let count = 0;
  let synthEl = null;

  streamPanel(`/api/ideas/${idea.id}/connect/stream`, {
    connection: (c) => {
      count++;
      const node = el(
        "div",
        { className: "connection" },
        el("div", { className: "conn-idea", textContent: c.idea.text }),
        el("div", { className: "conn-rel", textContent: c.relationship })
      );
      body.insertBefore(node, tail);
    },
    synthesis: (s) => {
      if (!s.text || !s.text.trim()) return;
      synthEl = synthesisCard(s.text);
      body.insertBefore(synthEl, tail);
    },
    done: () => {
      tail?.remove();
      tail = null;
      if (!count && !synthEl) {
        body.replaceChildren(
          el("p", { className: "panel-note" }, "No strong connections to your other ideas yet — park a few more and try again.")
        );
      }
    },
    failed: (d) => {
      tail?.remove();
      tail = null;
      if (!count && !synthEl) {
        body.replaceChildren(el("p", { className: "panel-note" }, d.message || "Something went wrong."));
      }
    },
  });
}

// ---- wiring --------------------------------------------------------------

$("#capture-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const ideaInput = $("#idea-input");
  const tagInput = $("#tag-input");
  const text = ideaInput.value.trim();
  if (!text) return;
  try {
    await api("/api/ideas", { method: "POST", body: { text, tags: parseTags(tagInput.value) } });
    ideaInput.value = "";
    tagInput.value = "";
    ideaInput.focus();
    // Reset filters that might hide the brand-new idea.
    if (state.status === "done" || state.status === "archived") setStatus("");
    state.tag = "";
    await refresh();
    toast("Parked");
  } catch (e) {
    toast(e.message, true);
  }
});

let searchTimer;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => {
    state.search = v;
    refresh();
  }, 180);
});

function setStatus(status) {
  state.status = status;
  for (const chip of document.querySelectorAll("#status-filters .chip")) {
    chip.classList.toggle("active", chip.dataset.status === status);
  }
}

$("#status-filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  setStatus(chip.dataset.status);
  refresh();
});

$("#sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  refresh();
});

// Export all ideas as a Markdown file.
$("#export-btn").addEventListener("click", async () => {
  try {
    const ideas = await api("/api/ideas");
    if (!ideas.length) return toast("Nothing to export yet");
    const groups = { active: [], done: [], archived: [] };
    for (const i of ideas) (groups[i.status] || groups.active).push(i);
    const section = (title, items) =>
      items.length
        ? `\n## ${title}\n\n` +
          items
            .map((i) => {
              const tags = i.tags.length ? `  _${i.tags.map((t) => "#" + t).join(" ")}_` : "";
              return `- ${i.text}${tags}`;
            })
            .join("\n") +
          "\n"
        : "";
    const md =
      `# Idea Parking Lot\n\n_Exported ${new Date().toLocaleString()} — ${ideas.length} ideas_\n` +
      section("Active", groups.active) +
      section("Done", groups.done) +
      section("Archived", groups.archived);

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "idea-parking-lot.md" });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Exported");
  } catch (e) {
    toast(e.message, true);
  }
});

// Quick-capture shortcut: "/" focuses the idea input from anywhere.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = document.activeElement?.tagName;
  const editing = document.activeElement?.isContentEditable;
  if (tag === "INPUT" || tag === "TEXTAREA" || editing) return;
  e.preventDefault();
  $("#idea-input").focus();
});

// Offline indicator.
function updateOnline() {
  $("#offline-banner").hidden = navigator.onLine;
}
window.addEventListener("online", updateOnline);
window.addEventListener("offline", updateOnline);
updateOnline();

$("#panel-close").addEventListener("click", closePanel);
$("#scrim").addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#panel").hidden) closePanel();
});

// ---- theme ---------------------------------------------------------------

const THEME_COLOR = { dark: "#0a0f1c", light: "#f4f6f9" };

// Inject the static SVG icons that live in index.html.
$("#brand-mark").append(icon("target"));
$("#search-ic").append(icon("search"));
$("#panel-close").append(icon("close"));
$("#export-btn").prepend(icon("download"));
$("#empty-ic")?.append(icon("sparkle"));
function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[theme];
  // Show the icon for the theme you'd switch TO.
  $("#theme-toggle").replaceChildren(icon(theme === "light" ? "moon" : "sun"));
}
$("#theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "light" ? "dark" : "light";
  localStorage.setItem("ipl-theme", next);
  applyTheme(next);
});
applyTheme(currentTheme());

// ---- boot ----------------------------------------------------------------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
}

(async () => {
  // Restore the saved view into the controls.
  $("#search").value = state.search;
  $("#sort").value = state.sort;
  setStatus(state.status);

  try {
    const cfg = await api("/api/config");
    state.aiEnabled = cfg.aiEnabled;
  } catch {
    /* non-fatal */
  }
  await refresh();
  $("#idea-input").focus();
})();
