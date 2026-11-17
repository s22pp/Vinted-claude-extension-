import { PARCEL_STEPS, type Parcel, type ParcelStage } from './parcels';

/**
 * « Le tapis des colis » (skill « era-visuel »): every parcel in progress as a box at its station — two lanes (sold, bought),
 * five stations (to ship → delivered). Pure: which box at which station, the late ones first, the oldest next.
 */
export interface BoardLane {
  direction: 'OUT' | 'IN';
  stations: { stage: ParcelStage; parcels: Parcel[] }[];
  count: number;
  late: number;
}

export function parcelBoard(parcels: readonly Parcel[]): BoardLane[] {
  return (['OUT', 'IN'] as const).map((direction) => {
    const mine = parcels.filter((p) => p.direction === direction && PARCEL_STEPS.includes(p.stage));
    return {
      direction,
      stations: PARCEL_STEPS.map((stage) => ({
        stage,
        parcels: mine.filter((p) => p.stage === stage).sort((a, b) => Number(b.late) - Number(a.late) || (b.days ?? -1) - (a.days ?? -1) || a.title.localeCompare(b.title)),
      })),
      count: mine.length,
      late: mine.filter((p) => p.late).length,
    };
  });
}

/** The box's short name: the first letters of the article's first words (« Veste Barbour M » → « VB »). */
export function boxInitials(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w));
  return (words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?').slice(0, 2);
}
