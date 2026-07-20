"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, List, MapPin, Search, SlidersHorizontal, X } from "lucide-react";

type Venue={id:string;name:string;city?:string;kind?:string;type?:string;lat:number|string;lng:number|string;reason?:string;openNow?:boolean|null;activity?:{score?:number};event?:{name?:string|null}|null};
type Payload={venues?:Venue[];picks?:Venue[]};

declare global{interface Window{__lit757Map?:import("mapbox-gl").Map}}

const score=(venue:Venue)=>venue.activity?.score??70;
const searchable=(venue:Venue)=>`${venue.name} ${venue.city||""} ${venue.kind||""} ${venue.type||""} ${venue.reason||""} ${venue.event?.name||""}`.toLowerCase();
const categoryFor=(venue:Venue)=>{const text=searchable(venue);if(venue.event?.name)return"Events";if(/restaurant|diner|cafe|pizza|grill|kitchen|food|taco|burger|bakery|seafood/.test(text))return"Food";if(/bar|brew|cocktail|wine|drink|pub/.test(text))return"Drinks";if(/club|dj|music|nightlife|lounge/.test(text))return"Nightlife";if(/park|trail|beach|garden|outdoor|museum/.test(text))return"Outdoors";if(/shop|mall|market|store/.test(text))return"Shopping";return"All";};

export default function VenueBrowserExperience(){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [venues,setVenues]=useState<Venue[]>([]);
  const [loading,setLoading]=useState(false);
  const [activeCategory,setActiveCategory]=useState("All");
  const [visibleOnly,setVisibleOnly]=useState(true);

  const readActiveCategory=()=>{
    const label=document.querySelector<HTMLButtonElement>(".mobile-category-rail button.active small")?.textContent?.trim();
    return label||"All";
  };

  useEffect(()=>{
    let listButton:HTMLButtonElement|null=null;
    let cancelled=false;
    const openBrowser=()=>{setActiveCategory(readActiveCategory());setOpen(true);};
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
        listButton.innerHTML='<span>☰</span> Places';
        listButton.setAttribute("aria-label","View places in the current map area");
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
    const bounds=window.__lit757Map?.getBounds();
    return [...venues]
      .filter(venue=>activeCategory==="All"||categoryFor(venue)===activeCategory)
      .filter(venue=>!clean||searchable(venue).includes(clean))
      .filter(venue=>{
        if(!visibleOnly||!bounds)return true;
        const lat=Number(venue.lat),lng=Number(venue.lng);
        return Number.isFinite(lat)&&Number.isFinite(lng)&&bounds.contains([lng,lat]);
      })
      .sort((a,b)=>score(b)-score(a))
      .slice(0,80);
  },[venues,query,activeCategory,visibleOnly,open]);

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
      <header><div><span>{activeCategory==="All"?"PLACES NEARBY":activeCategory.toUpperCase()}</span><h2>Browse this area</h2><p>Results follow your selected category and the map area you are viewing.</p></div><button onClick={()=>setOpen(false)} aria-label="Close venue browser"><X/></button></header>
      <label className="venue-browser-search"><Search/><input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder={`Search ${activeCategory==="All"?"places":activeCategory.toLowerCase()} nearby…`}/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search"><X/></button>}</label>
      <div className="venue-browser-filters">
        <button className={visibleOnly?"active":""} onClick={()=>setVisibleOnly(value=>!value)}><MapPin/> This map area</button>
        <button onClick={()=>setActiveCategory("All")} className={activeCategory==="All"?"active":""}><SlidersHorizontal/> All categories</button>
      </div>
      <div className="venue-browser-meta"><span><List/> {results.length} {activeCategory==="All"?"places":activeCategory.toLowerCase()}</span><small>Highest Buzz first</small></div>
      <div className="venue-browser-list">
        {loading?<div className="venue-browser-empty">Loading places…</div>:results.length?results.map(venue=><button key={venue.id} onClick={()=>showOnMap(venue)}>
          <div className="venue-browser-score">{score(venue)}</div>
          <span><strong>{venue.name}</strong><small><MapPin/> {venue.city||"Nearby"}{venue.event?.name?` · ${venue.event.name}`:""}</small><em>{venue.reason||`${venue.openNow===false?"Closed":"Open now"} · Show on map`}</em></span>
          <ChevronRight/>
        </button>):<div className="venue-browser-empty"><strong>No places in this view</strong><span>Zoom out, switch category, or turn off “This map area.”</span></div>}
      </div>
    </section>
  </div>;
}
