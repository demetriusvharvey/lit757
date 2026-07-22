from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)


path = Path("app/buzz-map-app.tsx")
text = path.read_text()

invite_import = '''import {
  buildInviteCrewText,
  buildInviteCrewUrl,
  buildStoryCardUrl,
} from "../src/lib/invite-the-crew";'''
adaptive_import = '''import {
  contextualVibe,
  discoveryDaypart,
  orderedDiscoveryCategories,
  type DiscoveryDaypart,
} from "../src/lib/adaptive-discovery";'''
if adaptive_import not in text:
    text = replace_once(text, invite_import, invite_import + "\n" + adaptive_import, "adaptive import")

text = replace_once(
    text,
    '''  const [mapZoom, setMapZoom] = useState(8.8);
  const [listExpanded, setListExpanded] = useState(false);''',
    '''  const [mapZoom, setMapZoom] = useState(8.8);
  const [daypart, setDaypart] = useState<DiscoveryDaypart>(() => discoveryDaypart());
  const [listExpanded, setListExpanded] = useState(false);''',
    "daypart state",
)

text = replace_once(
    text,
    '''  }, [loadNearby]);

  const filtered = useMemo(() => {''',
    '''  }, [loadNearby]);

  useEffect(() => {
    const syncDaypart = () => setDaypart(discoveryDaypart());
    syncDaypart();
    const timer = window.setInterval(syncDaypart, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const orderedCategories = useMemo(() => orderedDiscoveryCategories(daypart)
    .map(label => categories.find(([candidate]) => candidate === label))
    .filter((item): item is typeof categories[number] => Boolean(item)), [daypart]);

  const filtered = useMemo(() => {''',
    "daypart lifecycle",
)

text = replace_once(
    text,
    '''  }, [venues, active, query]);

  const selectVenue = useCallback''',
    '''  }, [venues, active, query]);

  const vibeFor = useCallback((venue: Venue) => contextualVibe({
    category: categoryFor(venue),
    type: venue.type || venue.kind,
    score: score(venue),
    hasEvent: Boolean(venue.event?.name),
    trend: venue.activity?.trendLabel,
    scoreMode: venue.activity?.scoreMode,
  }, daypart), [daypart]);

  const selectVenue = useCallback''',
    "vibe helper",
)

text = replace_once(
    text,
    '''    map.addSource("buzz-map-venues", { type: "geojson", data: empty });

    const buzzColor: any = [''',
    '''    map.addSource("buzz-map-venues", { type: "geojson", data: empty });
    map.addSource("buzz-map-clusters", {
      type: "geojson",
      data: empty,
      cluster: true,
      clusterRadius: 64,
      clusterMaxZoom: 12,
      clusterProperties: {
        maxScore: ["max", ["get", "score"]],
      },
    } as mapboxgl.GeoJSONSourceSpecification);

    const buzzColor: any = [''',
    "cluster source",
)

text = replace_once(
    text,
    '''    map.addLayer({
      id: "buzz-pin-glow",
      type: "circle",
      source: "buzz-map-venues",
      minzoom: 10.5,
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 27, ["interpolate", ["linear"], ["get", "score"], 20, 12, 100, 23]],
        "circle-color": buzzColor,
        "circle-opacity": ["case", ["==", ["get", "selected"], true], 0.5, 0.28],
        "circle-blur": 0.78,
      },
    });''',
    '''    map.addLayer({
      id: "buzz-heat-hub-glow",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 9,
      maxzoom: 13,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 28, 8, 38, 20, 50],
        "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "maxScore"], 40], 35, "#34d399", 60, "#facc15", 78, "#fb923c", 90, "#ef4444"],
        "circle-opacity": 0.24,
        "circle-blur": 0.72,
      },
    });
    map.addLayer({
      id: "buzz-heat-hubs",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 9,
      maxzoom: 13,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 20, 8, 27, 20, 35],
        "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "maxScore"], 40], 35, "#163c38", 60, "#4a4015", 78, "#632d17", 90, "#6f1d27"],
        "circle-stroke-width": 4,
        "circle-stroke-color": ["interpolate", ["linear"], ["coalesce", ["get", "maxScore"], 40], 35, "#34d399", 60, "#facc15", 78, "#fb923c", 90, "#ef4444"],
      },
    });
    map.addLayer({
      id: "buzz-heat-hub-count",
      type: "symbol",
      source: "buzz-map-clusters",
      minzoom: 9,
      maxzoom: 13,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["concat", ["get", "point_count_abbreviated"], " SPOTS"],
        "text-size": ["step", ["get", "point_count"], 9, 10, 10, 25, 11],
        "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"],
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#ffffff",
        "text-halo-color": "rgba(8,11,16,.75)",
        "text-halo-width": 1,
      },
    });
    map.addLayer({
      id: "buzz-pin-glow",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 10.5,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 29, ["interpolate", ["linear"], ["get", "score"], 20, 13, 100, 24]],
        "circle-color": buzzColor,
        "circle-opacity": ["case", ["==", ["get", "selected"], true], 0.55, 0.32],
        "circle-blur": 0.76,
      },
    });''',
    "heat hub layers",
)

