import { DAY } from '@/domain/time';
import { type MonthlyGoal, goalPlan, goalProgress } from '@/intelligence/goal';
import { buildItemViews, buildSaleViews } from '@/intelligence/portfolio';
import { periodStats, weeklyDigest } from '@/intelligence/review';
import { workshopQueue } from '@/intelligence/workshop';
import { db } from './db';
import { repo } from './repo';

/**
 * Monday's digest (off until the seller switches it on, real data only): a notification with the last 7 days —
 * sales, listings put online against what the goal needs, the workshop queue. Nothing leaves the computer.
 */
export const DIGEST_KEY = 'weeklyDigest';
export const DIGEST_ALARM = 'era-digest';

export async function digestEnabled(): Promise<boolean> {
  return (await repo.getSetting<{ enabled?: boolean } | null>(DIGEST_KEY, null))?.enabled === true;
}

/** Next Monday at 9:00, local time (today if it is Monday before 9:00). */
export function nextMonday9(now: number): number {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  const days = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + days);
  if (d.getTime() <= now) d.setDate(d.getDate() + 7);
  return d.getTime();
}

export async function buildDigest(now = Date.now()) {
  const [items, listings, sales, preps, goal] = await Promise.all([
    db.items.filter((i) => !i.isDemo).toArray(),
    db.listings.filter((l) => !l.isDemo).toArray(),
    db.sales.filter((s) => !s.isDemo).toArray(),
    db.preps.toArray(),
    repo.getSetting<MonthlyGoal | null>('monthlyGoal', null),
  ]);
  const views = buildItemViews(items, listings, sales, now);
  const sv = buildSaleViews(views, sales);
  const plan = goal ? goalPlan(goalProgress(goal, sv, views, now), views, now) : null;
  const waiting = workshopQueue(views, new Map(preps.map((p) => [p.itemId, p]))).toList.length;
  return weeklyDigest(periodStats(sv, views, now - 7 * DAY, now + 1), plan?.perWeek ?? null, waiting);
}

export async function runDigest(now = Date.now()): Promise<boolean> {
  if (!(await digestEnabled()) || (await repo.getSetting('dataMode', 'empty')) !== 'real') return false;
  const d = await buildDigest(now);
  await browser.notifications
    .create(`era-digest-${now}`, { type: 'basic', iconUrl: browser.runtime.getURL('/icon/128.png'), title: d.title, message: d.lines.join('\n'), priority: 1 })
    .catch(() => undefined);
  return true;
}
