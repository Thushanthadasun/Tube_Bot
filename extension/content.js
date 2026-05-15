// TubeChat AI — Content Script
"use strict";

const API = "https://31d5fd0a-6834-4430-aba4-ec9b9880dc47-00-39s15ceewthwo.janeway.replit.dev/api";
const VER = "5"; // bump this to wipe stored data on next install

// ── State ────────────────────────────────────────────────────────────────────
let prefs = {
  blockedCategories: [],
  blockedKeywords: [],
  blockedChannels: [],
  preferredCategories: [],
  interests: [],         // [{ label: string, searchQuery: string }] — pinned explicit
  recentSearches: [],    // string[] — YouTube search bar history (tracked live)
};
let msgs  = [];
let panelOpen = false;
let chatBusy  = false;

const safeIds    = new Set(); // confirmed safe — visible
const blockedIds = new Set(); // confirmed blocked — hidden
const pendingIds = new Set(); // waiting for API response
let   batchTimer = null;

// ── Storage ──────────────────────────────────────────────────────────────────
const sGet = k     => new Promise(r => chrome.storage.local.get(k, d => r(d[k])));
const sSet = (k,v) => new Promise(r => chrome.storage.local.set({ [k]: v }, r));

async function boot() {
  // Version check — if outdated, wipe everything and start fresh
  if (await sGet("ver") !== VER) {
    await new Promise(r => chrome.storage.local.clear(r));
    await sSet("ver", VER);
  } else {
    const sp = await sGet("p"); if (sp) prefs = sp;
    const sm = await sGet("m"); if (Array.isArray(sm)) msgs = sm;
  }

  buildUI();
  if (document.body) startWatching();
  else document.addEventListener("DOMContentLoaded", startWatching);

  // Inject interest videos on homepage
  if (location.pathname === "/" || location.pathname === "") {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(injectInterests, 2000);
    } else {
      document.addEventListener("DOMContentLoaded", () => setTimeout(injectInterests, 2000));
    }
  }
}