text = replace_once(
    text,
    '''      source: "buzz-map-venues",
      minzoom: 10.5,
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 17, ["interpolate", ["linear"], ["zoom"], 10.5, 12, 15, 15]],
        "circle-color": "#ffffff",
        "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 4, 3],''',
    '''      source: "buzz-map-clusters",
      minzoom: 10.5,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 18, ["interpolate", ["linear"], ["zoom"], 10.5, 12.5, 15, 15.5]],
        "circle-color": "#ffffff",
        "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 6, 4],''',
    "strong venue ring",
)

text = replace_once(
    text,
    '''      source: "buzz-map-venues",
      minzoom: 10.5,
      layout: {''',
    '''      source: "buzz-map-clusters",
      minzoom: 10.5,
      filter: ["!", ["has", "point_count"]],
      layout: {''',
    "cluster logo source",
)

text = replace_once(
    text,
    '''      source: "buzz-map-venues",
      minzoom: 10.2,
      paint: { "circle-radius": 28,''',
    '''      source: "buzz-map-clusters",
      minzoom: 10.2,
      filter: ["!", ["has", "point_count"]],
      paint: { "circle-radius": 30,''',
    "cluster hitbox source",
)

text = replace_once(
    text,
    '''    const onHeatClick = (event: mapboxgl.MapLayerMouseEvent) => {
      if (map.getZoom() >= 10.5) return;
      map.easeTo({ center: event.lngLat, zoom: Math.min(12, map.getZoom() + 2.3), duration: 520 });
    };
    const enter''',
    '''    const onHeatClick = (event: mapboxgl.MapLayerMouseEvent) => {
      if (map.getZoom() >= 10.5) return;
      map.easeTo({ center: event.lngLat, zoom: Math.min(12, map.getZoom() + 2.3), duration: 520 });
    };
    const onHeatHubClick = (event: mapboxgl.MapLayerMouseEvent) => {
      map.easeTo({ center: event.lngLat, zoom: Math.min(14, map.getZoom() + 2.4), duration: 520 });
    };
    const enter''',
    "heat hub click handler",
)

text = replace_once(
    text,
    '''    map.on("click", "buzz-pin-hitbox", onVenueClick);
    map.on("click", "buzz-area-heat", onHeatClick);
    map.on("mouseenter", "buzz-pin-hitbox", enter);''',
    '''    map.on("click", "buzz-pin-hitbox", onVenueClick);
    map.on("click", "buzz-area-heat", onHeatClick);
    map.on("click", "buzz-heat-hubs", onHeatHubClick);
    map.on("mouseenter", "buzz-pin-hitbox", enter);
    map.on("mouseenter", "buzz-heat-hubs", enter);''',
    "heat hub event registration",
)

text = replace_once(
    text,
    '''    map.on("mouseleave", "buzz-pin-hitbox", leave);
    map.on("mouseenter", "buzz-area-heat", enter);''',
    '''    map.on("mouseleave", "buzz-pin-hitbox", leave);
    map.on("mouseleave", "buzz-heat-hubs", leave);
    map.on("mouseenter", "buzz-area-heat", enter);''',
    "heat hub leave registration",
)

