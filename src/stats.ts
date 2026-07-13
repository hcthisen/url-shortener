import type { DB } from './db.js';

export interface DayCount {
  date: string; // YYYY-MM-DD (UTC)
  clicks: number;
}

export function clampDays(raw: unknown, fallback = 7): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(365, Math.max(1, Math.floor(n)));
}

function utcDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Start-of-range ISO timestamp: midnight UTC, (days-1) days ago — so days=7 covers today plus 6 prior days. */
function rangeStart(days: number, now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString();
}

/** Zero-filled per-day click counts over the range, oldest first. */
export function clicksByDay(db: DB, days: number, linkId?: number, now = new Date()): DayCount[] {
  const since = rangeStart(days, now);
  const rows = (
    linkId === undefined
      ? db.prepare(
          `SELECT substr(ts, 1, 10) AS date, COUNT(*) AS clicks FROM clicks WHERE ts >= ? GROUP BY 1`,
        ).all(since)
      : db.prepare(
          `SELECT substr(ts, 1, 10) AS date, COUNT(*) AS clicks FROM clicks WHERE link_id = ? AND ts >= ? GROUP BY 1`,
        ).all(linkId, since)
  ) as DayCount[];

  const byDate = new Map(rows.map((r) => [r.date, r.clicks]));
  const out: DayCount[] = [];
  const cursor = new Date(since);
  for (let i = 0; i < days; i++) {
    const date = utcDateString(cursor);
    out.push({ date, clicks: byDate.get(date) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function totalClicks(db: DB, linkId?: number): number {
  const row =
    linkId === undefined
      ? (db.prepare('SELECT COUNT(*) AS n FROM clicks').get() as { n: number })
      : (db.prepare('SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?').get(linkId) as { n: number });
  return row.n;
}

export interface TopLink {
  code: string;
  url: string;
  clicks: number;
}

export function topLinks(db: DB, days: number, limit = 5, now = new Date()): TopLink[] {
  const since = rangeStart(days, now);
  return db
    .prepare(
      `SELECT l.code AS code, l.url AS url, COUNT(c.id) AS clicks
       FROM clicks c JOIN links l ON l.id = c.link_id
       WHERE c.ts >= ?
       GROUP BY c.link_id ORDER BY clicks DESC, l.code ASC LIMIT ?`,
    )
    .all(since, limit) as TopLink[];
}

export interface Referrer {
  referrer: string;
  clicks: number;
}

export function topReferrers(db: DB, linkId: number, days: number, limit = 8, now = new Date()): Referrer[] {
  const since = rangeStart(days, now);
  return db
    .prepare(
      `SELECT COALESCE(NULLIF(referrer, ''), '(direct)') AS referrer, COUNT(*) AS clicks
       FROM clicks WHERE link_id = ? AND ts >= ?
       GROUP BY 1 ORDER BY clicks DESC LIMIT ?`,
    )
    .all(linkId, since, limit) as Referrer[];
}

/** 7-day sparkline arrays for a set of link ids in one query. */
export function sparklines(db: DB, linkIds: number[], now = new Date()): Map<number, number[]> {
  const result = new Map<number, number[]>();
  if (linkIds.length === 0) return result;
  const days = 7;
  const since = rangeStart(days, now);
  const placeholders = linkIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT link_id, substr(ts, 1, 10) AS date, COUNT(*) AS clicks
       FROM clicks WHERE ts >= ? AND link_id IN (${placeholders})
       GROUP BY link_id, date`,
    )
    .all(since, ...linkIds) as { link_id: number; date: string; clicks: number }[];

  const dates: string[] = [];
  const cursor = new Date(since);
  for (let i = 0; i < days; i++) {
    dates.push(utcDateString(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  for (const id of linkIds) result.set(id, new Array(days).fill(0));
  for (const row of rows) {
    const arr = result.get(row.link_id);
    if (arr) {
      const idx = dates.indexOf(row.date);
      if (idx >= 0) arr[idx] = row.clicks;
    }
  }
  return result;
}
