import { describe, expect, it } from 'vitest';
import { type DropOffPoint, carrierOf, groupByStop, haversineKm, mapsDirectionsUrl, mapsSearchUrl, orderStops, parseLatLng, placeParam } from '@/utils/routeOptimizer';

// Test fixtures: made-up points (any coordinates), never the seller's places.
const home = { lat: 45.764, lng: 4.8357 };
const near = { id: 'p1', carrier: 'Mondial Relay' as const, name: 'Point A', address: 'Adresse A, Ville test', lat: 45.7578, lng: 4.832 };
const far = { id: 'p2', carrier: 'Vinted Go' as const, name: 'Point B', address: 'Adresse B, Ville test', lat: 45.7606, lng: 4.8594 };
const farther = { id: 'p3', carrier: 'Colissimo' as const, name: 'Point C', address: 'Adresse C, Ville test', lat: 45.7745, lng: 4.8055 };
const noCoords: DropOffPoint = { id: 'p4', carrier: 'Chronopost', name: 'Point D', address: 'Adresse D, Ville test' };

describe('drop-off round', () => {
  it('reads the carrier in Vinted’s words', () => {
    expect(carrierOf('Mondial Relay - Point Relais')).toBe('Mondial Relay');
    expect(carrierOf('mondialrelay')).toBe('Mondial Relay');
    expect(carrierOf('Vinted Go locker')).toBe('Vinted Go');
    expect(carrierOf('Colissimo')).toBe('Colissimo');
    expect(carrierOf('La Poste')).toBe('Colissimo');
    expect(carrierOf('Chrono Post')).toBe('Chronopost');
    expect(carrierOf('Relais Colis')).toBe('Relais Colis');
    expect(carrierOf('UPS Access Point')).toBe('UPS');
    expect(carrierOf('livraison')).toBeNull();
    expect(carrierOf(null)).toBeNull();
  });

  it('groups the parcels by carrier and its favourite point; unknown carriers apart', () => {
    const stops = groupByStop(
      [
        { saleId: 's1', title: 'Veste', carrier: 'Mondial Relay', storageLocation: 'Bac A' },
        { saleId: 's2', title: 'Jean', carrier: 'Vinted Go' },
        { saleId: 's3', title: 'Pull', carrier: 'Mondial Relay' },
        { saleId: 's4', title: 'Sweat', carrier: null },
        { saleId: 's5', title: 'Polo', carrier: 'UPS' },
      ],
      [near, far, { ...near, id: 'p9', name: 'Autre relais' }],
      { 'Mondial Relay': 'p9' },
    );
    expect(stops.map((s) => [s.carrier, s.point?.id ?? null, s.parcels.map((p) => p.saleId)])).toEqual([
      ['Mondial Relay', 'p9', ['s1', 's3']],
      ['Vinted Go', 'p2', ['s2']],
      [null, null, ['s4']],
      ['UPS', null, ['s5']],
    ]);
  });

  it('Haversine: the distance between two places, in km', () => {
    expect(haversineKm(home, home)).toBe(0);
    // One degree of latitude: 111,2 km.
    expect(haversineKm({ lat: 45, lng: 4 }, { lat: 46, lng: 4 })).toBeCloseTo(111.2, 1);
  });

  it('nearest neighbour from home, the loop back home counted; stops without coordinates last', () => {
    const stops = groupByStop(
      [
        { saleId: 'a', title: 'A', carrier: 'Colissimo' },
        { saleId: 'b', title: 'B', carrier: 'Chronopost' },
        { saleId: 'c', title: 'C', carrier: 'Vinted Go' },
        { saleId: 'd', title: 'D', carrier: 'Mondial Relay' },
      ],
      [farther, noCoords, far, near],
    );
    const r = orderStops(home, stops);
    expect(r.stops.map((s) => s.point!.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const loop = haversineKm(home, near) + haversineKm(near, far) + haversineKm(far, farther) + haversineKm(farther, home);
    expect(r.km).toBeCloseTo(Math.round(loop * 10) / 10, 5);
    // No home: no order to compute, no distance made up.
    expect(orderStops(null, stops).km).toBeNull();
  });

  it('the official Google Maps Directions URL: home → stops → home, encoded, « | » between waypoints, by car or on foot', () => {
    const url = mapsDirectionsUrl(placeParam(home), [placeParam(near), placeParam(noCoords)], 'walking');
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&origin=45.764%2C4.8357&destination=45.764%2C4.8357&waypoints=45.7578%2C4.832%7CAdresse%20D%2C%20Ville%20test&travelmode=walking');
    const u = new URL(url);
    expect(u.searchParams.get('api')).toBe('1');
    expect(u.searchParams.get('waypoints')).toBe('45.7578,4.832|Adresse D, Ville test');
    expect(new URL(mapsDirectionsUrl('A', [], 'driving')).searchParams.has('waypoints')).toBe(false);
    // Google Maps takes at most 9 waypoints.
    const many = Array.from({ length: 12 }, (_, i) => `Stop ${i}`);
    expect(new URL(mapsDirectionsUrl('A', many, 'driving')).searchParams.get('waypoints')!.split('|')).toHaveLength(9);
  });

  it('« Trouver sur Google Maps »: the carrier’s open relay points around home', () => {
    expect(mapsSearchUrl('Mondial Relay', home)).toBe('https://www.google.com/maps/search/Mondial+Relay+point+relais+ouvert/@45.764,4.8357,14z');
    expect(mapsSearchUrl('UPS', null)).toBe('https://www.google.com/maps/search/UPS+point+relais+ouvert');
  });

  it('coordinates pasted from Google Maps', () => {
    expect(parseLatLng('45.7578, 4.832')).toEqual({ lat: 45.7578, lng: 4.832 });
    expect(parseLatLng(' -33.86 151.21 ')).toEqual({ lat: -33.86, lng: 151.21 });
    expect(parseLatLng('Place Bellecour')).toBeNull();
    expect(parseLatLng('95, 4')).toBeNull();
  });

  it('home: always the seller’s saved place (settings.homeLocation) — its coordinates, else its town — at both ends', () => {
    const url = new URL(mapsDirectionsUrl(placeParam({ address: 'Ville test, 00000' }), ['Adresse A'], 'driving'));
    expect(url.searchParams.get('origin')).toBe('Ville test, 00000');
    expect(url.searchParams.get('destination')).toBe('Ville test, 00000');
    expect(placeParam({ lat: 46.5, lng: 4.25, address: 'Ville test, 00000' })).toBe('46.5,4.25');
  });
});