text = replace_once(
    text,
    '''      map.off("click", "buzz-pin-hitbox", onVenueClick);
      map.off("click", "buzz-area-heat", onHeatClick);
      map.off("mouseenter", "buzz-pin-hitbox", enter);
      map.off("mouseleave", "buzz-pin-hitbox", leave);''',
    '''      map.off("click", "buzz-pin-hitbox", onVenueClick);
      map.off("click", "buzz-area-heat", onHeatClick);
      map.off("click", "buzz-heat-hubs", onHeatHubClick);
      map.off("mouseenter", "buzz-pin-hitbox", enter);
      map.off("mouseleave", "buzz-pin-hitbox", leave);
      map.off("mouseenter", "buzz-heat-hubs", enter);
      map.off("mouseleave", "buzz-heat-hubs", leave);''',
    "heat hub cleanup",
)

text = replace_once(
    text,
    '''  useEffect(() => {
    const source = mapRef.current?.getSource("buzz-map-venues") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    const nextLogoUrls = new Map<string, string>();''',
    '''  useEffect(() => {
    const heatSource = mapRef.current?.getSource("buzz-map-venues") as mapboxgl.GeoJSONSource | undefined;
    const clusterSource = mapRef.current?.getSource("buzz-map-clusters") as mapboxgl.GeoJSONSource | undefined;
    if (!heatSource || !clusterSource) return;
    const nextLogoUrls = new Map<string, string>();''',
    "dual source update",
)

text = replace_once(
    text,
    '''    logoUrlsRef.current = nextLogoUrls;
    source.setData({ type: "FeatureCollection", features });''',
    '''    logoUrlsRef.current = nextLogoUrls;
    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features };
    heatSource.setData(collection);
    clusterSource.setData(collection);''',
    "dual source data",
)

text = replace_once(
    text,
    '''  const selectedAddress = detail?.address || selected?.address;

  return (''',
    '''  const selectedAddress = detail?.address || selected?.address;
  const selectedVibe = selected ? vibeFor(selected) : null;

  return (''',
    "selected vibe",
)

text = replace_once(
    text,
    '<div className="buzz-map-app">',
    '<div className={`buzz-map-app ${daypart === "day" ? "daytime" : "nighttime"}`}>',
    "root daypart class",
)
text = replace_once(text, '{categories.map(([label, Icon]) =>', '{orderedCategories.map(([label, Icon]) =>', "ordered filters")

text = replace_once(
    text,
    '''            {filtered.map((venue, index) => (
              <article key={venue.id} className={selected?.id === venue.id ? "selected" : ""} onClick={() => selectVenue(venue.id)}>
                <div className="buzz-list-photo"><img src={logoUrlFor(venue)} alt={`${venue.name} logo`} loading="lazy" decoding="async" /><b>{score(venue)}</b></div>
                <div className="buzz-list-copy"><small>{index === 0 ? "BEST NOW" : `#${index + 1}`} · {categoryFor(venue)} · {milesLabel(venue.distanceMiles) || venue.city || "Nearby"}</small><strong>{venue.name}</strong><p>{venue.event?.name || venue.reason || "Available right now"}</p><span className={`buzz-status s${Math.floor(score(venue) / 20)}`}>{statusFor(venue)}{venue.activity?.scoreMode === "live" ? " · Live" : " · Forecast"}</span></div>
                <button type="button" className={favoriteIds.has(venue.id) ? "saved" : ""} onClick={event => toggleFavorite(event, venue)} aria-label={`Save ${venue.name}`}><Heart fill={favoriteIds.has(venue.id) ? "currentColor" : "none"} /></button>
              </article>
            ))}''',
    '''            {filtered.map((venue, index) => {
              const vibe = vibeFor(venue);
              return (
                <article key={venue.id} className={selected?.id === venue.id ? "selected" : ""} onClick={() => selectVenue(venue.id)}>
                  <div className="buzz-list-photo"><img src={logoUrlFor(venue)} alt={`${venue.name} logo`} loading="lazy" decoding="async" /><b>{score(venue)}</b></div>
                  <div className="buzz-list-copy"><small>{index === 0 ? "BEST NOW" : `#${index + 1}`} · {categoryFor(venue)} · {milesLabel(venue.distanceMiles) || venue.city || "Nearby"}</small><strong>{venue.name}</strong><span className={`buzz-vibe-tag ${vibe.truth}`}>{vibe.label}<b>{vibe.truth === "live" ? "LIVE" : "FORECAST"}</b></span><p>{venue.event?.name || venue.reason || "Available right now"}</p><span className={`buzz-status s${Math.floor(score(venue) / 20)}`}>{statusFor(venue)}{venue.activity?.scoreMode === "live" ? " · Live" : " · Forecast"}</span></div>
                  <button type="button" className={favoriteIds.has(venue.id) ? "saved" : ""} onClick={event => toggleFavorite(event, venue)} aria-label={`Save ${venue.name}`}><Heart fill={favoriteIds.has(venue.id) ? "currentColor" : "none"} /></button>
                </article>
              );
            })}''',
    "list vibes",
)

