// The live panel: poll live.json, draw one column per category, scroll each column slowly like a ticker.
// Feed text only ever reaches the page through textContent.
import { byColumn, freshIds, safeUrl, staleHours, timeAgo } from "./core.mjs";

const POLL_MS = 60_000;
const SPEED_PX_PER_S = 18;
const HOLD_MS = 4_000;         // pause at the bottom, and again at the top
const MANUAL_PAUSE_MS = 15_000; // after the reader scrolls a column by hand
const STAGGER_MS = 1_500;      // columns start one after another, so the wall does not move in lockstep
const phone = matchMedia("(max-width: 760px)");
const still = matchMedia("(prefers-reduced-motion: reduce)");

const root = document.getElementById("live");
const board = document.getElementById("live-board");
const tabs = document.getElementById("live-tabs");
const status = document.getElementById("live-status");
const toggle = document.getElementById("live-toggle");

const columns = new Map(); // column id → { section, list, count, tab, pos, hovered, resumeAt, atBottom }
let doc = null;
let seenIds = null;
let activeColumn = null;
let paused = false;

// --- drawing ---

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(item, now, fresh) {
  const article = el("article", fresh ? "live-card is-fresh" : "live-card");
  const href = safeUrl(item.url);
  const title = el(href ? "a" : "span", "live-link", item.title);
  if (href) Object.assign(title, { href, target: "_blank", rel: "noopener noreferrer" });
  article.append(title);
  if (item.summary) article.append(el("p", "live-summary", item.summary));

  const meta = el("footer", "live-meta");
  const time = el("time", "", timeAgo(item.seen_at, now));
  time.dateTime = item.seen_at;
  time.title = new Date(item.published_at || item.seen_at).toLocaleString();
  meta.append(el("span", "live-source", item.source), time);
  if (item.n_sources > 1) {
    const heat = el("span", "live-heat", `×${item.n_sources}`);
    heat.title = `${item.n_sources} 个信源都提到了`;
    meta.append(heat);
  }
  article.append(meta);
  return article;
}

function column(spec, index) {
  const section = el("section", "live-col");
  section.dataset.column = spec.id;
  const head = el("header", "live-col-head");
  const count = el("span", "live-count");
  head.append(el("h2", "", spec.title), count);
  const list = el("div", "live-list");
  list.tabIndex = 0;
  section.append(head, list);

  const tab = el("button", "live-tab", spec.title);
  tab.type = "button";
  tab.dataset.column = spec.id;
  tab.setAttribute("role", "tab");
  tab.addEventListener("click", () => activate(spec.id));

  const state = { section, list, count, tab, pos: 0, hovered: false, resumeAt: performance.now() + index * STAGGER_MS, atBottom: false };
  watchReader(state);
  return state;
}

function render(next) {
  const now = new Date();
  const fresh = freshIds(seenIds, next.items);
  seenIds = new Set(next.items.map((i) => i.id));
  const grouped = byColumn(next);

  if (next.columns.map((c) => c.id).join() !== [...columns.keys()].join()) {
    columns.clear();
    next.columns.forEach((spec, index) => columns.set(spec.id, column(spec, index)));
    board.replaceChildren(...[...columns.values()].map((c) => c.section));
    tabs.replaceChildren(...[...columns.values()].map((c) => c.tab));
  }
  for (const spec of next.columns) {
    const c = columns.get(spec.id);
    const items = grouped.get(spec.id);
    c.count.textContent = `24h · ${spec.count_24h}`;
    c.tab.textContent = `${spec.title} ${spec.count_24h}`;
    c.list.replaceChildren(...(items.length ? items.map((i) => card(i, now, fresh.has(i.id)))
                                            : [el("p", "live-empty", "72 小时内暂无新内容")]));
    c.pos = c.list.scrollTop;
  }
  activate(columns.has(activeColumn) ? activeColumn : next.columns[0]?.id);
  doc = next;
}

function activate(id) {
  activeColumn = id;
  for (const [cid, c] of columns) {
    c.section.classList.toggle("is-active", cid === id);
    c.tab.setAttribute("aria-selected", String(cid === id));
  }
}

function showStatus() {
  if (!doc) return;
  const now = new Date();
  const stale = staleHours(doc, now);
  status.dataset.state = stale ? "stale" : "ok";
  status.textContent = stale
    ? `数据已 ${stale} 小时没有更新，抓取可能停了`
    : `${timeAgo(doc.generated_at, now)}更新 · 最近 ${doc.window_hours} 小时 ${doc.items.length} 条`;
  for (const time of board.querySelectorAll("time")) time.textContent = timeAgo(time.dateTime, now);
}

async function poll() {
  try {
    const response = await fetch(`${root.dataset.feed}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (next.generated_at !== doc?.generated_at) render(next);
    showStatus();
  } catch {
    status.dataset.state = "error";
    status.textContent = doc ? "刷新失败，显示的是上一次的数据" : "数据暂时不可用，稍后自动重试";
  }
}

// --- the ticker ---

function watchReader(c) {
  const hold = () => { c.resumeAt = performance.now() + MANUAL_PAUSE_MS; };
  c.list.addEventListener("mouseenter", () => { c.hovered = true; });
  c.list.addEventListener("mouseleave", () => { c.hovered = false; });
  c.list.addEventListener("focusin", () => { c.hovered = true; });
  c.list.addEventListener("focusout", () => { c.hovered = false; });
  c.list.addEventListener("wheel", hold, { passive: true });
  c.list.addEventListener("touchstart", hold, { passive: true });
  c.list.addEventListener("keydown", hold);
  // Our own steps move scrollTop by < 1px from `pos`; anything bigger was the reader.
  c.list.addEventListener("scroll", () => {
    if (Math.abs(c.list.scrollTop - c.pos) > 2) c.pos = c.list.scrollTop;
  }, { passive: true });
}

function advance(c, seconds, now) {
  const max = c.list.scrollHeight - c.list.clientHeight;
  if (max <= 0 || c.hovered || now < c.resumeAt) return;
  if (c.pos >= max - 1) {
    if (!c.atBottom) {
      c.atBottom = true;
    } else {
      c.atBottom = false;
      c.pos = 0;
      c.list.scrollTo({ top: 0, behavior: "smooth" });
    }
    c.resumeAt = now + HOLD_MS;
    return;
  }
  c.pos = Math.min(max, c.pos + SPEED_PX_PER_S * seconds);
  c.list.scrollTop = c.pos;
}

let lastFrame = performance.now();
function frame(now) {
  const seconds = Math.min((now - lastFrame) / 1000, 0.1); // a backgrounded tab must not jump on return
  lastFrame = now;
  if (!paused && !still.matches && !phone.matches) for (const c of columns.values()) advance(c, seconds, now);
  requestAnimationFrame(frame);
}

toggle.addEventListener("click", () => {
  paused = !paused;
  toggle.setAttribute("aria-pressed", String(paused));
  toggle.textContent = paused ? "继续滚动" : "暂停滚动";
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

poll();
setInterval(poll, POLL_MS);
requestAnimationFrame(frame);