async function savePrefs(p, syncBackend = true) {
  prefs = p;
  await sSet("p", p);
  if (syncBackend) {
    const { preferredCategories, ...bp } = p;
    fetch(`${API}/youtube/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bp),
    }).catch(() => {});
  }
  resetAndReclassify();
}

// Cross-tab sync
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && ch.p) {
    const np = ch.p.newValue;
    if (np && JSON.stringify(np) !== JSON.stringify(prefs)) {
      prefs = np;
      resetAndReclassify();
    }
  }
});

function resetAndReclassify() {
  safeIds.clear();
  blockedIds.clear();
  pendingIds.clear();
  clearTimeout(batchTimer);
  // Restore all hidden elements and re-process
  document.querySelectorAll("[data-tc]").forEach(el => {
    el.style.removeProperty("display");
    delete el.dataset.tc;
  });
  scan();
}

// ── DOM Scanning ─────────────────────────────────────────────────────────────

const CARD_SEL = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-grid-video-renderer",
].join(", ");

function isFilterActive() {
  return prefs.blockedCategories.length > 0
      || prefs.blockedKeywords.length > 0
      || prefs.blockedChannels.length > 0
      || prefs.preferredCategories.length > 0;
}

function blockingShorts() {
  return prefs.blockedCategories.some(c => /\bshorts?\b/i.test(c));
}

function getVid(el) {
  const a = el.querySelector("a#thumbnail, a[href*='/watch']");
  const m = a?.href?.match(/[?&]v=([^&]+)/);
  return m?.[1] ?? null;
}
function getTitle(el) {
  return (el.querySelector("#video-title, #video-title-link, h3 a")?.textContent ?? "").trim();
}
function getChannel(el) {
  return (el.querySelector("ytd-channel-name #text, #channel-name #text, a.yt-simple-endpoint[href^='/@']")?.textContent ?? "").trim();
}

// Instant local patterns — only very high-confidence rules
const MUSIC_CH = [/-\s*topic$/i, /vevo/i, / music$/i, /musicvevo$/i, / records?$/i];
const MUSIC_TI = [
  /\bofficial music video\b/i, /\bofficial audio\b/i, /\blyric(s)? video\b/i,
  /\bmusic video\b/i, /\b\(ft\.?\s/i, /\bfeat\.\s/i,
  /\bofficial (mv|video)\b/i, /\b(cover|remix|karaoke|acoustic)\b/i,
  /\blo-?fi\b/i, /\bvisualizer\b/i, /\ba cappella\b/i,
];

function fastBlocked(title, channel) {
  const t = title.toLowerCase();
  const c = channel.toLowerCase();

  // Explicit keyword block
  for (const kw of prefs.blockedKeywords) {
    if (t.includes(kw.toLowerCase())) return true;
  }
  // Explicit channel block
  for (const ch of prefs.blockedChannels) {
    if (c.includes(ch.toLowerCase())) return true;
  }
  // Music fast patterns
  if (prefs.blockedCategories.some(x => /\bmusic\b/i.test(x))) {
    if (MUSIC_CH.some(p => p.test(channel))) return true;
    if (MUSIC_TI.some(p => p.test(title)))   return true;
  }
  return false;
}

function hideEl(el) {
  el.style.setProperty("display", "none", "important");
  el.dataset.tc = "h";
}

function showEl(el) {
  el.style.removeProperty("display");
  el.dataset.tc = "s";
}

function scan() {
  if (!isFilterActive()) return;

  // Shorts elements
  if (blockingShorts()) {
    document.querySelectorAll(
      "ytd-reel-shelf-renderer, ytd-rich-section-renderer:has(ytd-reel-shelf-renderer), " +
      "ytd-reel-item-renderer, ytd-reel-video-renderer"
    ).forEach(el => { if (el.dataset.tc !== "h") hideEl(el); });

    document.querySelectorAll("a[href*='/shorts/']").forEach(a => {
      const p = a.closest("ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer");
      if (p && p.dataset.tc !== "h") hideEl(p);
    });
  }

  document.querySelectorAll(CARD_SEL).forEach(el => {
    if (el.dataset.tc) return; // already processed

    const vid = getVid(el);
    if (!vid) return;

    // Already classified
    if (blockedIds.has(vid)) { hideEl(el); return; }
    if (safeIds.has(vid))    { showEl(el); return; }

    // Fast local check
    if (fastBlocked(getTitle(el), getChannel(el))) {
      hideEl(el);
      blockedIds.add(vid);
      return;
    }

    // *** KEY: hide immediately and queue for API ***
    // Nothing goes to the API "unblocked" — everything is hidden first.
    hideEl(el);
    el.dataset.tcVid = vid;
    if (!pendingIds.has(vid)) {
      pendingIds.add(vid);
    }
  });

  if (pendingIds.size > 0) {
    clearTimeout(batchTimer);
    batchTimer = setTimeout(callAPI, 400);
  }
}

async function callAPI() {
  if (pendingIds.size === 0) return;
  const ids = [...pendingIds].slice(0, 25);
  pendingIds.clear();

  let data = null;
  try {
    const res = await fetch(`${API}/youtube/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoIds: ids,
        preferences: {
          blockedCategories: prefs.blockedCategories,
          blockedKeywords:   prefs.blockedKeywords,
          blockedChannels:   prefs.blockedChannels,
        },
        preferredCategories: prefs.preferredCategories,
      }),
    });
    if (res.ok) data = await res.json();
  } catch (_) {}

  const shouldBlock = new Set(data?.blockedVideoIds ?? []);
  const notPref     = new Set(data?.notPreferredVideoIds ?? []);
  const hasPrefs    = prefs.preferredCategories.length > 0;

  ids.forEach(vid => {
    const block = shouldBlock.has(vid) || (hasPrefs && notPref.has(vid));
    if (block) {
      blockedIds.add(vid);
      // ensure hidden (may have been re-rendered)
      document.querySelectorAll(`[data-tc-vid="${vid}"]`).forEach(hideEl);
    } else {
      safeIds.add(vid);
      // reveal
      document.querySelectorAll(`[data-tc-vid="${vid}"]`).forEach(el => {
        showEl(el);
        delete el.dataset.tcVid;
      });
    }
  });

  // API failed → reveal everything so page isn't blank
  if (!data) {
    ids.forEach(vid => {
      safeIds.add(vid);
      document.querySelectorAll(`[data-tc-vid="${vid}"]`).forEach(el => {
        showEl(el);
        delete el.dataset.tcVid;
      });
    });
  }

  if (pendingIds.size > 0) {
    batchTimer = setTimeout(callAPI, 400);
  }
}

