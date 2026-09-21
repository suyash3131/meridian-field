'use client';

import { useEffect, useRef } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapPoint = {
  id: string; lat: number; lng: number;
  label: string;                       // what sits inside the dot: a number, or ✓
  tone: 'todo' | 'done' | 'picked' | 'muted';
  title?: string;
};

const TONE: Record<MapPoint['tone'], string> = {
  todo:   'background:#18181b;color:#fff;',
  done:   'background:#e6f2f0;color:#0f766e;box-shadow:0 0 0 1.5px #0f766e inset;',
  picked: 'background:#0f766e;color:#fff;',
  muted:  'background:#fff;color:#63636b;box-shadow:0 0 0 1.5px #d6d6d1 inset;',
};

/**
 * A street map with numbered stops. Leaflet is loaded in the browser only; it
 * touches `window` on import, which breaks a server render.
 *
 * Tiles are Esri's light grey canvas: street detail without the colour noise
 * of the default OpenStreetMap style, so the stops are the loudest thing on
 * it, and no API key. (CARTO's equivalent now stamps "API key required".)
 */
export default function RouteMap({
  points, me, pin, onPick, onMapClick, className = '', fitKey, zoomButtons = true,
}: {
  points: MapPoint[];
  me?: { lat: number; lng: number } | null;
  pin?: { lat: number; lng: number } | null;
  onPick?: (id: string) => void;
  onMapClick?: (lat: number, lng: number) => void;
  className?: string;
  /** Change this to re-fit the view to the points (a new rep, a new day). */
  fitKey?: string;
  /** Off on a phone, where pinching is the zoom control. */
  zoomButtons?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const handlers = useRef({ onPick, onMapClick });
  handlers.current = { onPick, onMapClick };
  const fitted = useRef<string | undefined>(undefined);

  // Create the map once.
  useEffect(() => {
    let dead = false;
    import('leaflet').then((mod) => {
      if (dead || !el.current || map.current) return;
      L.current = mod;
      const m = mod.map(el.current, { zoomControl: false, attributionControl: true })
        .setView([28.65, 77.19], 13);
      mod.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, attribution: '© Esri · © OpenStreetMap' },
      ).addTo(m);
      m.attributionControl.setPrefix(false);
      if (zoomButtons) mod.control.zoom({ position: 'bottomright' }).addTo(m);
      m.on('click', (e: Leaflet.LeafletMouseEvent) => handlers.current.onMapClick?.(e.latlng.lat, e.latlng.lng));
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { draw(); });

  function draw() {
    const mod = L.current, m = map.current, g = layer.current;
    if (!mod || !m || !g) return;
    g.clearLayers();

    for (const p of points) {
      const icon = mod.divIcon({
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        html: `<div style="${TONE[p.tone]}width:26px;height:26px;border-radius:999px;display:grid;place-items:center;
               font:600 12px var(--font-geist),system-ui;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.25)">${p.label}</div>`,
      });
      const mk = mod.marker([p.lat, p.lng], { icon, title: p.title ?? p.label, keyboard: true }).addTo(g);
      mk.on('click', () => handlers.current.onPick?.(p.id));
    }

    if (me) {
      mod.circleMarker([me.lat, me.lng], {
        radius: 7, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1,
      }).addTo(g).bindTooltip('You');
    }

    if (pin) {
      mod.marker([pin.lat, pin.lng], {
        icon: mod.divIcon({
          className: '', iconSize: [22, 30], iconAnchor: [11, 30],
          html: `<svg width="22" height="30" viewBox="0 0 22 30"><path d="M11 0C5 0 0 5 0 11c0 8 11 19 11 19s11-11 11-19C22 5 17 0 11 0z" fill="#b42318"/><circle cx="11" cy="11" r="4" fill="#fff"/></svg>`,
        }),
      }).addTo(g);
    }

    // Fit once per fitKey, and only once there is something to fit to: the
    // first draw often happens before the data arrives.
    const ll = [...points.map((p) => [p.lat, p.lng]), ...(me ? [[me.lat, me.lng]] : [])] as [number, number][];
    if (fitted.current !== fitKey && ll.length) {
      if (ll.length > 1) m.fitBounds(ll, { padding: [28, 28], maxZoom: 16 });
      else m.setView(ll[0], 15);
      fitted.current = fitKey;
    }
  }

  return <div ref={el} className={`z-0 ${className}`} />;
}
