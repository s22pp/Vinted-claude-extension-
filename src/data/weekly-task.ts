import { createI18n } from '@/i18n';
import { bestLines } from '@/intelligence/outcomes-summary';
import { REPOST_AFTER_DAYS, contactsCsv, weeklyFileName, weeklyNotice } from '@/intelligence/weekly';
import { db } from './db';
import { buildDigest } from './digest';
import { saveFile } from './downloads';
import { pilotMissions } from './pilot-missions';
import { repo } from './repo';

export const WEEKLY_LAST_KEY = 'pilotWeeklyLast';

/**
 * The week's task, from ERA's data alone (no Vinted call): the review, what worked, what the week asks, and the contacts
 * with what followed them saved as a CSV in the downloads (ERA-bilans/). Remembered as done for today.
 */
export async function runWeeklyTask(now = Date.now()): Promise<{ title: string; lines: string[] }> {
  const { t } = createI18n('fr');
  const [digest, contacts, listings, missions] = await Promise.all([
    buildDigest(now),
    db.contacts.toArray(),
    db.listings.filter((l) => !l.isDemo).toArray(),
    pilotMissions(now).catch(() => ({ priceCuts: 0, toList: 0 })),
  ]);
  const toRepost = listings.filter((l) => l.status === 'ACTIVE' && l.listedAtKnown !== false && l.favorites === 0 && now - l.listedAt >= REPOST_AFTER_DAYS * 86_400_000).length;
  const file = contacts.length ? await saveFile(`data:text/csv;charset=utf-8,${encodeURIComponent(contactsCsv(contacts))}`, weeklyFileName(now), 20_000, 'overwrite') : null;
  await repo.setSetting(WEEKLY_LAST_KEY, now);
  return weeklyNotice({
    digest,
    best: bestLines(contacts, listings, now, t as Parameters<typeof bestLines>[3]),
    contactsThisWeek: contacts.filter((c) => now - c.at < 7 * 86_400_000).length,
    priceCuts: missions.priceCuts,
    toList: missions.toList,
    toRepost,
    file,
  });
}
