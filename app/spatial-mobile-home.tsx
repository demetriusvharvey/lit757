"use client";

import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./mobile-home.css";
import "./spatial-mobile.css";
import { Bell, Bookmark, CalendarDays, ChevronLeft, ChevronRight, Compass, Heart, HelpCircle, LogOut, Map, MapPin, Music2, Navigation, Search, Send, ShoppingBag, Sparkles, TreePine, Utensils, Wine, X } from "lucide-react";
import { useMapController } from "./map-controller";

type Venue={id:string;name:string;city?:string;address?:string|null;kind?:string;type?:string;lat:number|string;lng:number|string;photoUrl?:string|null;reason?:string;openNow?:boolean|null;distanceMiles?:number|null;event?:{name?:string|null;sourceUrl?:string|null;url?:string|null}|null;activity?:{score:number;label:string;trendLabel:string}};
type Payload={success?:boolean;venues?:Venue[];picks?:Venue[];scope?:{label?:string};error?:string};
type LocationResult={id:string;name:string;detail:string;featureType:string;longitude:number;latitude:number;bbox:number[]|null};
type MobileTab="explore"|"map"|"favorites"|"alerts"|"ai";
type VenueAlert={venueId:string;threshold:number};

type SpatialRequest={lat?:number;lng?:number;radius?:number;bounds?:string;q?:string;category?:string;label?:string};

const cats=[["All",Compass],["Food",Utensils],["Drinks",Wine],["Nightlife",Music2],["Events",CalendarDays],["Outdoors",TreePine],["Shopping",ShoppingBag]] as const;
const prompts=["Date night under $100","Live music tonight","Something fun with kids","Drinks then dancing"];
const FAVORITES_KEY="lit757-mobile-favorites";
const ALERTS_KEY="lit757-mobile-alerts";
const VENUE_ALERTS_KEY="lit757-venue-alerts";
const RADIUS_KEY="lit757-nearby-radius";
const score=(v:Venue)=>v.activity?.score??70;
const coords=(v:Venue):[number,number]=>[Number(v.lng),Number(v.lat)];
const validVenue=(v:Venue)=>{const [lng,lat]=coords(v);return Number.isFinite(lat)&&Number.isFinite(lng)&&lat!==0&&lng!==0;};
const categoryFor=(v:Venue)=>{const text=`${v.name} ${v.reason||""} ${v.event?.name||""} ${v.kind||""} ${v.type||""}`.toLowerCase();if(v.event?.name||v.kind==="events")return"Events";if(/restaurant|diner|cafe|pizza|grill|kitchen|food|taco|burger|bakery|seafood/.test(text))return"Food";if(/bar|brew|cocktail|wine|drink|pub/.test(text))return"Drinks";if(/club|dj|music|nightlife|lounge/.test(text))return"Nightlife";if(/park|trail|beach|garden|outdoor|museum/.test(text))return"Outdoors";if(/shop|mall|market|store/.test(text))return"Shopping";return"All";};
const trendPercent=(v:Venue)=>Math.max(3,Math.min(31,Math.round((score(v)-48)/2)));
const peakMinutes=(v:Venue)=>Math.max(18,95-Math.round(score(v)*.7));
const statusFor=(v:Venue)=>score(v)>=88?"Very lit":score(v)>=76?"Heating up":score(v)>=60?"Active":"Chill";
const basePinRadius:mapboxgl.ExpressionSpecification=["interpolate",["linear"],["zoom"],7.5,3.2,11.3,4.5,14,6.5,16,8];
const milesLabel=(value?:number|null)=>value==null?null:value<0.1?"Here":value<10?`${value.toFixed(1)} mi`:`${Math.round(value)} mi`;

