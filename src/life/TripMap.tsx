import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { gcjToWgs } from "./maps";
import type { RouteLeg, Stop } from "./model";
export default function TripMap({
  stops,
  routes,
}: {
  stops: Stop[];
  routes: RouteLeg[];
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layer = useRef<L.LayerGroup | null>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!node.current) return;
    const m = L.map(node.current, { scrollWheelZoom: false }).setView(
      [35.86, 104.19],
      4,
    );
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    })
      .on("tileerror", () => setTileError(true))
      .addTo(m);
    const observer = new ResizeObserver(() => m.invalidateSize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);
  useEffect(() => {
    if (!layer.current || !map.current) return;
    layer.current.clearLayers();
    const points: L.LatLngExpression[] = [];
    stops.forEach((s, i) => {
      if (!s.place) return;
      const p = gcjToWgs(s.place.lng, s.place.lat);
      points.push(p);
      const label = document.createElement("span");
      label.textContent = `${i + 1}. ${s.time} ${s.name}`;
      L.circleMarker(p, {
        radius: 9,
        color: s.kind === "住宿" ? "#9b6c3d" : "#367c87",
        fillOpacity: 0.85,
        weight: 2,
      })
        .bindTooltip(label, { direction: "top" })
        .addTo(layer.current!);
    });
    routes.forEach((r) => {
      if (r.points.length > 1)
        L.polyline(
          r.points.map((p) => gcjToWgs(p[0], p[1])),
          { color: "#367c87", weight: 4, opacity: 0.8 },
        ).addTo(layer.current!);
    });
    if (points.length)
      map.current.fitBounds(L.latLngBounds(points), {
        padding: [35, 35],
        maxZoom: 14,
      });
  }, [stops, routes]);
  return (
    <div className="trip-map-wrap">
      <div ref={node} className="trip-map" aria-label="旅行地点与路线地图" />
      <p className="life-muted">
        {tileError ? "底图暂时无法加载；地点与路线仍可显示。 " : ""}
        滚轮不改变缩放，可使用 + / −；拖动查看。线路来自高德，底图为
        OpenStreetMap，已做坐标转换，仅供行程参考。
      </p>
      {!stops.some((s) => s.place) && (
        <div className="trip-map-empty">
          检索并确认地点后，将在地图上显示标记
        </div>
      )}
    </div>
  );
}
