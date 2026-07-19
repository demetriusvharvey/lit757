"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Bell, Bookmark, CalendarDays, ChevronRight, Compass, Heart, Map, Music2, Search, ShoppingBag, Sparkles, TreePine, Utensils, Wine } from "lucide-react";

type Venue = { id:string; name:string; city?:string; lat:number; lng:number; photoUrl?:string|null; reason?:string; openNow?:boolean|null; event?:{name?:string|null}|null; activity?:{score:number;label:string;trendLabel:string} };
type Payload = { venues?:Venue[]; picks?:Venue[] };

const cats = [["All",Compass],["Food",Utensils],["Drinks",Wine],["Nightlife",Music2],["Events",CalendarDays],["Outdoors",TreePine],["Shopping",ShoppingBag]] as const;
const score = (v:Venue) => v.activity?.score ?? 70;

export default function MobileHome(){
  const [venues,setVenues]=useState<Venue[]>([]);
  const [active,setActive]=useState("All");
  const mapEl=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<mapboxgl.Map|null>(null);

  useEffect(()=>{fetch("/api/discover?city=All%20757&mode=all",{cache:"no-store"}).then(r=>r.json()).then((p:Payload)=>setVenues(p.venues||p.picks||[])).catch(()=>undefined)},[]);
  const top=useMemo(()=>[...venues].sort((a,b)=>score(b)-score(a)).slice(0,4),[venues]);

  useEffect(()=>{
    const token=process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if(!mapEl.current||!token||mapRef.current)return;
    mapboxgl.accessToken=token;
    const map=new mapboxgl.Map({container:mapEl.current,style:"mapbox://styles/mapbox/dark-v11",center:[-76.2859,36.9004],zoom:8.55});
    map.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");
    mapRef.current=map;
    return()=>{map.remove();mapRef.current=null};
  },[]);

  useEffect(()=>{
    const map=mapRef.current;if(!map||!venues.length)return;
    const render=()=>venues.slice(0,18).forEach(v=>{if(!Number.isFinite(v.lat)||!Number.isFinite(v.lng))return;const el=document.createElement("div");el.className="mobile-live-marker";el.textContent=String(score(v));new mapboxgl.Marker({element:el}).setLngLat([v.lng,v.lat]).addTo(map)});
    map.loaded()?render():map.once("load",render);
  },[venues]);

  const fallback:Venue[]=[
    {id:"1",name:"Metro Diner Chesapeake",city:"Chesapeake",lat:0,lng:0,reason:"Live music tonight 7–10PM",activity:{score:76,label:"Busy now",trendLabel:"Getting busier"}},
    {id:"2",name:"Becca’s Restaurant & Garden",city:"Virginia Beach",lat:0,lng:0,reason:"Happy Hour until 7PM",activity:{score:74,label:"Busy now",trendLabel:"Getting busier"}},
    {id:"3",name:"The Mariners’ Museum",city:"Newport News",lat:0,lng:0,reason:"New exhibition open",activity:{score:72,label:"Moderate",trendLabel:"Steady"}},
    {id:"4",name:"Yard House",city:"Virginia Beach",lat:0,lng:0,reason:"Popular with groups right now",activity:{score:71,label:"Busy now",trendLabel:"Getting busier"}},
  ];
  const shown=top.length?top:fallback;
  const activePlaces=venues.filter(v=>score(v)>=52&&v.openNow!==false).length||147;
  const rising=venues.filter(v=>v.activity?.trendLabel==="Getting Busier").length||31;

  return <div className="mobile-native-home lg:hidden">
    <header className="mobile-native-header">
      <div className="mobile-native-brand"><strong>757</strong><span>THINGS TO DO</span></div>
      <div className="mobile-native-actions"><button><Search/></button><button><Bookmark/></button><button className="mobile-avatar">D<i/></button></div>
    </header>
    <main className="mobile-native-scroll">
      <section className="mobile-native-pulse">
        <div className="pulse-kicker"><b/> LIVE PULSE <span>Updated just now</span></div>
        <h1>757 is active right now 🚀</h1>
        <div className="pulse-grid"><div><em>⌁</em><strong>{rising}</strong><small>Getting busier</small></div><div><em>⌖</em><strong>{activePlaces}</strong><small>Active places</small></div><div><em>♧</em><strong>8.2K</strong><small>People out</small></div><div><em>↗</em><strong>+18%</strong><small>vs last hour</small></div></div>
      </section>
      <section className="mobile-native-map"><div ref={mapEl} className="mobile-native-mapbox"/><div className="heat heat-a"/><div className="heat heat-b"/><div className="heat heat-c"/><div className="heat heat-d"/><div className="map-place place-one"><strong>Waterside</strong><span>Getting Busier</span></div><div className="map-place place-two"><strong>Oceanfront</strong><span>🔥 Very Busy</span></div><div className="map-place place-three"><strong>Town Center</strong><span>↑ Getting Busier</span></div><div className="map-place place-four"><strong>Ghent</strong><span>Moderate</span></div><div className="heat-legend">Calm <i/> Very Busy</div></section>
      <nav className="mobile-category-rail">{cats.map(([label,Icon])=><button key={label} className={active===label?"active":""} onClick={()=>setActive(label)}><span><Icon/></span><small>{label}</small></button>)}</nav>
      <section className="mobile-native-feed"><div className="feed-title"><h2>Live Activity Feed <span>LIVE</span></h2><button>See all <ChevronRight/></button></div><div className="feed-list">{shown.map((v,i)=><article className="feed-row" key={v.id}><div className="feed-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><div className={`feed-score s${i}`}>{score(v)}</div><div className="feed-copy"><strong>{v.name}</strong><span><b>{v.activity?.trendLabel||"Getting busier"}</b> · {v.activity?.label||"Busy now"}</span><small>☆ {v.event?.name||v.reason||"Popular nearby right now"}</small></div><div className="feed-meta"><span>{i===0?"Just now":`${i*2+1}m ago`}</span><ChevronRight/><Heart/></div></article>)}</div></section>
      <button className="mobile-plan-card"><span className="plan-orb"><Sparkles/></span><span><strong>Plan my night</strong><small>AI-powered recommendations<br/>built around you</small></span><b>Get started <ChevronRight/></b></button>
    </main>
    <nav className="mobile-native-bottom"><button className="active"><span><Compass/></span><small>Explore</small></button><button><span><Map/></span><small>Map</small></button><button><span><Heart/></span><small>Favorites</small></button><button><span><Bell/><i/></span><small>Alerts</small></button><button><span><CalendarDays/></span><small>Plans</small></button></nav>
  </div>
}
