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

const state = { search: "", status: "", tag: "", aiEnabled: false };

// ---- rendering -----------------------------------------------------------

function ideaCard(idea) {
  const text = el("div", { className: "idea-text", textContent: idea.text });

  // Inline edit on double-click.
  text.addEventListener("dblclick", () => {
    text.contentEditable = "true";
    text.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(text);
    sel.collapseToEnd();
  });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      text.blur();
    }
    if (e.key === "Escape") {
      text.textContent = idea.text;
      text.blur();
    }
  });
  text.addEventListener("blur", async () => {
    if (text.contentEditable !== "true") return;
    text.contentEditable = "false";
    const next = text.textContent.trim();
    if (next && next !== idea.text) {
      try {
        await api(`/api/ideas/${idea.id}`, { method: "PATCH", body: { text: next } });
        idea.text = next;
        toast("Saved");
      } catch (e) {
        text.textContent = idea.text;
        toast(e.message, true);
      }
    } else {
      text.textContent = idea.text;
    }
  });

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

  return el("div", { className: `idea status-${idea.status}` }, text, meta, actions);
}

async function refresh() {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.status) params.set("status", state.status);
  if (state.tag) params.set("tag", state.tag);

  const [ideas, tags] = await Promise.all([
    api("/api/ideas?" + params.toString()),
    api("/api/tags"),
  ]);

  const list = $("#ideas");
  list.replaceChildren(...ideas.map(ideaCard));
  $("#empty").hidden = ideas.length > 0;

  renderTagCloud(tags);
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
  if (!confirm("Delete this idea?")) return;
  try {
    await api(`/api/ideas/${idea.id}`, { method: "DELETE" });
    await refresh();
    toast("Deleted");
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
    body.replaceChildren(...branches.map((b) => suggestionCard(b)));
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

$("#panel-close").addEventListener("click", closePanel);
$("#scrim").addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#panel").hidden) closePanel();
});

// ---- boot ----------------------------------------------------------------

(async () => {
  try {
    const cfg = await api("/api/config");
    state.aiEnabled = cfg.aiEnabled;
  } catch {
    /* non-fatal */
  }
  await refresh();
  $("#idea-input").focus();
})();