text = replace_once(
    text,
    '''          {mapZoom < 10.5 ? <><Sparkles /><span>Area heat</span><small>Tap a hot zone or zoom in for venues</small></> : <><MapPin /><span>Logo pins</span><small>The ring color shows each place’s Buzz</small></>}''',
    '''          {mapZoom < 9.8 ? <><Sparkles /><span>Area heat</span><small>Tap a hot zone or zoom in for venues</small></> : mapZoom < 12.6 ? <><Sparkles /><span>Heat hubs</span><small>Tap a hub to reveal its venues</small></> : <><MapPin /><span>Logo pins</span><small>Thick rings show each place’s Buzz</small></>}''',
    "map mode",
)

text = replace_once(
    text,
    '''            <div className="buzz-detail-reason"><Sparkles /><div><strong>Why Buzz thinks this</strong><p>{selected.reason || "Buzz is combining current activity signals for this place."}</p></div></div>''',
    '''            {selectedVibe && <div className={`buzz-detail-vibe ${selectedVibe.truth}`}><span>{selectedVibe.label}</span><b>{selectedVibe.truth === "live" ? "LIVE" : "FORECAST"}</b></div>}
            <div className="buzz-detail-reason"><Sparkles /><div><strong>Why Buzz thinks this</strong><p>{selected.reason || "Buzz is combining current activity signals for this place."}</p></div></div>''',
    "detail vibe",
)
path.write_text(text)

css = Path("app/buzz-map-app.css")
css_text = css.read_text()
css_text = replace_once(
    css_text,
    "body.buzz-map-active{overflow:hidden;background:#080b10}",
    '''body.buzz-map-active{overflow:hidden;background:#080b10}
.buzz-map-app,.buzz-map-canvas{transition:background .45s ease,filter .45s ease}
.buzz-map-app.daytime{background:#101820}
.buzz-map-app.daytime .buzz-map-canvas{filter:brightness(1.12) saturate(.78) contrast(1.03)}
.buzz-map-stage:after{content:"";position:absolute;z-index:1;inset:0;pointer-events:none;transition:opacity .45s ease,background .45s ease}
.buzz-map-app.daytime .buzz-map-stage:after{opacity:1;background:rgba(48,65,78,.18);mix-blend-mode:color}
.buzz-map-app.nighttime .buzz-map-stage:after{opacity:0}
.buzz-map-toolbar,.buzz-map-mode,.buzz-map-loading,.buzz-map-error{z-index:5}''',
    "adaptive css root",
)
css_text = replace_once(
    css_text,
    ".buzz-status{display:inline-flex;padding:3px 7px;",
    '''.buzz-vibe-tag{display:inline-flex;align-items:center;gap:5px;width:max-content;max-width:100%;margin-top:5px;padding:3px 7px;border:1px solid #3b4654;border-radius:999px;color:#d7dee6;font-size:7px;font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.buzz-vibe-tag b{padding-left:5px;border-left:1px solid rgba(255,255,255,.18);font-size:6px;letter-spacing:.08em}.buzz-vibe-tag.live{border-color:#9a542a;background:rgba(249,115,22,.1);color:#fed7aa}.buzz-vibe-tag.forecast{border-color:#554590;background:rgba(139,92,246,.08);color:#ddd6fe}
.buzz-detail-vibe{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;padding:9px 11px;border:1px solid #3b4654;border-radius:13px;background:#121923;font-size:10px;font-weight:850}.buzz-detail-vibe b{padding:4px 7px;border-radius:999px;font-size:7px;letter-spacing:.1em}.buzz-detail-vibe.live{border-color:#8b4a27}.buzz-detail-vibe.live b{background:#fb923c;color:#1a0e05}.buzz-detail-vibe.forecast{border-color:#51418a}.buzz-detail-vibe.forecast b{background:#6d54bb;color:#fff}
.buzz-status{display:inline-flex;padding:3px 7px;''',
    "vibe css",
)
css.write_text(css_text)
