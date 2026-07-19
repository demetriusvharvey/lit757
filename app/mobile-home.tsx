"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./mobile-home.css";
import { Bell, Bookmark, CalendarDays, ChevronRight, Compass, Heart, Map, Music2, Search, ShoppingBag, Sparkles, TreePine, Utensils, Wine } from "lucide-react";

type Venue = { id:string; name:string; city?:string; kind?:string; type?:string; lat:number; lng:number; photoUrl?:string|null; reason?:string; openNow?:boolean|null; event?:{name?:string|null;ticketUrl?:string|null;url?:string|null}|null; activity?:{score:number;label:string;trendLabel:string} };
type Payload = { venues?:Venue[]; picks?:Venue[] };

const cats = [["All",Compass],["Food",Utensils],["Drinks",Wine],["Nightlife",Music2],["Events",CalendarDays],["Outdoors",TreePine],["Shopping",ShoppingBag]] as const;
const score = (v:Venue) => v.activity?.score ?? 70;
const validVenue = (v:Venue) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && v.lat !== 0 && v.lng !== 0;
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
  const mapEl=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<mapboxgl.Map|null>(null);
  const venueMarkers=useRef<mapboxgl.Marker[]>([]);

  useEffect(()=>{fetch("/api/discover?city=All%20757&mode=all",{cache:"no-store"}).then(r=>r.json()).then((p:Payload)=>setVenues(p.venues||p.picks||[])).catch(()=>undefined)},[]);
  const filtered=useMemo(()=>[...venues].filter(v=>active==="All"||categoryFor(v)===active).sort((a,b)=>score(b)-score(a)),[venues,active]);
  const shown=filtered;

  useEffect(()=>{
    const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if(!mapEl.current||!token||mapRef.current)return;
    mapboxgl.accessToken=token;
    const map=new mapboxgl.Map({container:mapEl.current,style:"mapbox://styles/mapbox/dark-v11",center:[-76.17,36.88],zoom:8.7,minZoom:8,maxZoom:15});
    map.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");
    mapRef.current=map;
    return()=>{venueMarkers.current.forEach(m=>m.remove());venueMarkers.current=[];map.remove();mapRef.current=null};
  },[]);

  useEffect(()=>{
    const map=mapRef.current;if(!map)return;
    const render=()=>{
      const mapped=filtered.filter(validVenue);
      const geojson:GeoJSON.FeatureCollection<GeoJSON.Point>={type:"FeatureCollection",features:mapped.map(v=>({type:"Feature",geometry:{type:"Point",coordinates:[v.lng,v.lat]},properties:{weight:Math.max(.25,score(v)/100)}}))};
      const source=map.getSource("mobile-activity-heat") as mapboxgl.GeoJSONSource|undefined;
      if(source)source.setData(geojson);else{
        map.addSource("mobile-activity-heat",{type:"geojson",data:geojson});
        map.addLayer({id:"mobile-activity-heat-layer",type:"heatmap",source:"mobile-activity-heat",maxzoom:15,paint:{
          "heatmap-weight":["get","weight"],
          "heatmap-intensity":["interpolate",["linear"],["zoom"],7,.7,12,1.4],
          "heatmap-radius":["interpolate",["linear"],["zoom"],7,18,12,38],
          "heatmap-opacity":["interpolate",["linear"],["heatmap-density"],0,0,.12,0,.24,.35,.5,.7,1,.9],
          "heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(0,0,0,0)",.22,"rgba(0,126,255,0)",.35,"rgba(0,126,255,.42)",.55,"rgba(255,210,58,.68)",.75,"rgba(255,122,0,.82)",1,"rgba(255,25,45,.94)"]
        }});
      }
      venueMarkers.current.forEach(m=>m.remove());
      venueMarkers.current=mapped.map(v=>{const el=document.createElement("button");el.className="mobile-venue-pin";el.title=v.name;el.setAttribute("aria-label",`${v.name}, activity ${score(v)}`);el.innerHTML=`<span>${score(v)}</span>`;return new mapboxgl.Marker({element:el,anchor:"center"}).setLngLat([v.lng,v.lat]).addTo(map)});
    };
    map.loaded()?render():map.once("load",render);
  },[filtered]);

  const activePlaces=filtered.filter(v=>score(v)>=52&&v.openNow!==false).length;
  const rising=filtered.filter(v=>v.activity?.trendLabel?.toLowerCase().includes("busier")).length;
  const avg=filtered.length?Math.round(filtered.reduce((sum,v)=>sum+score(v),0)/filtered.length):0;

  return <div className="mobile-native-home lg:hidden">
    <header className="mobile-native-header"><div className="mobile-native-brand"><strong>757</strong><span>THINGS TO DO</span></div><div className="mobile-native-actions"><button aria-label="Search"><Search/></button><button aria-label="Saved places"><Bookmark/></button><button className="mobile-avatar" aria-label="Profile">D<i/></button></div></header>
    <main className="mobile-native-scroll">
      <section className="mobile-native-pulse"><div className="pulse-kicker"><b/> LIVE PULSE <span>Updated just now</span></div><h1>757 is active right now 🚀</h1><div className="pulse-grid"><div><em>⌁</em><strong>{rising}</strong><small>Getting busier</small></div><div><em>⌖</em><strong>{activePlaces}</strong><small>Active places</small></div><div><em>♧</em><strong>{avg}</strong><small>Avg activity</small></div><div><em>↗</em><strong>{filtered.length}</strong><small>Places shown</small></div></div></section>
      <section className="mobile-native-map"><div ref={mapEl} className="mobile-native-mapbox"/><div className="heat-legend">Calm <i/> Very Busy</div></section>
      <nav className="mobile-category-rail">{cats.map(([label,Icon])=><button key={label} className={active===label?"active":""} onClick={()=>setActive(label)}><span><Icon/></span><small>{label}</small></button>)}</nav>
      <section className="mobile-native-feed"><div className="feed-title"><h2>{active==="All"?"Live Activity Feed":active} <span>{shown.length}</span></h2><button>All places <ChevronRight/></button></div><div className="feed-list">{shown.map((v,i)=><article className="feed-row" key={v.id}><div className="feed-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><div className={`feed-score s${i%4}`}>{score(v)}</div><div className="feed-copy"><strong>{v.name}</strong><span><b>{v.activity?.trendLabel||"Steady"}</b> · {v.activity?.label||"Active now"}</span><small>{v.event?.name?`🎟 ${v.event.name}`:`☆ ${v.reason||"Popular nearby right now"}`}</small></div><div className="feed-meta"><span>{i===0?"Just now":`${Math.min(59,i*2+1)}m ago`}</span><ChevronRight/><Heart/></div></article>)}</div></section>
      <button className="mobile-plan-card"><span className="plan-orb"><Sparkles/></span><span><strong>Plan my night</strong><small>AI-powered recommendations<br/>built around you</small></span><b>Get started <ChevronRight/></b></button>
    </main>
    <nav className="mobile-native-bottom"><button className="active"><span><Compass/></span><small>Explore</small></button><button><span><Map/></span><small>Map</small></button><button><span><Heart/></span><small>Favorites</small></button><button><span><Bell/><i/></span><small>Alerts</small></button><button><span><CalendarDays/></span><small>Plans</small></button></nav>
  </div>;
}