// ── Page Watcher ─────────────────────────────────────────────────────────────

function startWatching() {
  scan();
  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });

  // SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    safeIds.clear();
    blockedIds.clear();
    pendingIds.clear();
    // Clear processed markers so everything gets re-evaluated
    document.querySelectorAll("[data-tc]").forEach(el => {
      el.style.removeProperty("display");
      delete el.dataset.tc;
    });
    [1200, 2500, 4500].forEach(d => setTimeout(scan, d));

    // Re-inject interests when navigating to homepage
    if (location.pathname === "/" || location.pathname === "") {
      document.getElementById("tc-int-bar")?.remove();
      setTimeout(injectInterests, 2000);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// ── Chat UI ──────────────────────────────────────────────────────────────────

function buildUI() {
  if (document.getElementById("tc-btn")) return;

  // Toggle button
  const btn = document.createElement("button");
  btn.id = "tc-btn";
  btn.title = "TubeChat AI";
  btn.innerHTML = `<svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="15" cy="15" r="15" fill="#FF0000"/>
    <path d="M15 7.5 L16.8 12.7 L22.2 14.5 L16.8 16.3 L15 21.5 L13.2 16.3 L7.8 14.5 L13.2 12.7 Z" fill="white"/>
  </svg>`;
  document.body.appendChild(btn);

  // Panel
  const panel = document.createElement("div");
  panel.id = "tc-panel";
  panel.innerHTML = `
    <div id="tc-head">
      <div id="tc-head-title">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#FF0000"/><path d="M7 3.5l.8 2.4 2.4.8-2.4.8L7 9.9l-.8-2.4L3.8 6.7l2.4-.8z" fill="white"/></svg>
        TubeChat AI
      </div>
      <button id="tc-x" title="Close">✕</button>
    </div>
    <div id="tc-msgs"></div>
    <div id="tc-bottom">
      <input id="tc-in" placeholder="block music, hide gaming…" autocomplete="off"/>
      <button id="tc-go">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
      </button>
    </div>`;
  document.body.appendChild(panel);

  btn.onclick = () => {
    panelOpen = !panelOpen;
    panel.classList.toggle("tc-open", panelOpen);
    if (panelOpen) { renderAll(); document.getElementById("tc-in")?.focus(); }
  };

  document.getElementById("tc-x").onclick = () => {
    panelOpen = false; panel.classList.remove("tc-open");
  };

  const inp = document.getElementById("tc-in");
  inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(inp.value); } });
  document.getElementById("tc-go").onclick = () => doSend(inp.value);
}

function renderAll() {
  const box = document.getElementById("tc-msgs");
  if (!box) return;
  box.innerHTML = "";
  if (msgs.length === 0) {
    box.innerHTML = `<div class="tc-row ai"><div class="tc-bub">
      Hi! I'm TubeChat — I hide content you don't want on YouTube.<br><br>
      Try saying:<br>
      <span class="tc-ex">• block music</span>
      <span class="tc-ex">• hide gaming videos</span>
      <span class="tc-ex">• no more shorts</span>
      <span class="tc-ex">• show only tech</span>
    </div></div>`;
    return;
  }
  msgs.forEach(m => bubbleDOM(m.role, m.content));
  box.scrollTop = 9999;
}

function cleanText(t) {
  return (t || "")
    .split("\n")
    .filter(l => !(l.trim().startsWith("{") && l.includes('"action"')))
    .join("\n")
    .trim()
    .replace(/\n/g, "<br>");
}

