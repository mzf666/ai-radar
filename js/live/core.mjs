// The panel's pure logic: no DOM, no network — so node --test can check it.

export function timeAgo(iso, now) {
  const minutes = Math.floor((now - new Date(iso)) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 60 / 24)} 天前`;
}

// Titles and links come from third-party feeds: a `javascript:` href must never reach the page.
export function safeUrl(url) {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

// What arrived since the previous poll. The first load has nothing to compare with, so nothing is fresh.
export function freshIds(previousIds, items) {
  if (previousIds === null) return new Set();
  return new Set(items.map((i) => i.id).filter((id) => !previousIds.has(id)));
}

export function byColumn(doc) {
  const grouped = new Map(doc.columns.map((c) => [c.id, []]));
  for (const item of doc.items) grouped.get(item.column)?.push(item);
  return grouped;
}

// Whole hours since the feed was written, or null while it is fresh (collect runs every 15 min).
export function staleHours(doc, now) {
  const hours = Math.floor((now - new Date(doc.generated_at)) / 3_600_000);
  return hours >= 1 ? hours : null;
}
