"use client";

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./mobile-home.css";
import { Bell, Bookmark, CalendarDays, ChevronRight, Compass, Heart, Map, Music2, Search, Send, ShoppingBag, Sparkles, TreePine, Utensils, Wine, X } from "lucide-react";

type Venue = { id:string; name:string; city?:string; kind?:string; type?:string; lat:number|string; lng:number|string; photoUrl?:string|null; reason?:string; openNow?:boolean|null; event?:{name?:string|null;ticketUrl?:string|null;url?:string|null}|null; activity?:{score:number;label:string;trendLabel:string} };
type Payload = { venues?:Venue[]; picks?:Venue[] };
type MobileTab = "explore"|"map"|"favorites"|"alerts"|"ai";

const cats = [["All",Compass],["Food",Utensils],["Drinks",Wine],["Nightlife",Music2],["Events",CalendarDays],["Outdoors",TreePine],["Shopping",ShoppingBag]] as const;
const prompts=["Date night under $100","Live music tonight","Something fun with kids","Drinks then dancing"];
const FAVORITES_KEY="lit757-mobile-favorites";
const ALERTS_KEY="lit757-mobile-alerts";
const score = (v:Venue) => v.activity?.score ?? 70;
const coords = (v:Venue):[number,number] => [Number(v.lng),Number(v.lat)];
const validVenue = (v:Venue) => {const [lng,lat]=coords(v);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat!==0&&lng!==0;};
const categoryFor=(v:Venue)=>{
  const explicit=`${v.kind||""} ${v.type||""}`.toLowerCase();
  const text=`${v.name} ${v.reason||""} ${v.event?.name||""} ${explicit}`.toLowerCase();
  if(v.event?.name)return "Events";
  if(/restaurant|diner|cafe|pizza|grill|kitchen|food|taco|burger|bakery|seafood/.test(text))return "Food";
  if(/bar|brew|cocktail|wine|drink|pub/.test(text))return "Drinks";
  if(/club|dj|music|nightlife|lounge/.test(text))return "Nightlife";
  if(/park|trail|beach|garden|outdoor|museum/.test(text))return "Outdoors";
  if(/shop|mall|market|store/.test(text))return "Shopping";
  return "All";
};