export default function SpatialMobileHome(){
  const {setMap,userLocation,selectedVenueId,setSelectedVenueId}=useMapController();
  const [venues,setVenues]=useState<Venue[]>([]);
  const [active,setActive]=useState("All");
  const [activeTab,setActiveTab]=useState<MobileTab>("explore");
  const [selected,setSelected]=useState<Venue|null>(null);
  const [detailsOpen,setDetailsOpen]=useState(false);
  const [plannerOpen,setPlannerOpen]=useState(false);
  const [plannerQuery,setPlannerQuery]=useState("");
  const [plannerTitle,setPlannerTitle]=useState("");
  const [plannerResults,setPlannerResults]=useState<Venue[]>([]);
  const [plannerLoading,setPlannerLoading]=useState(false);
  const [plannerError,setPlannerError]=useState("");
  const [favoritesOpen,setFavoritesOpen]=useState(false);
  const [alertsOpen,setAlertsOpen]=useState(false);
  const [profileOpen,setProfileOpen]=useState(false);
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchQuery,setSearchQuery]=useState("");
  const [searchVenues,setSearchVenues]=useState<Venue[]>([]);
  const [searchLocations,setSearchLocations]=useState<LocationResult[]>([]);
  const [searchLoading,setSearchLoading]=useState(false);
  const [favoriteIds,setFavoriteIds]=useState<Set<string>>(()=>new Set());
  const [alertsEnabled,setAlertsEnabled]=useState(false);
  const [venueAlerts,setVenueAlerts]=useState<VenueAlert[]>([]);
  const [alertMessage,setAlertMessage]=useState("");
  const [radius,setRadius]=useState(1);
  const [scopeLabel,setScopeLabel]=useState("near you");
  const [scopeLoading,setScopeLoading]=useState(false);
  const [searchAreaVisible,setSearchAreaVisible]=useState(false);
  const mapEl=useRef<HTMLDivElement|null>(null);
  const scrollRef=useRef<HTMLElement|null>(null);
  const feedRef=useRef<HTMLElement|null>(null);
  const mapRef=useRef<mapboxgl.Map|null>(null);
  const mappedRef=useRef<Venue[]>([]);
  const moveWasUserRef=useRef(false);
  const lastLocationKeyRef=useRef("");

  const loadSpatial=useCallback(async(request:SpatialRequest={})=>{
    setScopeLoading(true);
    try{
      const params=new URLSearchParams();
      if(request.lat!=null)params.set("lat",String(request.lat));
      if(request.lng!=null)params.set("lng",String(request.lng));
      if(request.radius!=null)params.set("radius",String(request.radius));
      if(request.bounds)params.set("bounds",request.bounds);
      if(request.q)params.set("q",request.q);
      if(request.category&&request.category!=="All")params.set("category",request.category);
      const response=await fetch(`/api/nearby?${params.toString()}`,{cache:"no-store"});
      const payload=await response.json() as Payload;
      if(!response.ok||payload.success===false)throw new Error(payload.error||"Could not load this area");
      setVenues(payload.venues||payload.picks||[]);
      setScopeLabel(request.label||payload.scope?.label||"near you");
      setSelected(null);setSelectedVenueId(null);
      window.dispatchEvent(new CustomEvent("activity757:discovery",{detail:payload}));
    }finally{setScopeLoading(false);}
  },[setSelectedVenueId]);

  useEffect(()=>{
    try{
      // Browser preferences cannot be read during SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavoriteIds(new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY)||"[]") as string[]));
      setAlertsEnabled(localStorage.getItem(ALERTS_KEY)==="true");
      setVenueAlerts(JSON.parse(localStorage.getItem(VENUE_ALERTS_KEY)||"[]") as VenueAlert[]);
      const saved=Number(localStorage.getItem(RADIUS_KEY)||1);
      if([1,3,10,25].includes(saved))setRadius(saved);
    }catch{}
    void loadSpatial();
  },[loadSpatial]);

  useEffect(()=>{if(!userLocation)return;const key=`${userLocation.latitude.toFixed(4)}:${userLocation.longitude.toFixed(4)}:${radius}`;if(lastLocationKeyRef.current===key)return;lastLocationKeyRef.current=key;void loadSpatial({lat:userLocation.latitude,lng:userLocation.longitude,radius,label:`within ${radius} mile${radius===1?"":"s"}`});},[userLocation,radius,loadSpatial]);

  useEffect(()=>{if(!searchOpen||searchQuery.trim().length<2){
    // Results are scoped to an open, valid search query.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearchVenues([]);setSearchLocations([]);setSearchLoading(false);return;
  }const timer=window.setTimeout(async()=>{setSearchLoading(true);const q=searchQuery.trim();try{const [venueResponse,locationResponse]=await Promise.all([fetch(`/api/nearby?q=${encodeURIComponent(q)}&limit=8`,{cache:"no-store"}),fetch(`/api/location-search?q=${encodeURIComponent(q)}`,{cache:"no-store"})]);const venuePayload=await venueResponse.json() as Payload;const locationPayload=await locationResponse.json() as {results?:LocationResult[]};setSearchVenues((venuePayload.venues||venuePayload.picks||[]).slice(0,8));setSearchLocations((locationPayload.results||[]).slice(0,8));}finally{setSearchLoading(false);}},280);return()=>window.clearTimeout(timer);},[searchOpen,searchQuery]);

  const filtered=useMemo(()=>[...venues].filter(v=>active==="All"||categoryFor(v)===active).sort((a,b)=>score(b)-score(a)),[venues,active]);
  const mapped=useMemo(()=>filtered.filter(validVenue),[filtered]);
  useEffect(()=>{mappedRef.current=mapped;},[mapped]);
  const favorites=useMemo(()=>venues.filter(v=>favoriteIds.has(v.id)),[venues,favoriteIds]);
  const hottest=filtered[0];
  const ticker=useMemo(()=>filtered.slice(0,4).map((v,i)=>i===0?`🔥 ${v.name} is ${statusFor(v).toLowerCase()}`:`${i===1?"↗":"•"} ${v.name} ${trendPercent(v)}% busier`),[filtered]);

  useEffect(()=>{const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN;if(!mapEl.current||!token||mapRef.current)return;mapboxgl.accessToken=token;const map=new mapboxgl.Map({container:mapEl.current,style:"mapbox://styles/mapbox/dark-v11",center:[-76.17,36.88],zoom:8.6,minZoom:3,maxZoom:17,attributionControl:true});map.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");const start=(event:unknown)=>{if((event as {originalEvent?:unknown}).originalEvent)moveWasUserRef.current=true;};const end=()=>{if(moveWasUserRef.current){moveWasUserRef.current=false;setSearchAreaVisible(true);}};map.on("movestart",start);map.on("moveend",end);mapRef.current=map;setMap(map);return()=>{map.off("movestart",start);map.off("moveend",end);setMap(null);map.remove();mapRef.current=null;};},[setMap]);

  useEffect(()=>{const map=mapRef.current;if(!map)return;const render=()=>{const features:GeoJSON.Feature<GeoJSON.Point>[]=mapped.map((v,index)=>({type:"Feature",geometry:{type:"Point",coordinates:coords(v)},properties:{id:v.id,index,name:v.name,score:score(v),category:categoryFor(v)}}));const data:GeoJSON.FeatureCollection<GeoJSON.Point>={type:"FeatureCollection",features};const live=map.getSource("mobile-live-dots") as mapboxgl.GeoJSONSource|undefined;const venuesSource=map.getSource("mobile-venues") as mapboxgl.GeoJSONSource|undefined;live?.setData(data);venuesSource?.setData(data);if(!live){map.addSource("mobile-live-dots",{type:"geojson",data});const color:mapboxgl.ExpressionSpecification=["interpolate",["linear"],["get","score"],45,"#43d879",58,"#9bd94a",68,"#f3c94b",78,"#ff9a3d",88,"#ff554a"];map.addLayer({id:"mobile-live-halo",type:"circle",source:"mobile-live-dots",paint:{"circle-radius":["interpolate",["linear"],["get","score"],45,5,78,11,100,18],"circle-color":color,"circle-opacity":["interpolate",["linear"],["get","score"],45,.05,78,.16,100,.28],"circle-blur":.82}});map.addLayer({id:"mobile-live-dot",type:"circle",source:"mobile-live-dots",paint:{"circle-radius":["interpolate",["linear"],["get","score"],45,2.8,78,4.5,100,6.5],"circle-color":color,"circle-opacity":.98,"circle-stroke-width":1,"circle-stroke-color":"rgba(255,255,255,.92)"}});}if(!venuesSource){map.addSource("mobile-venues",{type:"geojson",data,cluster:true,clusterMaxZoom:12.5,clusterRadius:72});map.addLayer({id:"mobile-clusters",type:"circle",source:"mobile-venues",filter:["has","point_count"],paint:{"circle-color":["step",["get","point_count"],"#f3c94b",18,"#ff9a3d",45,"#ff554a"],"circle-radius":["step",["get","point_count"],11,18,14,45,18],"circle-stroke-width":1.2,"circle-stroke-color":"rgba(255,255,255,.72)"}});map.addLayer({id:"mobile-cluster-count",type:"symbol",source:"mobile-venues",filter:["has","point_count"],layout:{"text-field":["get","point_count_abbreviated"],"text-size":9},paint:{"text-color":"#081016"}});map.addLayer({id:"mobile-venue-pins",type:"circle",source:"mobile-venues",filter:["!",["has","point_count"]],paint:{"circle-radius":basePinRadius,"circle-color":["interpolate",["linear"],["get","score"],0,"#5f6670",45,"#43d879",58,"#9bd94a",68,"#f3c94b",78,"#ff9a3d",88,"#ff554a"],"circle-stroke-width":1,"circle-stroke-color":"rgba(255,255,255,.9)"}});map.addLayer({id:"mobile-venue-score",type:"symbol",source:"mobile-venues",filter:["!",["has","point_count"]],minzoom:14.2,layout:{"text-field":["to-string",["get","score"]],"text-size":7.5},paint:{"text-color":"#fff"}});map.on("click","mobile-clusters",event=>{const feature=map.queryRenderedFeatures(event.point,{layers:["mobile-clusters"]})[0];const id=feature?.properties?.cluster_id;if(id==null)return;(map.getSource("mobile-venues") as mapboxgl.GeoJSONSource).getClusterExpansionZoom(id,(error,zoom)=>{if(!error&&zoom!=null)map.easeTo({center:(feature.geometry as GeoJSON.Point).coordinates as [number,number],zoom});});});const choose=(feature?:mapboxgl.MapboxGeoJSONFeature)=>{const id=String(feature?.properties?.id||"");const venue=mappedRef.current.find(item=>String(item.id)===id);if(!venue)return;setSelected(venue);setSelectedVenueId(venue.id);setDetailsOpen(false);map.easeTo({center:coords(venue),zoom:Math.max(map.getZoom(),13),duration:550});};map.on("click","mobile-live-dot",e=>choose(e.features?.[0]));map.on("click","mobile-venue-pins",e=>choose(e.features?.[0]));["mobile-live-dot","mobile-venue-pins"].forEach(layer=>{map.on("mouseenter",layer,()=>{map.getCanvas().style.cursor="pointer";});map.on("mouseleave",layer,()=>{map.getCanvas().style.cursor="";});});}};if(map.isStyleLoaded())render();else map.once("load",render);},[mapped,setSelectedVenueId]);

  useEffect(()=>{const map=mapRef.current;if(!map)return;const apply=()=>{if(!map.getLayer("mobile-venue-pins"))return;const id=selectedVenueId||"";map.setPaintProperty("mobile-venue-pins","circle-radius",["case",["==",["get","id"],id],11,basePinRadius] as mapboxgl.ExpressionSpecification);map.setPaintProperty("mobile-venue-pins","circle-stroke-width",["case",["==",["get","id"],id],3,1] as mapboxgl.ExpressionSpecification);};if(map.isStyleLoaded())apply();else map.once("load",apply);},[selectedVenueId]);

  function selectCategory(label:string){setActive(label);setActiveTab("explore");window.setTimeout(()=>feedRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),180);}
  async function runPlanner(query:string){const clean=query.trim();if(!clean)return;setPlannerLoading(true);setPlannerError("");setPlannerTitle(clean);try{const response=await fetch(`/api/discover?city=All%20757&mode=all&q=${encodeURIComponent(clean)}`,{cache:"no-store"});const payload=await response.json() as Payload;if(!response.ok)throw new Error(payload.error||"Could not build that plan");setPlannerResults((payload.picks||payload.venues||[]).slice(0,3));}catch(error){setPlannerError(error instanceof Error?error.message:"Could not build that plan");}finally{setPlannerLoading(false);}}
  function submitPlanner(event:FormEvent){event.preventDefault();void runPlanner(plannerQuery);}
  function closeOverlay(){setFavoritesOpen(false);setAlertsOpen(false);setProfileOpen(false);setSearchOpen(false);setActiveTab("explore");}
  function openVenue(v:Venue){setSelected(v);setSelectedVenueId(v.id);setDetailsOpen(true);if(validVenue(v))mapRef.current?.easeTo({center:coords(v),zoom:13,duration:550});}
  function toggleFavorite(event:MouseEvent,venue:Venue){event.stopPropagation();setFavoriteIds(current=>{const next=new Set(current);if(next.has(venue.id))next.delete(venue.id);else next.add(venue.id);localStorage.setItem(FAVORITES_KEY,JSON.stringify([...next]));return next;});}
  async function enableAlerts(){setAlertMessage("");if(typeof Notification==="undefined"){setAlertMessage("Notifications are not supported in this browser yet.");return;}const permission=await Notification.requestPermission();if(permission!=="granted"){setAlertMessage("Notifications were not allowed.");return;}setAlertsEnabled(true);localStorage.setItem(ALERTS_KEY,"true");setAlertMessage("Alerts are on for watched places.");}
  function toggleVenueAlert(v:Venue){setVenueAlerts(current=>{const next=current.some(a=>a.venueId===v.id)?current.filter(a=>a.venueId!==v.id):[...current,{venueId:v.id,threshold:80}];localStorage.setItem(VENUE_ALERTS_KEY,JSON.stringify(next));return next;});}
  async function searchThisArea(){const map=mapRef.current;if(!map)return;const b=map.getBounds();setSearchAreaVisible(false);await loadSpatial({bounds:[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(","),label:"in this map area"});}
  function changeRadius(value:number){setRadius(value);localStorage.setItem(RADIUS_KEY,String(value));if(!userLocation&&mapRef.current){const center=mapRef.current.getCenter();void loadSpatial({lat:center.lat,lng:center.lng,radius:value,label:`within ${value} mile${value===1?"":"s"}`});}}
  async function chooseLocation(result:LocationResult){setSearchOpen(false);setSearchQuery("");setSearchAreaVisible(false);if(result.bbox?.length===4)mapRef.current?.fitBounds([[result.bbox[0],result.bbox[1]],[result.bbox[2],result.bbox[3]]],{padding:42,maxZoom:14,duration:650});else mapRef.current?.easeTo({center:[result.longitude,result.latitude],zoom:13.5,duration:650});await loadSpatial({lat:result.latitude,lng:result.longitude,radius,label:`in ${result.name}`});}

  const activePlaces=filtered.filter(v=>score(v)>=52&&v.openNow!==false).length;
  const rising=filtered.filter(v=>v.activity?.trendLabel?.toLowerCase().includes("busier")||score(v)>=76).length;
  const pulseText=active==="All"?`${activePlaces} active places ${scopeLabel}`:`${activePlaces} active ${active.toLowerCase()} spots ${scopeLabel}`;
  const mapMode=activeTab==="map";
  const selectedAlert=selected?venueAlerts.some(a=>a.venueId===selected.id):false;

  return <div className="mobile-native-home lg:hidden">
    <header className="mobile-native-header"><div className="mobile-native-brand"><strong>757</strong><span>THINGS TO DO</span></div><div className="mobile-native-actions"><button aria-label="Search" onClick={()=>setSearchOpen(true)}><Search/></button><button aria-label="Saved places" onClick={()=>setFavoritesOpen(true)}><Bookmark/></button><button className="mobile-avatar" aria-label="Open profile" onClick={()=>setProfileOpen(true)}>D<i/></button></div></header>
    <main ref={scrollRef} className="mobile-native-scroll" style={{paddingBottom:78}}>
      <section className="mobile-native-pulse"><div className="pulse-kicker"><b/> LIVE NOW <span>Updated just now</span></div><h1>Where should I go <em style={{fontStyle:"normal",color:"#b78cff"}}>RIGHT NOW?</em></h1><div className="pulse-summary"><strong>{pulseText}</strong>{rising>0&&<span>🔥 {rising} heating up</span>}</div><span className="spatial-scope-pill"><MapPin/> {scopeLabel}</span>{hottest&&<button onClick={()=>openVenue(hottest)} style={{width:"100%",marginTop:14,padding:"13px 14px",borderRadius:16,border:"1px solid rgba(183,140,255,.25)",background:"rgba(183,140,255,.08)",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between",textAlign:"left"}}><span><small style={{display:"block",color:"#b78cff",fontWeight:800,letterSpacing:1}}>BEST MOVE RIGHT NOW</small><strong style={{display:"block",marginTop:4}}>{hottest.name}</strong></span><span style={{fontSize:22,fontWeight:900}}>{score(hottest)}</span></button>}</section>
      {ticker.length>0&&<div style={{display:"flex",gap:8,overflowX:"auto",padding:"0 16px 12px",scrollbarWidth:"none"}}>{ticker.map(item=><span key={item} style={{whiteSpace:"nowrap",padding:"8px 11px",borderRadius:999,background:"#121720",border:"1px solid #252d39",fontSize:12,color:"#d8dde6"}}>{item}</span>)}</div>}
      <nav className="mobile-category-rail">{cats.map(([label,Icon])=><button key={label} className={active===label?"active":""} onClick={()=>selectCategory(label)}><span><Icon/></span><small>{label}</small></button>)}</nav>
      <section className="mobile-native-map" style={mapMode?{position:"fixed",inset:0,zIndex:10010,height:"auto",margin:0,borderRadius:0}:{}}>{mapMode&&<button onClick={()=>setActiveTab("explore")} aria-label="Close full map" style={{position:"absolute",left:14,top:"calc(14px + env(safe-area-inset-top))",zIndex:15,display:"grid",placeItems:"center",width:42,height:42,border:"1px solid rgba(255,255,255,.18)",borderRadius:21,background:"rgba(8,11,16,.92)",color:"white"}}><ChevronLeft/></button>}<div ref={mapEl} className="mobile-native-mapbox"/><label className="spatial-radius-control"><Navigation size={13}/><span>Near me ·</span><select value={radius} onChange={event=>changeRadius(Number(event.target.value))} aria-label="Nearby radius"><option value={1}>1 mi</option><option value={3}>3 mi</option><option value={10}>10 mi</option><option value={25}>25 mi</option></select></label>{searchAreaVisible&&<button className="spatial-search-area" onClick={()=>void searchThisArea()}>Search this area</button>}{scopeLoading&&<span className="spatial-loading"><i className="spatial-spinner"/> Updating</span>}{selected&&!detailsOpen&&<div className="map-preview" role="button" tabIndex={0} onClick={()=>setDetailsOpen(true)}><div className="map-preview-photo">{selected.photoUrl?<img src={selected.photoUrl} alt=""/>:selected.name.slice(0,1)}</div><div><span className="map-preview-score">{score(selected)}</span><strong>{selected.name}</strong><small>{milesLabel(selected.distanceMiles)||selected.city||"Nearby"} · {statusFor(selected)}</small><p>{selected.event?.name||selected.reason||"Popular nearby right now"}</p></div><ChevronRight/><button className="map-preview-close" onClick={event=>{event.stopPropagation();setSelected(null);setSelectedVenueId(null);}} aria-label="Close venue preview"><X/></button></div>}<button className="mobile-live-updates-cue" type="button" onClick={()=>feedRef.current?.scrollIntoView({behavior:"smooth",block:"start"})}>🔥 Live updates below <span>↓</span></button></section>
      <button className="mobile-plan-card" style={{marginTop:18,marginBottom:20}} onClick={()=>{setActiveTab("ai");setPlannerOpen(true);}}><span className="plan-orb"><Sparkles/></span><span><strong>Ask AI</strong><small>Tell us the vibe. We’ll choose the move.</small></span><b>Ask now <ChevronRight/></b></button>
      <section ref={feedRef} className="mobile-native-feed" style={{scrollMarginTop:12}}><div className="feed-title"><h2>{active==="All"?"Best places right now":active} <span>{filtered.length}</span></h2><button onClick={()=>selectCategory("All")}>All places <ChevronRight/></button></div>{filtered.length?<div className="feed-list">{filtered.map((v,i)=><article className={selectedVenueId===v.id?"feed-row selected":"feed-row"} key={v.id} onClick={()=>openVenue(v)}><div className="feed-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><div className={`feed-score s${i%4}`}>{score(v)}</div><div className="feed-copy"><strong>{v.name}</strong><span><b>{statusFor(v)}</b> · {trendPercent(v)}% busier</span><small>{v.event?.name?`🎟 ${v.event.name}`:`☆ ${v.reason||"Popular nearby right now"}`}</small></div><div className="feed-meta"><span className="spatial-feed-distance">{milesLabel(v.distanceMiles)||i===0?"Best move":`Peak ${peakMinutes(v)}m`}</span><ChevronRight/><button className={favoriteIds.has(v.id)?"favorite-toggle saved":"favorite-toggle"} onClick={event=>toggleFavorite(event,v)}><Heart fill={favoriteIds.has(v.id)?"currentColor":"none"}/></button></div></article>)}</div>:<div className="utility-empty"><Search/><strong>No {active.toLowerCase()} spots found</strong><p>Zoom out, search another area, or try another category.</p></div>}</section>
    </main>
    {!mapMode&&<nav className="mobile-native-bottom"><button className={activeTab==="explore"?"active":""} onClick={()=>{setActiveTab("explore");scrollRef.current?.scrollTo({top:0,behavior:"smooth"});}}><span><Compass/></span><small>Explore</small></button><button onClick={()=>{setActiveTab("map");window.setTimeout(()=>mapRef.current?.resize(),120);}}><span><Map/></span><small>Map</small></button><button onClick={()=>{setActiveTab("favorites");setFavoritesOpen(true);}}><span><Heart/></span><small>Saved</small></button><button onClick={()=>{setActiveTab("alerts");setAlertsOpen(true);}}><span><Bell/>{!alertsEnabled&&<i/>}</span><small>Alerts</small></button><button onClick={()=>{setActiveTab("ai");setPlannerOpen(true);}}><span><Sparkles/></span><small>Ask AI</small></button></nav>}

    {detailsOpen&&selected&&<div className="planner-backdrop" onClick={()=>setDetailsOpen(false)}><section className="utility-sheet" onClick={e=>e.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>{statusFor(selected).toUpperCase()}</span><h2>{selected.name}</h2><p>{milesLabel(selected.distanceMiles)||selected.city||"Nearby"} · {selected.openNow===false?"Closed":"Open now"}</p></div><button onClick={()=>setDetailsOpen(false)}><X/></button></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}><div className="alert-card" style={{margin:0,display:"block"}}><small>BUZZ SCORE</small><strong style={{display:"block",fontSize:34,marginTop:4}}>{score(selected)}</strong><p>{statusFor(selected)}</p></div><div className="alert-card" style={{margin:0,display:"block"}}><small>TREND</small><strong style={{display:"block",fontSize:26,marginTop:8,color:"#ff9a3d"}}>+{trendPercent(selected)}%</strong><p>last 30 min</p></div></div><div className="alert-card"><Sparkles/><div><strong>Why it’s recommended</strong><p>{selected.event?.name?`${selected.event.name} is driving activity. `:""}{selected.reason||"Strong activity and nearby interest."}</p></div></div><button className="alert-action" onClick={()=>toggleVenueAlert(selected)}>{selectedAlert?"Watching this place":"Notify me at 80+"}</button><button className="alert-action" style={{marginTop:10,background:"#151b24"}} onClick={()=>window.open(`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`,"_blank")}><Navigation style={{width:18}}/> Get directions</button></section></div>}

    {searchOpen&&<div className="planner-backdrop" onClick={closeOverlay}><section className="utility-sheet spatial-search-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>SEARCH ANYWHERE</span><h2>Find a place or area</h2><p>Venue, neighborhood, city, state, or ZIP code.</p></div><button onClick={closeOverlay}><X/></button></div><form className="spatial-search-form" onSubmit={event=>event.preventDefault()}><Search/><input autoFocus value={searchQuery} onChange={event=>setSearchQuery(event.target.value)} placeholder="Try Oceanfront, 23451, Atlanta…"/>{searchQuery&&<button type="button" onClick={()=>setSearchQuery("")}><X/></button>}</form>{searchLoading&&<p className="spatial-search-empty">Searching places and locations…</p>}{!searchLoading&&searchVenues.length>0&&<div className="spatial-search-section"><span>PLACES</span><div className="spatial-result-list">{searchVenues.map(v=><button className="spatial-result" key={v.id} onClick={()=>{setSearchOpen(false);setVenues(current=>current.some(item=>item.id===v.id)?current:[v,...current]);openVenue(v);}}><i className="spatial-result-icon">{v.name.slice(0,1)}</i><span className="spatial-result-copy"><strong>{v.name}</strong><small>{v.city||v.type||"Place"}</small></span><em>{score(v)}</em></button>)}</div></div>}{!searchLoading&&searchLocations.length>0&&<div className="spatial-search-section"><span>AREAS & ZIP CODES</span><div className="spatial-result-list">{searchLocations.map(result=><button className="spatial-result" key={result.id} onClick={()=>void chooseLocation(result)}><i className="spatial-result-icon"><MapPin/></i><span className="spatial-result-copy"><strong>{result.name}</strong><small>{result.detail}</small></span><ChevronRight/></button>)}</div></div>}{!searchLoading&&searchQuery.length>=2&&!searchVenues.length&&!searchLocations.length&&<p className="spatial-search-empty">No match yet. Try a city, ZIP code, neighborhood, category, or venue name.</p>}</section></div>}

    {plannerOpen&&<div className="planner-backdrop" onClick={()=>setPlannerOpen(false)}><section className="planner-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="planner-head"><div><span>ASK AI</span><h2>What should you do?</h2><p>Describe the vibe, budget, people, or timing.</p></div><button onClick={()=>setPlannerOpen(false)}><X/></button></div><div className="planner-prompts">{prompts.map(prompt=><button key={prompt} onClick={()=>void runPlanner(prompt)}>{prompt}</button>)}</div><form onSubmit={submitPlanner} className="planner-form"><input value={plannerQuery} onChange={event=>setPlannerQuery(event.target.value)} placeholder="Try chill date night near Norfolk"/><button disabled={plannerLoading||!plannerQuery.trim()}>{plannerLoading?<span className="planner-spinner"/>:<Send/>}</button></form>{plannerError&&<p className="planner-error">{plannerError}</p>}{plannerResults.length>0&&<div className="planner-results"><div className="planner-result-title"><span>YOUR MOVE</span><strong>{plannerTitle}</strong></div>{plannerResults.map((venue,index)=><button key={venue.id} onClick={()=>{setPlannerOpen(false);openVenue(venue);}}><i>{index+1}</i><span><strong>{venue.name}</strong><small>{venue.event?.name||venue.reason||venue.city||"Recommended right now"}</small></span><ChevronRight/></button>)}</div>}</section></div>}

    {favoritesOpen&&<div className="planner-backdrop" onClick={closeOverlay}><section className="utility-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>SAVED</span><h2>Your watchlist</h2><p>Places Buzz should watch for you.</p></div><button onClick={closeOverlay}><X/></button></div>{favorites.length?<div className="utility-list">{favorites.map(v=><button key={v.id} onClick={()=>{closeOverlay();openVenue(v);}}><div className="utility-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><span><strong>{v.name}</strong><small>{statusFor(v)} · Score {score(v)}</small></span><ChevronRight/></button>)}</div>:<div className="utility-empty"><Heart/><strong>No saved places yet</strong><p>Tap the heart on any place to build your watchlist.</p></div>}</section></div>}

    {alertsOpen&&<div className="planner-backdrop" onClick={closeOverlay}><section className="utility-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>SMART ALERTS</span><h2>We’ll tell you when to go</h2><p>Quiet alerts only when a watched place meaningfully heats up.</p></div><button onClick={closeOverlay}><X/></button></div><div className="alert-card"><Bell/><div><strong>{alertsEnabled?"Notifications enabled":"Enable notifications"}</strong><p>{alertsEnabled?`${venueAlerts.length} place${venueAlerts.length===1?"":"s"} on your watchlist.`:"Get notified when saved places cross your activity threshold."}</p></div></div><button className="alert-action" onClick={()=>void enableAlerts()} disabled={alertsEnabled}>{alertsEnabled?"Enabled":"Enable alerts"}</button>{venueAlerts.length>0&&<div className="utility-list" style={{marginTop:14}}>{venueAlerts.map(a=>{const v=venues.find(x=>x.id===a.venueId);return v?<button key={a.venueId} onClick={()=>{closeOverlay();openVenue(v);}}><Bell/><span><strong>{v.name}</strong><small>Notify at {a.threshold}+ · Current {score(v)}</small></span><ChevronRight/></button>:null;})}</div>}{alertMessage&&<p className="alert-message">{alertMessage}</p>}</section></div>}

    {profileOpen&&<div className="planner-backdrop" onClick={closeOverlay}><section className="utility-sheet" onClick={event=>event.stopPropagation()}><div className="planner-handle"/><div className="utility-head"><div><span>PROFILE</span><h2>Your Buzz</h2><p>Saved places, alerts, and discovery preferences.</p></div><button onClick={closeOverlay}><X/></button></div><div className="alert-card"><div style={{display:"grid",placeItems:"center",width:44,height:44,borderRadius:22,background:"#1a2028",fontWeight:800}}>D</div><div><strong>Demetrius</strong><p>{favoriteIds.size} saved places · Nearby radius {radius} mi</p></div></div><div className="utility-list"><button onClick={()=>{setProfileOpen(false);setFavoritesOpen(true);}}><Heart/><span><strong>Saved places</strong><small>{favoriteIds.size} places</small></span><ChevronRight/></button><button onClick={()=>{setProfileOpen(false);setAlertsOpen(true);}}><Bell/><span><strong>Notifications</strong><small>{alertsEnabled?"On":"Off"}</small></span><ChevronRight/></button><button onClick={()=>setSearchOpen(true)}><MapPin/><span><strong>Change area</strong><small>City, neighborhood, or ZIP</small></span><ChevronRight/></button><button onClick={()=>window.location.href="mailto:hello@lit757.app"}><HelpCircle/><span><strong>Help & feedback</strong><small>Tell us what to improve</small></span><ChevronRight/></button><button style={{color:"#ff625f"}} onClick={async()=>{const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;if(url&&key){const {createClient}=await import("@supabase/supabase-js");await createClient(url,key).auth.signOut();}window.location.href="/";}}><LogOut/><span><strong>Sign out</strong><small>End this session</small></span><ChevronRight/></button></div></section></div>}
  </div>;
}
