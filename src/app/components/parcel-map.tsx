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
export function ParcelMap({ home, pins, placing, onPlace }: { home: Place; pins: MapPin[]; placing: boolean; onPlace: (p: { lat: number; lng: number }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const placeRef = useRef(onPlace);
  placeRef.current = onPlace;
  const placingRef = useRef(placing);
  placingRef.current = placing;

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([home.lat, home.lng], 12);
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
      html: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3 2 11.5h3V21h5.5v-6h3v6H19v-9.5h3z"/></svg>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    L.marker([home.lat, home.lng], { icon: homeIcon, title: `Chez moi — ${home.label}`, keyboard: false }).bindTooltip(`Chez moi — ${home.label}`).addTo(g);
    for (const p of pins) {
      const color = p.direction === 'IN' ? (css('--emerald') ?? '#10b981') : (css('--violet') ?? '#8b5cf6');
      if (p.direction === 'OUT') L.polyline([[home.lat, home.lng], [p.lat, p.lng]], { color, weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(g);
      L.circleMarker([p.lat, p.lng], { radius: 8, color, weight: 2, fillColor: color, fillOpacity: 0.6 })
        .bindPopup(`<b>${escapeHtml(p.title)}</b><br>${escapeHtml(p.label)}`)
        .addTo(g);
    }
    const all: L.LatLngExpression[] = [[home.lat, home.lng], ...pins.map((p) => [p.lat, p.lng] as L.LatLngExpression)];
    if (pins.length) m.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 14 });
    else m.setView([home.lat, home.lng], 12);
  }, [home, pins]);

  useEffect(() => {
    if (box.current) box.current.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  return <div ref={box} className="pmap" data-testid="parcel-map" role="region" aria-label="Carte des colis" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
