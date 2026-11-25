import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Place } from '@/intelligence/parcels';

export interface MapPin extends Place {
  key: string;
  direction: 'IN' | 'OUT';
  /** The parcel's title, shown with the place. */
  title: string;
}

/**
 * The map around home: home, and each place Vinted gave for a parcel (a pickup point where a parcel waits for the
 * seller, the destination of a parcel sent). Parcels sent are joined to home by a dashed line — a direction, not a
 * route. Map background from OpenStreetMap (only the tiles shown are fetched).
 */
export function ParcelMap({ home, homeSet = true, pins, placing, onPlace }: { home: Place; homeSet?: boolean; pins: MapPin[]; placing: boolean; onPlace: (p: { lat: number; lng: number }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;
  const placingRef = useRef(placing);
  placingRef.current = placing;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([home.lat, home.lng], homeSet ? 12 : 6);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (placingRef.current) placeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is made once; home and pins are drawn by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || undefined;
    const homeIcon = L.divIcon({
      className: 'pmap-home',
      // A radar point: the seller's place, a calm pulse around it.
      html: '<span class="pmap-radar" aria-hidden="true"><i></i></span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    if (homeSet) {
      L.marker([home.lat, home.lng], { icon: homeIcon, title: `Chez moi — ${home.label}`, keyboard: false }).bindTooltip(`Chez moi — ${home.label}`).addTo(g);
      // The 5 km around home (the seller's own place, stored on this device only): a fine dashed ring, no fill.
      L.circle([home.lat, home.lng], { radius: HOME_RADIUS_M, color: 'rgba(56, 189, 248, 0.25)', weight: 1, dashArray: '4 4', fill: false, interactive: false }).addTo(g);
    }
    for (const p of pins) {
      const color = p.direction === 'IN' ? (css('--emerald') ?? '#10b981') : (css('--violet') ?? '#8b5cf6');
      if (p.direction === 'OUT' && homeSet) L.polyline([[home.lat, home.lng], [p.lat, p.lng]], { color, weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(g);
      L.circleMarker([p.lat, p.lng], { radius: 8, color, weight: 2, fillColor: color, fillOpacity: 0.6 })
        .bindPopup(`<b>${escapeHtml(p.title)}</b><br>${escapeHtml(p.label)}`)
        .addTo(g);
    }
    const all: L.LatLngExpression[] = [...(homeSet ? [[home.lat, home.lng] as L.LatLngExpression] : []), ...pins.map((p) => [p.lat, p.lng] as L.LatLngExpression)];
    if (all.length > 1 || (all.length === 1 && pins.length)) m.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 14 });
    else m.setView([home.lat, home.lng], homeSet ? 12 : 6);
  }, [home, homeSet, pins]);

  useEffect(() => {
    if (box.current) box.current.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  return (
    <div className="pmap-wrap">
      <div ref={box} className="pmap" data-testid="parcel-map" role="region" aria-label="Carte des colis" />
      {homeSet && (
        <span className="pmap-legend num" data-testid="pmap-legend">
          {coordText(home.lat, home.lng)} · RAYON {HOME_RADIUS_M / 1000} KM
        </span>
      )}
    </div>
  );
}

/** The ring drawn around home on the map. */
const HOME_RADIUS_M = 5000;

/** « 48.8566° N, 2.3522° E »: the place as a navigator writes it (from the seller's stored home, never a constant). */
export function coordText(lat: number, lng: number): string {
  const f = (v: number) => Math.abs(v).toFixed(4);
  return `${f(lat)}° ${lat >= 0 ? 'N' : 'S'}, ${f(lng)}° ${lng >= 0 ? 'E' : 'O'}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
