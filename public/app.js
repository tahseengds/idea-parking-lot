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
      el("button", {
        className: "icon-btn spark",
        innerHTML: "✦ Branch",
        title: "Branch off related ideas",
        onclick: () => openBranch(idea),
      }),
      el("button", {
        className: "icon-btn link",
        innerHTML: "⇄ Connect",
        title: "Find connections to other ideas",
        onclick: () => openConnect(idea),
      })
    );
  }

  actions.append(
    el("button", {
      className: "icon-btn",
      innerHTML: "✎",
      title: "Edit text & tags",
      onclick: () => enterEdit(idea, card),
    }),
    el("button", {
      className: "icon-btn",
      innerHTML: idea.status === "done" ? "↺" : "✓",
      title: idea.status === "done" ? "Mark active" : "Mark done",
      onclick: () => patchStatus(idea, idea.status === "done" ? "active" : "done"),
    }),
    el("button", {
      className: "icon-btn",
      innerHTML: idea.status === "archived" ? "⇪" : "⇩",
      title: idea.status === "archived" ? "Unarchive" : "Archive",
      onclick: () => patchStatus(idea, idea.status === "archived" ? "active" : "archived"),
    }),
    el("button", {
      className: "icon-btn danger",
      innerHTML: "🗑",
      title: "Delete",
      onclick: () => removeIdea(idea),
    })
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

function closePanel() {
  $("#panel").hidden = true;
  $("#panel").setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
}

async function openBranch(idea) {
  openPanel("Branches", `“${idea.text}”`);
  try {
    const { branches } = await api(`/api/ideas/${idea.id}/branch`, { method: "POST" });
    const body = $("#panel-body");
    if (!branches.length) {
      body.replaceChildren(el("p", { className: "panel-note" }, "No branches came back. Try again."));
      return;
    }

    const cards = branches.map((b) => suggestionCard(b));
    const saveAllBtn = el("button", { textContent: "+ Save all" });
    saveAllBtn.addEventListener("click", async () => {
      saveAllBtn.disabled = true;
      let saved = 0;
      for (const card of cards) {
        const btn = card.querySelector(".add-btn");
        if (btn && !btn.classList.contains("added")) {
          btn.click();
          saved++;
        }
      }
      saveAllBtn.textContent = saved ? `Saved ${saved} ✓` : "All saved";
    });
    const row = el("div", { className: "save-all-row" }, saveAllBtn);
    body.replaceChildren(row, ...cards);
  } catch (e) {
    $("#panel-body").replaceChildren(el("p", { className: "panel-note" }, e.message));
  }
}

function suggestionCard(b) {
  const addBtn = el("button", { className: "add-btn", textContent: "+ Save" });
  addBtn.addEventListener("click", async () => {
    if (addBtn.classList.contains("added")) return;
    try {
      await api("/api/ideas", { method: "POST", body: { text: b.title, tags: b.tags || [] } });
      addBtn.classList.add("added");
      addBtn.textContent = "Saved ✓";
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

async function openConnect(idea) {
  openPanel("Connections", `“${idea.text}”`);
  try {
    const { connections, synthesis } = await api(`/api/ideas/${idea.id}/connect`, { method: "POST" });
    const body = $("#panel-body");
    const nodes = [];

    if (!connections.length) {
      nodes.push(
        el("p", { className: "panel-note" }, "No strong connections to your other ideas yet — park a few more and try again.")
      );
    } else {
      for (const c of connections) {
        nodes.push(
          el(
            "div",
            { className: "connection" },
            el("div", { className: "conn-idea", textContent: c.idea.text }),
            el("div", { className: "conn-rel", textContent: c.relationship })
          )
        );
      }
    }

    if (synthesis && synthesis.trim()) {
      const addBtn = el("button", { className: "add-btn", textContent: "+ Save this" });
      addBtn.addEventListener("click", async () => {
        if (addBtn.classList.contains("added")) return;
        try {
          await api("/api/ideas", { method: "POST", body: { text: synthesis, tags: ["synthesis"] } });
          addBtn.classList.add("added");
          addBtn.textContent = "Saved ✓";
          refresh();
        } catch (e) {
          toast(e.message, true);
        }
      });
      nodes.push(
        el(
          "div",
          { className: "synthesis" },
          el("div", { className: "label" }, "Synthesis"),
          el("p", { textContent: synthesis }),
          addBtn
        )
      );
    }

    body.replaceChildren(...nodes);
  } catch (e) {
    $("#panel-body").replaceChildren(el("p", { className: "panel-note" }, e.message));
  }
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