function bubbleDOM(role, text) {
  const box = document.getElementById("tc-msgs");
  if (!box) return null;
  const d = document.createElement("div");
  d.className = `tc-row ${role === "user" ? "user" : "ai"}`;
  d.innerHTML = `<div class="tc-bub">${cleanText(text)}</div>`;
  box.appendChild(d);
  box.scrollTop = 9999;
  return d;
}

function showDots() {
  const box = document.getElementById("tc-msgs");
  if (!box || document.getElementById("tc-dots")) return;
  const d = document.createElement("div");
  d.id = "tc-dots"; d.className = "tc-row ai";
  d.innerHTML = `<div class="tc-bub"><span class="tc-pulse"><span></span><span></span><span></span></span></div>`;
  box.appendChild(d); box.scrollTop = 9999;
}
function hideDots() { document.getElementById("tc-dots")?.remove(); }

async function doSend(text) {
  text = text?.trim();
  if (!text || chatBusy) return;
  document.getElementById("tc-in").value = "";
  chatBusy = true;

  const userMsg = { role: "user", content: text };
  msgs.push(userMsg);
  bubbleDOM("user", text);
  showDots();

  try {
    const history = msgs.slice(0, -1).map(m => ({ role: m.role, content: (m.content||"").trim() }));
    const res = await fetch(`${API}/youtube/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history }),
    });
    if (!res.ok) throw new Error("server error");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf  = "", full = "";
    let prefUpdate = null, vidResults = null, setPreferred = null, clearPreferred = false, showPrefsData = null;

    hideDots();
    const aiMsg = { role: "assistant", content: "" };
    msgs.push(aiMsg);
    const aRow = bubbleDOM("assistant", "");
    const aBub = aRow?.querySelector(".tc-bub");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "text" && ev.content) {
            full += ev.content;
            aiMsg.content = full;
            if (aBub) aBub.innerHTML = cleanText(full);
            document.getElementById("tc-msgs").scrollTop = 9999;
          }
          if (ev.type === "preference_update") prefUpdate    = ev.preferences;
          if (ev.type === "videos")            vidResults    = ev.videos;
          if (ev.type === "show_preferences")  showPrefsData = ev.preferences;
          if (ev.type === "set_preferred")     setPreferred  = ev.preferredCategories;
          if (ev.type === "clear_preferred")   clearPreferred = true;

          // Interest events
          if (ev.type === "set_interests" && ev.interests?.length) {
            const np = { ...prefs, interests: [...new Set([...(prefs.interests||[]), ...ev.interests])] };
            await savePrefs(np);
            document.getElementById("tc-int-bar")?.remove();
            injectInterests();
          }
          if (ev.type === "remove_interest" && ev.interest) {
            const np = { ...prefs, interests: (prefs.interests||[]).filter(i => i !== ev.interest) };
            await savePrefs(np);
            document.getElementById("tc-int-bar")?.remove();
            injectInterests();
          }
          if (ev.type === "clear_interests") {
            const np = { ...prefs, interests: [] };
            await savePrefs(np);
            document.getElementById("tc-int-bar")?.remove();
          }

          if (ev.done) {
            if (prefUpdate)    await savePrefs({ ...prefs, ...prefUpdate, preferredCategories: prefs.preferredCategories ?? [] }, false);
            if (setPreferred)  await savePrefs({ ...prefs, preferredCategories: setPreferred });
            if (clearPreferred) await savePrefs({ ...prefs, preferredCategories: [] });
            if (showPrefsData) displayFilters(showPrefsData);
            if (vidResults?.length > 0)  showVids(vidResults);
            if (vidResults?.length === 0) {
              const nm = { role: "assistant", content: "No videos found — try a different search." };
              msgs.push(nm); bubbleDOM("assistant", nm.content);
            }
            await sSet("m", msgs.slice(-50));
          }
        } catch (_) {}
      }
    }
  } catch (_) {
    hideDots();
    const em = { role: "assistant", content: "Couldn't connect. Check your internet and try again." };
    msgs.push(em);
    bubbleDOM("assistant", em.content);
  }

  chatBusy = false;
}

// ── Category icons ──────────────────────────────────────────────────────────
const CAT_ICON = { music:"🎵", gaming:"🎮", news:"📰", sports:"🏆", comedy:"😂", education:"📚", science:"🔬", tech:"💻", technology:"💻", entertainment:"🎬", travel:"✈️", cooking:"🍳", fitness:"💪", finance:"💰", film:"🎬", movie:"🎬", shorts:"📱", diy:"🔨", pets:"🐾", art:"🎨", cars:"🚗" };
function catIcon(n) { return CAT_ICON[n?.toLowerCase()] || "🏷"; }

// ── Block list card with × chips ─────────────────────────────────────────────
function displayFilters(p) {
  const box = document.getElementById("tc-msgs");
  if (!box) return;

  const cats      = p.blockedCategories  || [];
  const channels  = p.blockedChannels    || [];
  const keywords  = p.blockedKeywords    || [];
  const interests = prefs.interests      || [];
  const total     = cats.length + channels.length + keywords.length + interests.length;

  if (total === 0) {
    const m = { role: "assistant", content: "No filters or interests saved yet.\n\nTry: \"block music\" or \"show cooking on my homepage\"" };
    msgs.push(m); bubbleDOM("assistant", m.content);
    return;
  }

  const div = document.createElement("div");
  div.className = "tc-row ai";

  function chip(val, type) {
    const ic = (type === "category" || type === "interest") ? `<span class="tc-ci">${catIcon(val)}</span>` : "";
    return `<span class="tc-chip">${ic}<span class="tc-cl">${val}</span><button class="tc-cx" data-type="${type}" data-val="${val}" title="Remove">×</button></span>`;
  }

  function section(label, icon, items, type) {
    if (!items.length) return "";
    return `<div class="tc-fcs">
      <div class="tc-fcl">${icon} ${label} <span class="tc-fcc">${items.length}</span></div>
      <div class="tc-fcchips">${items.map(i => chip(i, type)).join("")}</div>
    </div>`;
  }

  const kwHtml = keywords.length ? `<div class="tc-fcs">
    <div class="tc-fcl">🏷 Keywords <span class="tc-fcc">${keywords.length}</span></div>
    <div class="tc-fcchips tc-kw-chips">${keywords.slice(0, 12).map(i => chip(i, "keyword")).join("")}${keywords.length > 12 ? `<span class="tc-kw-more">+${keywords.length - 12} more</span>` : ""}</div>
  </div>` : "";

  div.innerHTML = `<div class="tc-bub tc-fc-card">
    <div class="tc-fc-hd">
      <span>🎛 Your Filters <span class="tc-fc-tot">${total} active</span></span>
      <button class="tc-fc-ca">Clear all</button>
    </div>
    ${interests.length ? section("Pinned Interests", "📌", interests, "interest") : ""}
    ${section("Blocked Categories", "🚫", cats, "category")}
    ${section("Blocked Channels", "📺", channels, "channel")}
    ${kwHtml}
    <div class="tc-fc-ft">Tap × to remove instantly · Takes effect immediately</div>
  </div>`;

  // Wire × buttons
  div.querySelectorAll(".tc-cx").forEach(btn => {
    btn.addEventListener("click", async () => {
      const { type, val } = btn.dataset;
      const np = { ...prefs };
      if (type === "category")  np.blockedCategories  = (prefs.blockedCategories  || []).filter(x => x !== val);
      if (type === "keyword")   np.blockedKeywords     = (prefs.blockedKeywords    || []).filter(x => x !== val);
      if (type === "channel")   np.blockedChannels     = (prefs.blockedChannels    || []).filter(x => x !== val);
      if (type === "interest")  np.interests           = (prefs.interests          || []).filter(x => x !== val);
      await savePrefs(np);
      btn.closest(".tc-chip")?.remove();
      const remaining = (np.blockedCategories?.length||0)+(np.blockedKeywords?.length||0)+(np.blockedChannels?.length||0)+(np.interests?.length||0);
      const totEl = div.querySelector(".tc-fc-tot");
      if (totEl) totEl.textContent = `${remaining} active`;
      if (type === "interest") { document.getElementById("tc-int-bar")?.remove(); await injectInterests(); }
    });
  });

  // Clear all
  div.querySelector(".tc-fc-ca")?.addEventListener("click", async () => {
    await savePrefs({ blockedCategories:[], blockedKeywords:[], blockedChannels:[], preferredCategories:[], interests:[] });
    document.getElementById("tc-int-bar")?.remove();
    div.querySelector(".tc-fc-card").innerHTML = `<div style="color:#aaa;font-size:13px;padding:8px 0">All filters cleared — your feed is back to normal.</div>`;
  });

  box.appendChild(div);
  box.scrollTop = 9999;
}

// ── Interest section injection into YouTube homepage ─────────────────────────
async function injectInterests() {
  if (!prefs.interests?.length) return;
  if (!location.hostname.includes("youtube.com")) return;
  if (document.getElementById("tc-int-bar")) return; // already there

  // Wait for the page grid to appear
  const target = document.querySelector("ytd-rich-grid-renderer, #primary ytd-section-list-renderer, ytd-browse #contents");
  if (!target) {
    setTimeout(injectInterests, 1500);
    return;
  }

  const bar = document.createElement("div");
  bar.id = "tc-int-bar";
  bar.innerHTML = `
    <div class="tc-ib-head">
      <div class="tc-ib-title">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="#FF0000"/><path d="M7 3.5l.85 2.35 2.35.85-2.35.85L7 9.9l-.85-2.35-2.35-.85 2.35-.85z" fill="white"/></svg>
        TubeChat Picks — your interests
      </div>
      <button id="tc-ib-x" title="Hide">×</button>
    </div>
    <div id="tc-ib-grid" class="tc-ib-grid"><div class="tc-ib-spin">Loading…</div></div>
  `;
  target.parentNode.insertBefore(bar, target);
  document.getElementById("tc-ib-x")?.addEventListener("click", () => bar.remove());

  const grid = document.getElementById("tc-ib-grid");
  const videos = [];

  for (const interest of prefs.interests.slice(0, 3)) {
    try {
      const res = await fetch(`${API}/youtube/search?q=${encodeURIComponent(interest + " videos")}&max=6`);
      if (res.ok) { const vs = await res.json(); videos.push(...vs); }
    } catch (_) {}
  }

  grid.innerHTML = "";
  if (!videos.length) { bar.remove(); return; }

  videos.slice(0, 14).forEach(v => {
    const c = document.createElement("div");
    c.className = "tc-ib-card";
    c.innerHTML = `<img src="${v.thumbnailUrl}" onerror="this.style.display='none'"><div class="tc-ib-info"><div class="tc-ib-t">${v.title}</div><div class="tc-ib-ch">${v.channelTitle}</div></div>`;
    c.onclick = () => { window.location.href = `/watch?v=${v.videoId}`; };
    grid.appendChild(c);
  });
}

function showVids(videos) {
  const box = document.getElementById("tc-msgs");
  if (!box) return;
  const d = document.createElement("div");
  d.className = "tc-row ai";
  d.innerHTML = `<div class="tc-bub tc-vids">${
    videos.slice(0, 5).map(v => `
      <div class="tc-vc" data-id="${v.videoId}">
        <img src="${v.thumbnailUrl}" onerror="this.style.display='none'">
        <div>
          <div class="tc-vt">${v.title}</div>
          <div class="tc-vc2">${v.channelTitle}</div>
        </div>
      </div>`).join("")
  }</div>`;
  d.querySelectorAll(".tc-vc").forEach(el => {
    el.onclick = () => { window.location.href = `/watch?v=${el.dataset.id}`; };
  });
  box.appendChild(d);
  box.scrollTop = 9999;
}

// ── Go ───────────────────────────────────────────────────────────────────────
boot();