export default function MobileHome(){
  const [venues,setVenues]=useState<Venue[]>([]);
  const [active,setActive]=useState("All");
  const [activeTab,setActiveTab]=useState<MobileTab>("explore");
  const [selected,setSelected]=useState<Venue|null>(null);
  const [plannerOpen,setPlannerOpen]=useState(false);
  const [plannerQuery,setPlannerQuery]=useState("");
  const [plannerTitle,setPlannerTitle]=useState("");
  const [plannerResults,setPlannerResults]=useState<Venue[]>([]);
  const [plannerLoading,setPlannerLoading]=useState(false);
  const [plannerError,setPlannerError]=useState("");
  const [favoritesOpen,setFavoritesOpen]=useState(false);
  const [alertsOpen,setAlertsOpen]=useState(false);
  const [favoriteIds,setFavoriteIds]=useState<Set<string>>(()=>new Set());
  const [alertsEnabled,setAlertsEnabled]=useState(false);
  const [alertMessage,setAlertMessage]=useState("");
  const mapEl=useRef<HTMLDivElement|null>(null);
  const mapSectionRef=useRef<HTMLElement|null>(null);
  const scrollRef=useRef<HTMLElement|null>(null);
  const mapRef=useRef<mapboxgl.Map|null>(null);

  useEffect(()=>{
    try{setFavoriteIds(new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]") as string[]));setAlertsEnabled(localStorage.getItem(ALERTS_KEY)==="true");}catch{}
    fetch("/api/discover?city=All%20757&mode=all",{cache:"no-store"}).then(r=>r.json()).then((p:Payload)=>setVenues(p.venues||p.picks||[])).catch(()=>undefined);
  },[]);
  const filtered=useMemo(()=>[...venues].filter(v=>active==="All"||categoryFor(v)===active).sort((a,b)=>score(b)-score(a)),[venues,active]);
  const mapped=useMemo(()=>filtered.filter(validVenue),[filtered]);
  const favorites=useMemo(()=>venues.filter(v=>favoriteIds.has(v.id)),[venues,favoriteIds]);

  useEffect(()=>{
    const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if(!mapEl.current||!token||mapRef.current)return;
    mapboxgl.accessToken=token;
    const map=new mapboxgl.Map({container:mapEl.current,style:"mapbox://styles/mapbox/dark-v11",center:[-76.17,36.88],zoom:8.6,minZoom:7.5,maxZoom:17,attributionControl:true});
    map.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");
    mapRef.current=map;
    return()=>{map.remove();mapRef.current=null};
  },[]);

  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const render=()=>{
      const features:GeoJSON.Feature<GeoJSON.Point>[] = mapped.map((v,index)=>({type:"Feature",geometry:{type:"Point",coordinates:coords(v)},properties:{id:v.id,index,name:v.name,score:score(v),category:categoryFor(v)}}));
      const geojson:GeoJSON.FeatureCollection<GeoJSON.Point>={type:"FeatureCollection",features};
      const heatSource=map.getSource("mobile-venue-heat") as mapboxgl.GeoJSONSource|undefined;
      const pinSource=map.getSource("mobile-venues") as mapboxgl.GeoJSONSource|undefined;
      if(heatSource)heatSource.setData(geojson);if(pinSource)pinSource.setData(geojson);
      if(!heatSource){
        map.addSource("mobile-venue-heat",{type:"geojson",data:geojson});
        map.addLayer({id:"mobile-venue-glow",type:"heatmap",source:"mobile-venue-heat",maxzoom:14,paint:{
          "heatmap-weight":["interpolate",["linear"],["get","score"],0,.08,45,.24,65,.48,82,.72,100,.9],
          "heatmap-intensity":["interpolate",["linear"],["zoom"],7,.48,9,.68,11,.78,13,.55],
          "heatmap-radius":["interpolate",["linear"],["zoom"],7,18,9,25,11,32,13,24],
          "heatmap-opacity":["interpolate",["linear"],["zoom"],7,.48,9,.58,11,.52,13,.28,14,0],
          "heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(0,0,0,0)",.18,"rgba(49,151,255,.12)",.38,"rgba(60,214,178,.24)",.58,"rgba(247,199,72,.38)",.78,"rgba(255,133,55,.54)",1,"rgba(255,77,70,.68)"]
        }});
      }
      if(!pinSource){
        map.addSource("mobile-venues",{type:"geojson",data:geojson,cluster:true,clusterMaxZoom:12,clusterRadius:90});
        map.addLayer({id:"mobile-clusters",type:"circle",source:"mobile-venues",filter:["has","point_count"],minzoom:9.2,paint:{"circle-color":["step",["get","point_count"],"#f2c94c",20,"#ff8b34",55,"#ff554a"],"circle-radius":["step",["get","point_count"],10,20,13,55,16],"circle-stroke-width":1.5,"circle-stroke-color":"rgba(255,255,255,.82)","circle-opacity":.88}});
        map.addLayer({id:"mobile-cluster-count",type:"symbol",source:"mobile-venues",filter:["has","point_count"],minzoom:9.2,layout:{"text-field":["get","point_count_abbreviated"],"text-size":9},paint:{"text-color":"#081016"}});
        map.addLayer({id:"mobile-venue-pins",type:"circle",source:"mobile-venues",filter:["!",["has","point_count"]],minzoom:11.3,paint:{"circle-radius":["interpolate",["linear"],["zoom"],11.3,3.5,14,6.5,16,8],"circle-color":["step",["get","score"],"#43d879",45,"#f2c94c",65,"#ff8b34",82,"#ff554a"],"circle-stroke-width":["interpolate",["linear"],["zoom"],11.3,.8,14,1.5],"circle-stroke-color":"rgba(255,255,255,.86)","circle-opacity":.94}});
        map.addLayer({id:"mobile-venue-score",type:"symbol",source:"mobile-venues",filter:["!",["has","point_count"]],minzoom:14.2,layout:{"text-field":["to-string",["get","score"]],"text-size":7.5},paint:{"text-color":"#ffffff"}});
        map.on("click","mobile-clusters",e=>{const feature=map.queryRenderedFeatures(e.point,{layers:["mobile-clusters"]})[0];const clusterId=feature?.properties?.cluster_id;const source=map.getSource("mobile-venues") as mapboxgl.GeoJSONSource;if(clusterId===undefined)return;source.getClusterExpansionZoom(clusterId,(error,zoom)=>{if(error||zoom==null)return;map.easeTo({center:(feature.geometry as GeoJSON.Point).coordinates as [number,number],zoom});});});
        map.on("click","mobile-venue-pins",e=>{const feature=e.features?.[0];const index=Number(feature?.properties?.index);const venue=mapped[index];if(venue){setSelected(venue);map.easeTo({center:coords(venue),zoom:Math.max(map.getZoom(),13),duration:550});}});
      }
      if(mapped.length){const bounds=new mapboxgl.LngLatBounds();mapped.forEach(v=>bounds.extend(coords(v)));if(mapped.length===1)map.easeTo({center:coords(mapped[0]),zoom:13,duration:500});else map.fitBounds(bounds,{padding:{top:38,right:28,bottom:38,left:28},maxZoom:9.8,duration:650});}
    };
    setSelected(null);map.loaded()?render():map.once("load",render);
  },[mapped]);

  async function runPlanner(query:string){
    const clean=query.trim();if(!clean)return;
    setPlannerQuery(clean);setPlannerLoading(true);setPlannerError("");setPlannerTitle(clean);
    try{const response=await fetch(`/api/discover?city=All%20757&mode=all&q=${encodeURIComponent(clean)}`,{cache:"no-store"});const payload=await response.json() as Payload&{error?:string};if(!response.ok)throw new Error(payload.error||"Could not build that plan");const results=(payload.picks||payload.venues||[]).slice(0,3);setPlannerResults(results);if(results.length){setVenues(results);setActive("All");}else setPlannerError("No strong matches yet. Try a broader request.");}
    catch(error){setPlannerError(error instanceof Error?error.message:"Could not build that plan");}finally{setPlannerLoading(false);}
  }
  function submitPlanner(event:FormEvent){event.preventDefault();void runPlanner(plannerQuery);}
  function closePlanner(){setPlannerOpen(false);setPlannerError("");setActiveTab("explore");}
  function goExplore(){setActiveTab("explore");scrollRef.current?.scrollTo({top:0,behavior:"smooth"});}
  function goMap(){setActiveTab("map");mapSectionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});window.setTimeout(()=>mapRef.current?.resize(),350);}
  function openFavorites(){setActiveTab("favorites");setFavoritesOpen(true);}
  function openAlerts(){setActiveTab("alerts");setAlertsOpen(true);}
  function openPlanner(){setActiveTab("ai");setPlannerOpen(true);}
  function closeOverlay(){setFavoritesOpen(false);setAlertsOpen(false);setActiveTab("explore");}
  function toggleFavorite(event:MouseEvent,venue:Venue){event.stopPropagation();setFavoriteIds(current=>{const next=new Set(current);next.has(venue.id)?next.delete(venue.id):next.add(venue.id);try{localStorage.setItem(FAVORITES_KEY,JSON.stringify([...next]));}catch{}return next;});}
  async function enableAlerts(){
    setAlertMessage("");
    if(typeof Notification==="undefined"){setAlertMessage("Notifications are not supported in this browser yet.");return;}
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){setAlertMessage("Notifications were not allowed. You can enable them later in browser settings.");return;}
    setAlertsEnabled(true);try{localStorage.setItem(ALERTS_KEY,"true");}catch{}
    setAlertMessage("Alerts are on. We’ll only notify you about saved places and meaningful activity.");
  }

  const activePlaces=filtered.filter(v=>score(v)>=52&&v.openNow!==false).length;
  const rising=filtered.filter(v=>v.activity?.trendLabel?.toLowerCase().includes("busier")).length;
  const pulseText=active==="All"?`${activePlaces} active places across Hampton Roads`:`${activePlaces} active ${active.toLowerCase()} spots right now`;

  return <div className="mobile-native-home lg:hidden">
    <header className="mobile-native-header"><div className="mobile-native-brand"><strong>757</strong><span>THINGS TO DO</span></div><div className="mobile-native-actions"><button aria-label="Search"><Search/></button><button aria-label="Saved places" onClick={openFavorites}><Bookmark/></button><button className="mobile-avatar" aria-label="Profile">D<i/></button></div></header>
    <main ref={scrollRef} className="mobile-native-scroll">
      <section className="mobile-native-pulse"><div className="pulse-kicker"><b/> LIVE NOW <span>Updated just now</span></div><h1>{active==="All"?"Find something to do":"Find "+active.toLowerCase()+" near you"}</h1><div className="pulse-summary"><strong>{pulseText}</strong>{rising>0&&<span>🔥 {rising} heating up</span>}</div></section>
      <section ref={mapSectionRef} className="mobile-native-map"><div ref={mapEl} className="mobile-native-mapbox"/><div className="map-key"><span><i className="quiet"/>Quiet</span><span><i className="moderate"/>Moderate</span><span><i className="busy"/>Busy</span><span><i className="hot"/>Very busy</span></div>{selected&&<article className="map-preview"><button className="map-preview-close" onClick={()=>setSelected(null)} aria-label="Close preview"><X/></button><div className="map-preview-photo">{selected.photoUrl?<img src={selected.photoUrl} alt=""/>:selected.name.slice(0,1)}</div><div><span className="map-preview-score">{score(selected)}</span><strong>{selected.name}</strong><small>{selected.activity?.trendLabel||"Steady"} · {selected.activity?.label||"Active now"}</small><p>{selected.event?.name?`🎟 ${selected.event.name}`:selected.reason||"Popular nearby right now"}</p></div><ChevronRight/></article>}</section>
      <nav className="mobile-category-rail">{cats.map(([label,Icon])=><button key={label} className={active===label?"active":""} onClick={()=>setActive(label)}><span><Icon/></span><small>{label}</small></button>)}</nav>
      <button className="mobile-plan-card" onClick={openPlanner}><span className="plan-orb"><Sparkles/></span><span><strong>Ask AI</strong><small>Tell us the vibe. We’ll plan the move.</small></span><b>Plan now <ChevronRight/></b></button>
      <section className="mobile-native-feed"><div className="feed-title"><h2>{active==="All"?"Live Activity Feed":active} <span>{filtered.length}</span></h2><button onClick={()=>setActive("All")}>All places <ChevronRight/></button></div><div className="feed-list">{filtered.map((v,i)=><article className="feed-row" key={v.id} onClick={()=>{setSelected(v);if(validVenue(v))mapRef.current?.easeTo({center:coords(v),zoom:13,duration:550});}}><div className="feed-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><div className={`feed-score s${i%4}`}>{score(v)}</div><div className="feed-copy"><strong>{v.name}</strong><span><b>{v.activity?.trendLabel||"Steady"}</b> · {v.activity?.label||"Active now"}</span><small>{v.event?.name?`🎟 ${v.event.name}`:`☆ ${v.reason||"Popular nearby right now"}`}</small></div><div className="feed-meta"><span>{i===0?"Just now":`${Math.min(59,i*2+1)}m ago`}</span><ChevronRight/><button className={favoriteIds.has(v.id)?"favorite-toggle saved":"favorite-toggle"} onClick={event=>toggleFavorite(event,v)} aria-label={favoriteIds.has(v.id)?"Remove from favorites":"Add to favorites"}><Heart fill={favoriteIds.has(v.id)?"currentColor":"none"}/></button></div></article>)}</div></section>
    </main>
    <nav className="mobile-native-bottom">
      <button className={activeTab==="explore"?"active":""} onClick={goExplore}><span><Compass/></span><small>Explore</small></button>
      <button className={activeTab==="map"?"active":""} onClick={goMap}><span><Map/></span><small>Map</small></button>
      <button className={activeTab==="favorites"?"active":""} onClick={openFavorites}><span><Heart/></span><small>Favorites</small></button>
      <button className={activeTab==="alerts"?"active":""} onClick={openAlerts}><span><Bell/>{!alertsEnabled&&<i/>}</span><small>Alerts</small></button>
      <button className={activeTab==="ai"?"active":""} onClick={openPlanner}><span><Sparkles/></span><small>Ask AI</small></button>
    </nav>
    {plannerOpen&&<div className="planner-backdrop" onClick={closePlanner}><section className="planner-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="planner-head"><div><span>ASK AI</span><h2>What kind of move?</h2><p>Describe the vibe, budget, people, or timing.</p></div><button onClick={closePlanner} aria-label="Close Ask AI"><X/></button></div><div className="planner-prompts">{prompts.map(prompt=><button key={prompt} onClick={()=>void runPlanner(prompt)}>{prompt}</button>)}</div><form onSubmit={submitPlanner} className="planner-form"><input value={plannerQuery} onChange={event=>setPlannerQuery(event.target.value)} placeholder="Try “chill date night near Norfolk”" aria-label="Ask AI what to plan"/><button disabled={plannerLoading||!plannerQuery.trim()} aria-label="Build my plan">{plannerLoading?<span className="planner-spinner"/>:<Send/>}</button></form>{plannerError&&<p className="planner-error">{plannerError}</p>}{plannerResults.length>0&&<div className="planner-results"><div className="planner-result-title"><span>YOUR PLAN</span><strong>{plannerTitle}</strong></div>{plannerResults.map((venue,index)=><button key={venue.id} onClick={()=>{setSelected(venue);closePlanner();if(validVenue(venue))mapRef.current?.easeTo({center:coords(venue),zoom:13,duration:550});}}><i>{index+1}</i><span><strong>{venue.name}</strong><small>{venue.event?.name||venue.reason||venue.city||"Recommended for your plan"}</small></span><ChevronRight/></button>)}</div>}</section></div>}
    {favoritesOpen&&<div className="planner-backdrop" onClick={closeOverlay}><section className="utility-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>FAVORITES</span><h2>Your saved places</h2><p>Keep the spots you want to watch.</p></div><button onClick={closeOverlay}><X/></button></div>{favorites.length?<div className="utility-list">{favorites.map(v=><button key={v.id} onClick={()=>{setSelected(v);closeOverlay();if(validVenue(v)){mapSectionRef.current?.scrollIntoView({behavior:"smooth"});mapRef.current?.easeTo({center:coords(v),zoom:13,duration:550});}}><div className="utility-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><span><strong>{v.name}</strong><small>{v.city||v.activity?.label||"Saved place"}</small></span><ChevronRight/></button>)}</div>:<div className="utility-empty"><Heart/><strong>No favorites yet</strong><p>Tap the heart on any place in the activity feed to save it here.</p></div>}</section></div>}
    {alertsOpen&&<div className="planner-backdrop" onClick={closeOverlay}><section className="utility-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>SMART ALERTS</span><h2>Let the app work for you</h2><p>Get a quiet notification when a saved place starts heating up.</p></div><button onClick={closeOverlay}><X/></button></div><div className="alert-card"><Bell/><div><strong>{alertsEnabled?"Alerts are on":"Turn on saved-place alerts"}</strong><p>{alertsEnabled?"We’ll only send meaningful activity and event updates.":"Favorite places first, then enable notifications. No constant spam."}</p></div></div><button className="alert-action" onClick={()=>void enableAlerts()} disabled={alertsEnabled}>{alertsEnabled?"Enabled":"Enable alerts"}</button>{alertMessage&&<p className="alert-message">{alertMessage}</p>}</section></div>}
  </div>;
}