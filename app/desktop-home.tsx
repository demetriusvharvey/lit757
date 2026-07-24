"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./desktop-home.css";
import { Bell, CalendarDays, ChevronRight, Compass, Heart, MapPin, Music2, Search, ShoppingBag, TreePine, Utensils, Wine, X } from "lucide-react";

type Venue={id:string;name:string;city?:string;kind?:string;type?:string;lat:number|string;lng:number|string;photoUrl?:string|null;reason?:string;openNow?:boolean|null;event?:{name?:string|null}|null;activity?:{score:number;label:string;trendLabel:string}};
type Payload={venues?:Venue[];picks?:Venue[]};
const categories=[["All",Compass],["Food",Utensils],["Drinks",Wine],["Nightlife",Music2],["Events",CalendarDays],["Outdoors",TreePine],["Shopping",ShoppingBag]] as const;
const score=(v:Venue)=>v.activity?.score??70;
const coords=(v:Venue):[number,number]=>[Number(v.lng),Number(v.lat)];
const valid=(v:Venue)=>Number.isFinite(Number(v.lat))&&Number.isFinite(Number(v.lng));
const category=(v:Venue)=>{const t=`${v.name} ${v.kind||""} ${v.type||""} ${v.reason||""} ${v.event?.name||""}`.toLowerCase();if(v.event?.name)return"Events";if(/restaurant|food|cafe|pizza|grill|seafood|bakery|burger/.test(t))return"Food";if(/bar|brew|wine|drink|pub|cocktail/.test(t))return"Drinks";if(/club|music|nightlife|dj|lounge/.test(t))return"Nightlife";if(/park|trail|beach|garden|museum|outdoor/.test(t))return"Outdoors";if(/shop|mall|market|store/.test(t))return"Shopping";return"All";};

