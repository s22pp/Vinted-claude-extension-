import { describe, expect, it } from 'vitest';
import { DEFAULT_HOME, arrivedAtPickup, distanceKm, parcelStage, parcelsInProgress, pointsIn, trackingIn } from '@/intelligence/parcels';

const NOW = Date.UTC(2026, 8, 29, 12);
const DAY = 86_400_000;

describe('parcels on their way', () => {
  it('the step a Vinted status says — the most specific words first', () => {
    expect(parcelStage('Colis en cours de livraison')).toBe('IN_TRANSIT');
    expect(parcelStage('Colis disponible au point relais')).toBe('AT_PICKUP');
    expect(parcelStage('Livré')).toBe('DELIVERED');
    expect(parcelStage('Envoyé')).toBe('SENT');
    expect(parcelStage('Commande terminée')).toBe('DONE');
    expect(parcelStage('Remboursée')).toBe('CANCELLED');
    expect(parcelStage('Bordereau à imprimer')).toBe('TO_SHIP');
    expect(parcelStage('???')).toBe('UNKNOWN');
    expect(parcelStage('Livré', true)).toBe('TO_SHIP');
  });

  it('parcels in progress both ways, late ones first; finished, refunded, unknown or dismissed ones left out', () => {
    const sales = [
      { id: 's1', title: 'Veste', status: 'COMPLETED', soldAt: NOW - 10 * DAY, vintedStatus: 'Envoyé', vintedStatusSince: NOW - 9 * DAY, vintedConversationId: '91' },
      { id: 's2', title: 'Jean', status: 'COMPLETED', soldAt: NOW - DAY, vintedStatus: null, needsAction: true },
      { id: 's3', title: 'Pull', status: 'COMPLETED', soldAt: NOW - 20 * DAY, vintedStatus: 'Terminée' },
      { id: 's4', title: 'Polo', status: 'REFUNDED', soldAt: NOW - 3 * DAY, vintedStatus: 'Envoyé' },
    ];
    const purchases = [
      { id: 'p1', title: 'Chemise', date: NOW - 6 * DAY, status: 'Colis disponible au point relais', statusSince: NOW - DAY, conversationId: '93' },
      { id: 'p2', title: 'Sweat', date: NOW - 2 * DAY, status: null },
      { id: 'p3', title: 'Short', date: NOW - 2 * DAY, status: 'Envoyé', dismissed: true },
    ];
    const r = parcelsInProgress(sales, purchases, NOW);
    expect(r.map((p) => [p.key, p.stage, p.days, p.late])).toEqual([
      ['out:s1', 'SENT', 9, true],
      ['out:s2', 'TO_SHIP', 1, false],
      ['in:p1', 'AT_PICKUP', 1, false],
    ]);
    expect(r[0]).toMatchObject({ direction: 'OUT', conversationId: '91', sinceStatus: true });
    expect(r[1]!.sinceStatus).toBe(false);
  });

  it('places only where Vinted gives coordinates, labelled from the fields next to them; tracking read if present', () => {
    // Test fixture only: the shape is an assumption — ERA reads whatever carries coordinates.
    const tx = {
      id: 7,
      shipment: {
        id: 8,
        tracking_code: 'XY123',
        carrier: { name: 'Mondial Relay' },
        pickup_point: { name: 'Relais Tabac de la Gare', address_line: '12 rue Jean Jaurès', postal_code: '42300', city: 'Roanne', latitude: '46.0405', longitude: '4.0762' },
        to_address: { city: 'Lyon', lat: 45.764, lng: 4.8357 },
        weird: { latitude: 0, longitude: 0 },
      },
    };
    const pts = pointsIn(tx);
    expect(pts).toEqual([
      { lat: 46.0405, lng: 4.0762, label: 'Relais Tabac de la Gare · 12 rue Jean Jaurès · 42300 Roanne', kind: 'PICKUP' },
      { lat: 45.764, lng: 4.8357, label: 'Lyon', kind: 'ADDRESS' },
    ]);
    expect(pointsIn({ transaction: { id: 1 } })).toEqual([]);
    expect(trackingIn(tx)).toEqual({ carrier: 'Mondial Relay', code: 'XY123', url: null });
    // From Roanne town centre to that relay point: under a kilometre; to Lyon: about 70 km.
    expect(distanceKm(DEFAULT_HOME, pts[0]!)).toBeLessThan(1);
    expect(Math.round(distanceKm(DEFAULT_HOME, pts[1]!))).toBeGreaterThan(60);
  });
});

describe('a parcel that just reached its pickup point', () => {
  const row = (id: string, status: string | null, dismissed = false) => ({ id, title: `Achat ${id}`, date: 0, status, dismissed });

  it('is announced once: known before at another step, now waiting at the pickup point', () => {
    const before = new Map([
      ['a', 'IN_TRANSIT' as const],
      ['b', 'AT_PICKUP' as const],
      ['c', 'SENT' as const],
    ]);
    const after = [row('a', 'Disponible au point relais'), row('b', 'Disponible au point relais'), row('c', 'En transit')];
    // b was already waiting: no second announcement; c has not arrived.
    expect(arrivedAtPickup(before, after)).toEqual(['Achat a']);
  });

  it('never for a purchase seen for the first time, nor a dismissed one', () => {
    const before = new Map([['d', 'SENT' as const]]);
    expect(arrivedAtPickup(before, [row('new', 'Disponible au point relais'), row('d', 'Disponible au point relais', true)])).toEqual([]);
    // First purchases import ever: nothing is announced.
    expect(arrivedAtPickup(new Map(), [row('a', 'Disponible au point relais')])).toEqual([]);
  });
});
