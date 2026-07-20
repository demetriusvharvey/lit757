"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, List, MapPin, Search, X } from "lucide-react";

type Venue={id:string;name:string;city?:string;kind?:string;type?:string;lat:number|string;lng:number|string;reason?:string;openNow?:boolean|null;activity?:{score?:number};event?:{name?:string|null}|null};
type Payload={venues?:Venue[];picks?:Venue[]};

declare global{interface Window{__lit757Map?:import("mapbox-gl").Map}}

const score=(venue:Venue)=>venue.activity?.score??70;
const searchable=(venue:Venue)=>`${venue.name} ${venue.city||""} ${venue.kind||""} ${venue.type||""} ${venue.reason||""} ${venue.event?.name||""}`.toLowerCase();

export default function VenueBrowserExperience(){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [venues,setVenues]=useState<Venue[]>([]);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    let listButton:HTMLButtonElement|null=null;
    let cancelled=false;
    const openBrowser=()=>setOpen(true);
    const install=()=>{
      if(cancelled)return;
      const searchButton=document.querySelector<HTMLButtonElement>('.mobile-native-actions button[aria-label="Search"]');
      const mapSection=document.querySelector<HTMLElement>(".mobile-native-map");
      if(!searchButton||!mapSection){window.setTimeout(install,150);return;}
      searchButton.onclick=openBrowser;
      listButton=mapSection.querySelector<HTMLButtonElement>(".venue-list-map-button");
      if(!listButton){
        listButton=document.createElement("button");
        listButton.type="button";
        listButton.className="venue-list-map-button";
        listButton.innerHTML='<span>☰</span> View places';
        listButton.setAttribute("aria-label","View nearby places as a list");
        mapSection.appendChild(listButton);
      }
      listButton.onclick=openBrowser;
    };
    install();
    return()=>{cancelled=true;if(listButton)listButton.onclick=null;};
  },[]);

  useEffect(()=>{
    if(!open||venues.length)return;
    setLoading(true);
    fetch("/api/discover?city=All%20757&mode=all",{cache:"no-store"})
      .then(response=>response.json())
      .then((payload:Payload)=>setVenues(payload.venues||payload.picks||[]))
      .catch(()=>setVenues([]))
      .finally(()=>setLoading(false));
  },[open,venues.length]);

  const results=useMemo(()=>{
    const clean=query.trim().toLowerCase();
    return [...venues]
      .filter(venue=>!clean||searchable(venue).includes(clean))
      .sort((a,b)=>score(b)-score(a))
      .slice(0,80);
  },[venues,query]);

  const showOnMap=(venue:Venue)=>{
    const latitude=Number(venue.lat),longitude=Number(venue.lng);
    setOpen(false);
    if(Number.isFinite(latitude)&&Number.isFinite(longitude)){
      window.__lit757Map?.resize();
      window.__lit757Map?.easeTo({center:[longitude,latitude],zoom:15,duration:750});
    }
  };

  if(!open)return null;
  return <div className="venue-browser-backdrop" onClick={()=>setOpen(false)}>
    <section className="venue-browser-sheet" onClick={event=>event.stopPropagation()}>
      <div className="venue-browser-handle"/>
      <header><div><span>NEARBY PLACES</span><h2>Find a place</h2><p>Search businesses, venues, events, food, nightlife, or neighborhoods.</p></div><button onClick={()=>setOpen(false)} aria-label="Close venue browser"><X/></button></header>
      <label className="venue-browser-search"><Search/><input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search places, events, food, nightlife..."/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search"><X/></button>}</label>
      <div className="venue-browser-meta"><span><List/> {results.length} places</span><small>Sorted by Buzz</small></div>
      <div className="venue-browser-list">
        {loading?<div className="venue-browser-empty">Loading nearby places…</div>:results.length?results.map(venue=><button key={venue.id} onClick={()=>showOnMap(venue)}>
          <div className="venue-browser-score">{score(venue)}</div>
          <span><strong>{venue.name}</strong><small><MapPin/> {venue.city||"Hampton Roads"}{venue.event?.name?` · ${venue.event.name}`:""}</small><em>{venue.reason||`${venue.openNow===false?"Closed":"Open now"} · Tap to show on map`}</em></span>
          <ChevronRight/>
        </button>):<div className="venue-browser-empty">No matching places. Try a broader search.</div>}
      </div>
    </section>
  </div>;
}