export default function DesktopHome(){
  const [venues,setVenues]=useState<Venue[]>([]);
  const [active,setActive]=useState("All");
  const [query,setQuery]=useState("");
  const [searchOpen,setSearchOpen]=useState(false);
  const [selected,setSelected]=useState<Venue|null>(null);
  const mapEl=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<mapboxgl.Map|null>(null);
  const markersRef=useRef<mapboxgl.Marker[]>([]);

  useEffect(()=>{fetch("/api/discover?city=All%20757&mode=all",{cache:"no-store"}).then(r=>r.json()).then((p:Payload)=>setVenues(p.venues||p.picks||[])).catch(()=>undefined);},[]);
  const filtered=useMemo(()=>venues.filter(v=>(active==="All"||category(v)===active)&&(!query.trim()||`${v.name} ${v.city||""} ${v.kind||""} ${v.type||""} ${v.event?.name||""}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>score(b)-score(a)),[venues,active,query]);
  const hottest=filtered[0]||venues[0];

  useEffect(()=>{
    let cancelled=false;
    let map:mapboxgl.Map|null=null;
    (async()=>{
      const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if(!mapEl.current||!token||mapRef.current)return;
      if(cancelled||!mapEl.current)return;
      mapboxgl.accessToken=token;
      map=new mapboxgl.Map({container:mapEl.current,style:"mapbox://styles/mapbox/dark-v11",center:[-76.17,36.88],zoom:9,minZoom:4,maxZoom:17});
      map.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");
      mapRef.current=map;
    })().catch(()=>undefined);
    return()=>{cancelled=true;markersRef.current.forEach(marker=>marker.remove());markersRef.current=[];map?.remove();mapRef.current=null;};
  },[]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    markersRef.current.forEach(marker=>marker.remove());
    markersRef.current=[];
    filtered.filter(valid).forEach(v=>{
      const el=document.createElement("button");
      el.type="button";
      el.className="desktop-map-marker";
      el.setAttribute("aria-label",v.name);
      el.textContent=String(score(v));
      el.onclick=()=>{setSelected(v);map.easeTo({center:coords(v),zoom:14,duration:650});};
      const marker=new mapboxgl.Marker({element:el}).setLngLat(coords(v)).addTo(map);
      markersRef.current.push(marker);
    });
  },[filtered]);

  const useLocation=()=>{if(typeof navigator!=="undefined")navigator.geolocation?.getCurrentPosition(p=>mapRef.current?.easeTo({center:[p.coords.longitude,p.coords.latitude],zoom:14.5,duration:850}));};
  const openVenue=(v:Venue)=>{setSelected(v);if(valid(v))mapRef.current?.easeTo({center:coords(v),zoom:14,duration:650});};

  return <div className="desktop-site">
    <header className="desktop-header"><div className="desktop-logo"><b>757</b><span>THINGS TO DO</span></div><div className="desktop-search"><Search/><input value={query} onChange={e=>{setQuery(e.target.value);setSearchOpen(true);}} onFocus={()=>setSearchOpen(true)} placeholder="Search places, events, neighborhoods, or ZIP codes"/><button onClick={useLocation}><MapPin/> Near me</button></div><nav><button>Explore</button><button>Events</button><button>Buzz Feed</button><button>Map</button><button><Bell/></button><button className="desktop-avatar">D</button></nav></header>
    {searchOpen&&<div className="desktop-search-panel"><div className="search-panel-head"><strong>{query?`Results for “${query}”`:"Popular right now"}</strong><button onClick={()=>setSearchOpen(false)}><X/></button></div>{filtered.slice(0,8).map(v=><button key={v.id} onClick={()=>{openVenue(v);setSearchOpen(false)}}><span><strong>{v.name}</strong><small>{v.city||"Hampton Roads"} · {v.event?.name||v.reason||category(v)}</small></span><b>{score(v)}</b></button>)}</div>}
    <main>
      <section className="desktop-hero"><div><span className="eyebrow">LIVE AROUND YOU</span><h1>Know where to go <em>right now.</em></h1><p>Discover restaurants, nightlife, events, and places heating up near you—before everyone else gets there.</p><div className="hero-actions"><button onClick={()=>setSearchOpen(true)}><Search/> Search what’s happening</button><button onClick={useLocation}><MapPin/> Use my location</button></div></div><div className="hero-buzz"><span>BEST MOVE RIGHT NOW</span><strong>{hottest?.name||"Finding your move..."}</strong><small>{hottest?.city||"Near you"}</small><b>{hottest?score(hottest):"--"}</b></div></section>
      <section className="desktop-categories">{categories.map(([name,Icon])=><button key={name} className={active===name?"active":""} onClick={()=>setActive(name)}><span><Icon/></span><strong>{name}</strong></button>)}</section>
      <section className="desktop-discovery"><div className="desktop-list"><div className="section-heading"><div><span>BUZZ NEAR YOU</span><h2>Places worth leaving home for</h2></div><button onClick={()=>setSearchOpen(true)}>View all <ChevronRight/></button></div><div className="desktop-card-grid">{filtered.slice(0,6).map(v=><article key={v.id} onClick={()=>openVenue(v)}><div className="card-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:<span>{v.name[0]}</span>}<b>{score(v)}</b></div><div><small>{category(v)} · {v.city||"Hampton Roads"}</small><h3>{v.name}</h3><p>{v.event?.name||v.reason||"Popular nearby right now"}</p></div><button><Heart/></button></article>)}</div></div><div className="desktop-map-wrap"><div className="map-toolbar"><button onClick={useLocation}><MapPin/> Near me</button><span>{filtered.length} places</span></div><div ref={mapEl} className="desktop-map"/></div></section>
    </main>
    {selected&&<aside className="desktop-detail"><button onClick={()=>setSelected(null)}><X/></button><span>{category(selected).toUpperCase()}</span><h2>{selected.name}</h2><p>{selected.city||"Hampton Roads"} · {selected.openNow===false?"Closed":"Open now"}</p><div><b>{score(selected)}</b><small>Buzz Score</small></div><p>{selected.event?.name||selected.reason||"Strong live activity and nearby interest."}</p><button className="primary">View details</button></aside>}
  </div>;
}
