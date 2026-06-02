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
  layers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  promote: '<path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
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

// ---- SSE over fetch (supports GET and POST) ------------------------------
// handlers: { <eventName>: fn(payload), done: fn(payload), failed: fn(payload) }
// Returns an AbortController; call .abort() to cancel.
function streamFetch(url, { method = "GET", body, handlers = {} } = {}) {
  const ac = new AbortController();
  (async () => {
    let finished = false;
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        let msg = `Request failed (${res.status})`;
        try {
          msg = (await res.json()).error || msg;
        } catch {}
        finished = true;
        handlers.failed?.({ message: msg });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "message";
          let data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload = {};
          try {
            payload = JSON.parse(data);
          } catch {}
          if (event === "done") {
            finished = true;
            handlers.done?.(payload);
          } else if (event === "failed") {
            finished = true;
            handlers.failed?.(payload);
          } else {
            handlers[event]?.(payload);
          }
        }
      }
      if (!finished) handlers.done?.({});
    } catch (e) {
      if (ac.signal.aborted) return;
      handlers.failed?.({ message: e.message || "Connection lost." });
    }
  })();
  return ac;
}

// ---- minimal, safe Markdown renderer -------------------------------------
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function mdInline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return out;
}
function mdToHtml(md) {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let list = null; // 'ul' | 'ol'
  let para = [];
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${para.map(mdInline).join("<br>")}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      closeList();
      const lvl = m[1].length;
      html.push(`<h${lvl}>${mdInline(m[2])}</h${lvl}>`);
    } else if (/^(\s*)([-*])\s+/.test(line)) {
      flushPara();
      if (list !== "ul") {
        closeList();
        list = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${mdInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      if (list !== "ol") {
        closeList();
        list = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${mdInline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      closeList();
      html.push(`<blockquote>${mdInline(m[1])}</blockquote>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      closeList();
      html.push("<hr>");
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return html.join("\n");
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

const expanded = new Set(); // idea ids whose branches are shown

function ideaCard(idea, depth = 0) {
  const card = el("div", { className: `idea status-${idea.status}${depth ? " child" : ""}` });

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

  const work = el("button", { className: "work-btn", title: "Open the workspace: develop, plan, spec & chat" }, icon("layers"), "Work on");
  work.addEventListener("click", () => gotoWorkspace(idea.id));
  actions.append(work);

  if (state.aiEnabled) {
    actions.append(
      iconBtn("sparkle", "Branch into developed ideas", () => openBranch(idea), "accent"),
      iconBtn("link", "Find connections to other ideas", () => openConnect(idea), "accent")
    );
  }

  actions.append(el("div", { className: "spacer" }));

  actions.append(
    iconBtn("edit", "Edit text & tags", () => enterEdit(idea, card)),
    idea.status === "done"
      ? iconBtn("undo", "Mark active", () => patchStatus(idea, "active"))
      : iconBtn("check", "Mark done", () => patchStatus(idea, "done")),
    idea.status === "archived"
      ? iconBtn("unarchive", "Unarchive", () => patchStatus(idea, "active"))
      : iconBtn("archive", "Archive", () => patchStatus(idea, "archived"))
  );
  if (idea.parentId != null) {
    actions.append(iconBtn("promote", "Make a separate idea", () => makeSeparate(idea)));
  }
  actions.append(iconBtn("trash", "Delete", () => removeIdea(idea), "danger"));

  const meta = el(
    "div",
    { className: "idea-meta" },
    tags,
    el("span", { className: "created", textContent: timeAgo(idea.createdAt) })
  );

  card.append(text, meta, actions);

  // Nested branches.
  if (idea.children && idea.children.length) {
    const n = idea.children.length;
    const childWrap = el("div", { className: "branch-children" });
    const renderChildren = () => childWrap.replaceChildren(...idea.children.map((c) => ideaCard(c, depth + 1)));
    const toggle = el(
      "button",
      { className: "branch-toggle" },
      icon("layers"),
      el("span", { textContent: `${n} branch${n === 1 ? "" : "es"}` }),
      icon("chevron")
    );
    const setOpen = (open) => {
      toggle.classList.toggle("open", open);
      if (open) {
        expanded.add(idea.id);
        renderChildren();
      } else {
        expanded.delete(idea.id);
        childWrap.replaceChildren();
      }
    };
    toggle.addEventListener("click", () => setOpen(!expanded.has(idea.id)));
    card.append(toggle, childWrap);
    if (expanded.has(idea.id)) setOpen(true);
  }

  return card;
}

async function makeSeparate(idea) {
  try {
    await api(`/api/ideas/${idea.id}`, { method: "PATCH", body: { parentId: null } });
    toast("Now a separate idea");
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
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

function skeletonCard() {
  return el(
    "div",
    { className: "idea skeleton" },
    el("div", { className: "sk-line sk-title" }),
    el("div", { className: "sk-line sk-short" }),
    el("div", { className: "sk-row" }, el("span", { className: "sk-pill" }), el("span", { className: "sk-pill" }), el("span", { className: "sk-spacer" }))
  );
}

async function refresh() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  if (state.tag) params.set("tag", state.tag);
  if (state.sort) params.set("sort", state.sort);

  // Show skeletons while loading if there's no real content yet (first load /
  // empty list) — avoids flicker on incremental filter/search refreshes.
  const list = $("#ideas");
  if (!list.querySelector(".idea:not(.skeleton)")) {
    list.replaceChildren(...Array.from({ length: 4 }, skeletonCard));
    $("#empty").hidden = true;
  }

  let ideas, tags, stats;
  try {
    [ideas, tags, stats] = await Promise.all([
      api("/api/ideas?" + params.toString()),
      api("/api/tags"),
      api("/api/stats"),
    ]);
  } catch (e) {
    list.replaceChildren(el("p", { className: "empty" }, e.message || "Couldn't load ideas."));
    return;
  }

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

let currentStream = null; // AbortController for the side panel

function closePanel() {
  if (currentStream) {
    currentStream.abort();
    currentStream = null;
  }
  $("#panel").hidden = true;
  $("#panel").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

function streamPanel(url, handlers) {
  if (currentStream) currentStream.abort();
  currentStream = streamFetch(url, { handlers });
}

function streamingTail(label) {
  return el("div", { className: "loader stream-tail" }, el("div", { className: "spinner" }), label);
}

// Build a Markdown detail body from a rich branch object.
function branchMarkdown(b) {
  const parts = [];
  if (b.concept) parts.push(`## Concept\n\n${b.concept}`);
  if (b.targetUsers) parts.push(`**Target users:** ${b.targetUsers}`);
  if (b.coreFeatures?.length)
    parts.push(`### Core features\n\n${b.coreFeatures.map((f) => `- ${f}`).join("\n")}`);
  if (b.workflow) parts.push(`### Workflow\n\n${b.workflow}`);
  if (b.technical) parts.push(`### Technical considerations\n\n${b.technical}`);
  if (b.businessValue) parts.push(`### Business value\n\n${b.businessValue}`);
  if (b.challenges) parts.push(`### Challenges\n\n${b.challenges}`);
  if (b.expansion) parts.push(`### Expansion opportunities\n\n${b.expansion}`);
  return parts.join("\n\n");
}

function openBranch(idea) {
  openPanel("Branch ideas", `From “${idea.text}”`);
  const body = $("#panel-body");
  const cards = [];
  let tail = null;

  const saveAllBtn = el("button", { className: "ghost-btn" }, icon("plus"), "Save all as branches");
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
        tail = streamingTail("developing branches…");
        body.replaceChildren(row, tail);
      }
      const card = suggestionCard(b, idea.id);
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

function field(label, value) {
  if (!value) return null;
  return el("div", { className: "bf" }, el("dt", { textContent: label }), el("dd", { textContent: value }));
}

function suggestionCard(b, sourceId) {
  const addBtn = el("button", { className: "add-btn" }, icon("plus"), "Save branch");
  addBtn.addEventListener("click", async () => {
    if (addBtn.classList.contains("added")) return;
    try {
      await api("/api/ideas", {
        method: "POST",
        body: { text: b.title, tags: b.tags || [], detail: branchMarkdown(b), parentId: sourceId },
      });
      addBtn.classList.add("added");
      addBtn.replaceChildren(document.createTextNode("Saved as branch"));
      refresh();
    } catch (e) {
      toast(e.message, true);
    }
  });

  const dl = el("dl", { className: "branch-fields" });
  const feat = b.coreFeatures?.length
    ? el("div", { className: "bf" }, el("dt", { textContent: "Core features" }),
        el("dd", {}, el("ul", {}, ...b.coreFeatures.map((f) => el("li", { textContent: f })))))
    : null;
  for (const node of [
    field("Target users", b.targetUsers),
    feat,
    field("Workflow", b.workflow),
    field("Technical", b.technical),
    field("Business value", b.businessValue),
    field("Challenges", b.challenges),
    field("Expansion", b.expansion),
  ]) {
    if (node) dl.append(node);
  }

  return el(
    "div",
    { className: "suggestion" },
    el("h3", { textContent: b.title }),
    el("p", { className: "concept", textContent: b.concept }),
    dl,
    el(
      "div",
      { className: "sug-foot" },
      el("div", { className: "sug-tags" }, ...(b.tags || []).map((t) => el("span", { className: "t", textContent: "#" + t }))),
      addBtn
    )
  );
}

function synthesisCard(text) {
  const addBtn = el("button", { className: "add-btn" }, icon("plus"), "Save as idea");
  addBtn.addEventListener("click", async () => {
    if (addBtn.classList.contains("added")) return;
    try {
      await api("/api/ideas", { method: "POST", body: { text, tags: ["synthesis"] } });
      addBtn.classList.add("added");
      addBtn.replaceChildren(document.createTextNode("Saved"));
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
  openPanel("Connections", `For “${idea.text}”`);
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

// ---- Work on Idea: workspace ---------------------------------------------

let wsStream = null; // AbortController for the active workspace stream
let wsIdea = null;
let wsData = { messages: [], artifacts: [], kinds: [], aiEnabled: false };
let wsView = "chat"; // "chat" | "streaming" | <artifactId>

// ---- routing (/idea/:id) ----
function parseRoute() {
  const m = location.pathname.match(/^\/idea\/(\d+)\/?$/);
  return m ? Number(m[1]) : null;
}
function gotoWorkspace(id) {
  history.pushState({}, "", `/idea/${id}`);
  handleRoute();
}
function leaveWorkspace() {
  if (parseRoute() != null) {
    if (history.length > 1) history.back();
    else {
      history.pushState({}, "", "/");
      handleRoute();
    }
  } else {
    hideWorkspace();
  }
}
function handleRoute() {
  const id = parseRoute();
  if (id != null) {
    if ($("#ws").hidden || !wsIdea || wsIdea.id !== id) openWorkspace(id);
  } else if (!$("#ws").hidden) {
    hideWorkspace();
  }
}

async function openWorkspace(ideaId) {
  $("#ws").hidden = false;
  $("#ws").setAttribute("aria-hidden", "false");
  document.body.classList.add("ws-open");
  $("#ws-loading").hidden = false;
  $("#ws-idea-title").textContent = "";
  $("#ws-detail").hidden = true;
  $("#ws-actions").replaceChildren();
  $("#ws-doc-list").replaceChildren();
  $("#ws-view").replaceChildren();
  try {
    const data = await api(`/api/ideas/${ideaId}/workspace`);
    wsIdea = data.idea;
    wsData = { messages: data.messages, artifacts: data.artifacts, kinds: data.kinds, aiEnabled: data.aiEnabled };
    $("#ws-idea-title").textContent = wsIdea.text;
    const det = $("#ws-detail");
    if (wsIdea.detail) {
      det.innerHTML = mdToHtml(wsIdea.detail);
      det.hidden = false;
    } else {
      det.hidden = true;
    }
    $("#ws-chat-input").disabled = !wsData.aiEnabled;
    $("#ws-chat-input").placeholder = wsData.aiEnabled
      ? "Ask about this idea, or say how to develop it…"
      : "Set FIREWORKS_API_KEY to chat";
    renderWsActions();
    renderDocList();
    setViewChat();
  } catch (e) {
    toast(e.message, true);
    leaveWorkspace();
  } finally {
    $("#ws-loading").hidden = true;
  }
}

function hideWorkspace() {
  if (wsStream) {
    wsStream.abort();
    wsStream = null;
  }
  wsIdea = null;
  $("#ws").hidden = true;
  $("#ws").setAttribute("aria-hidden", "true");
  document.body.classList.remove("ws-open");
}

function renderWsActions() {
  const wrap = $("#ws-actions");
  wrap.replaceChildren(el("div", { className: "ws-actions-label", textContent: "Generate" }));
  for (const k of wsData.kinds) {
    const b = el("button", { className: "ws-gen-btn" }, icon("doc"), el("span", { textContent: k.title }));
    b.disabled = !wsData.aiEnabled;
    b.addEventListener("click", () => generateArtifact(k.kind, k.title));
    wrap.append(b);
  }
  if (!wsData.aiEnabled) {
    wrap.append(el("p", { className: "ws-note", textContent: "Set FIREWORKS_API_KEY to enable generation & chat." }));
  }
}

function renderDocList() {
  const list = $("#ws-doc-list");
  if (!wsData.artifacts.length) {
    list.replaceChildren(el("p", { className: "ws-empty", textContent: "No documents yet." }));
    return;
  }
  list.replaceChildren(
    ...wsData.artifacts.map((a) => {
      const open = el(
        "button",
        { className: "ws-doc" + (wsView === a.id ? " active" : "") },
        icon("doc"),
        el("span", { className: "ws-doc-title", textContent: a.title }),
        el("span", { className: "ws-doc-date", textContent: timeAgo(a.createdAt) })
      );
      open.addEventListener("click", () => viewDoc(a.id));
      const del = iconBtn(
        "trash",
        "Delete document",
        async () => {
          try {
            await api(`/api/ideas/${wsIdea.id}/artifacts/${a.id}`, { method: "DELETE" });
            wsData.artifacts = wsData.artifacts.filter((x) => x.id !== a.id);
            if (wsView === a.id) setViewChat();
            renderDocList();
          } catch (e) {
            toast(e.message, true);
          }
        },
        "danger"
      );
      return el("div", { className: "ws-doc-row" }, open, del);
    })
  );
}

function msgBubble(role, content) {
  const bub = el("div", { className: `ws-msg ${role}` });
  if (role === "assistant") bub.innerHTML = mdToHtml(content);
  else bub.textContent = content;
  return el("div", { className: `ws-msg-row ${role}` }, bub);
}

function setViewChat() {
  wsView = "chat";
  const view = $("#ws-view");
  view.className = "ws-view chat";
  const nodes = wsData.messages.map((m) => msgBubble(m.role, m.content));
  if (!nodes.length) {
    nodes.push(
      el(
        "div",
        { className: "ws-hello" },
        el("div", { className: "ws-hello-ic" }, icon("layers")),
        el("h3", { textContent: "Develop this idea" }),
        el("p", {
          textContent:
            "Ask anything about it, or use the panel on the left to generate a plan, spec, business case, MVP scope and more. Everything you create stays saved here.",
        })
      )
    );
  }
  view.replaceChildren(...nodes);
  view.scrollTop = view.scrollHeight;
  renderDocList();
}

function viewDoc(id) {
  const a = wsData.artifacts.find((x) => x.id === id);
  if (!a) return;
  wsView = id;
  const view = $("#ws-view");
  view.className = "ws-view doc";
  const back = el("button", { className: "ws-back" }, "← Conversation");
  back.addEventListener("click", setViewChat);
  const doc = el("div", { className: "ws-doc-view" });
  doc.innerHTML = mdToHtml(a.content);
  view.replaceChildren(el("div", { className: "ws-doc-head" }, el("h3", { textContent: a.title }), back), doc);
  view.scrollTop = 0;
  renderDocList();
}

function typingDots() {
  return el("div", { className: "typing" }, el("span"), el("span"), el("span"));
}

function generateArtifact(kind, title) {
  if (!wsData.aiEnabled) return;
  wsView = "streaming";
  const view = $("#ws-view");
  view.className = "ws-view doc";
  const head = el("div", { className: "ws-doc-head" }, el("h3", { textContent: title }));
  const loading = el(
    "div",
    { className: "ws-doc-loading" },
    el("span", { className: "spinner" }),
    `Generating ${title.toLowerCase()}…`
  );
  const docWrap = el("div", { className: "ws-doc-view" });
  const pre = el("pre", { className: "ws-stream" });
  pre.hidden = true;
  docWrap.append(pre);
  view.replaceChildren(head, loading, docWrap);
  renderDocList();

  let buf = "";
  let started = false;
  if (wsStream) wsStream.abort();
  wsStream = streamFetch(`/api/ideas/${wsIdea.id}/artifacts`, {
    method: "POST",
    body: { kind },
    handlers: {
      token: (d) => {
        if (!started) {
          started = true;
          loading.remove();
          pre.hidden = false;
        }
        buf += d.text;
        pre.textContent = buf;
        view.scrollTop = view.scrollHeight;
      },
      done: (d) => {
        wsStream = null;
        if (d.artifact) {
          wsData.artifacts.unshift(d.artifact);
          viewDoc(d.artifact.id);
        }
      },
      failed: (d) => {
        wsStream = null;
        loading.remove();
        pre.hidden = false;
        pre.replaceChildren(el("p", { className: "ws-empty", textContent: d.message || "Generation failed." }));
      },
    },
  });
}

function sendChat(message) {
  if (!wsData.aiEnabled) return toast("AI is not configured", true);
  setViewChat();
  const view = $("#ws-view");
  // Remove the hello placeholder if present.
  if (view.querySelector(".ws-hello")) view.replaceChildren();
  view.append(msgBubble("user", message));
  const aBub = el("div", { className: "ws-msg assistant" }, typingDots());
  const aRow = el("div", { className: "ws-msg-row assistant" }, aBub);
  view.append(aRow);
  view.scrollTop = view.scrollHeight;

  let buf = "";
  let started = false;
  if (wsStream) wsStream.abort();
  wsStream = streamFetch(`/api/ideas/${wsIdea.id}/chat`, {
    method: "POST",
    body: { message },
    handlers: {
      user: (m) => wsData.messages.push(m),
      token: (d) => {
        if (!started) {
          started = true;
          aBub.replaceChildren();
        }
        buf += d.text;
        aBub.textContent = buf;
        view.scrollTop = view.scrollHeight;
      },
      done: (d) => {
        wsStream = null;
        aBub.innerHTML = mdToHtml(buf || "_(no response)_");
        if (d.message) wsData.messages.push(d.message);
        view.scrollTop = view.scrollHeight;
      },
      failed: (d) => {
        wsStream = null;
        aBub.classList.add("err");
        aBub.textContent = d.message || "Something went wrong.";
      },
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

$("#ws-close").addEventListener("click", leaveWorkspace);
$("#ws-chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#ws-chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  sendChat(msg);
});
window.addEventListener("popstate", handleRoute);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#ws").hidden) leaveWorkspace();
  else if (!$("#panel").hidden) closePanel();
});

// ---- theme ---------------------------------------------------------------

const THEME_COLOR = { dark: "#0a0f1c", light: "#f4f6f9" };

// Inject the static SVG icons that live in index.html.
$("#brand-mark").append(icon("target"));
$("#search-ic").append(icon("search"));
$("#panel-close").append(icon("close"));
$("#ws-close").append(icon("close"));
$("#ws-chat-form button[type=submit]").append(icon("send"));
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
  // When a new service worker takes control (after a deploy), reload once so the
  // page picks up the fresh assets. Only for returning visitors that already had
  // a controller — avoids a needless reload on first visit.
  if (navigator.serviceWorker.controller) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
}

(async () => {
  // Safety net: ensure the AI panel/scrim/workspace start hidden.
  $("#panel").hidden = true;
  $("#panel").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
  $("#ws").hidden = true;
  $("#ws").setAttribute("aria-hidden", "true");

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
  handleRoute(); // open the workspace if the URL points at one
  if ($("#ws").hidden) $("#idea-input").focus();
})();
