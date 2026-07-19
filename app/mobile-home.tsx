"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./mobile-home.css";
import { Bell, Bookmark, CalendarDays, ChevronRight, Compass, Heart, Map, Music2, Search, ShoppingBag, Sparkles, TreePine, Utensils, Wine, X } from "lucide-react";

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
  const [selected,setSelected]=useState<Venue|null>(null);
  const mapEl=useRef<HTMLDivElement|null>(null);
  const mapRef=useRef<mapboxgl.Map|null>(null);

  useEffect(()=>{fetch("/api/discover?city=All%20757&mode=all",{cache:"no-store"}).then(r=>r.json()).then((p:Payload)=>setVenues(p.venues||p.picks||[])).catch(()=>undefined)},[]);
  const filtered=useMemo(()=>[...venues].filter(v=>active==="All"||categoryFor(v)===active).sort((a,b)=>score(b)-score(a)),[venues,active]);
  const mapped=useMemo(()=>filtered.filter(validVenue),[filtered]);

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
      const features:GeoJSON.Feature<GeoJSON.Point>[] = mapped.map((v,index)=>({type:"Feature",geometry:{type:"Point",coordinates:[v.lng,v.lat]},properties:{id:v.id,index,name:v.name,score:score(v),category:categoryFor(v)}}));
      const geojson:GeoJSON.FeatureCollection<GeoJSON.Point>={type:"FeatureCollection",features};
      const heatSource=map.getSource("mobile-venue-heat") as mapboxgl.GeoJSONSource|undefined;
      const pinSource=map.getSource("mobile-venues") as mapboxgl.GeoJSONSource|undefined;
      if(heatSource)heatSource.setData(geojson);
      if(pinSource)pinSource.setData(geojson);
      if(!heatSource){
        map.addSource("mobile-venue-heat",{type:"geojson",data:geojson});
        map.addLayer({id:"mobile-venue-glow",type:"heatmap",source:"mobile-venue-heat",maxzoom:14,paint:{
          "heatmap-weight":["interpolate",["linear"],["get","score"],0,.2,40,.55,70,.85,100,1],
          "heatmap-intensity":["interpolate",["linear"],["zoom"],7,1.25,10,1.55,13,.95],
          "heatmap-radius":["interpolate",["linear"],["zoom"],7,34,10,52,13,34],
          "heatmap-opacity":["interpolate",["linear"],["zoom"],7,.78,10,.68,12,.5,14,0],
          "heatmap-color":["interpolate",["linear"],["heatmap-density"],0,"rgba(0,0,0,0)",.08,"rgba(34,145,255,.28)",.22,"rgba(39,217,171,.48)",.42,"rgba(255,214,64,.68)",.68,"rgba(255,126,32,.82)",1,"rgba(255,45,60,.95)"]
        }});
      }
      if(!pinSource){
        map.addSource("mobile-venues",{type:"geojson",data:geojson,cluster:true,clusterMaxZoom:12,clusterRadius:90});
        map.addLayer({id:"mobile-clusters",type:"circle",source:"mobile-venues",filter:["has","point_count"],minzoom:9.2,paint:{
          "circle-color":["step",["get","point_count"],"#f2c94c",20,"#ff8b34",55,"#ff554a"],
          "circle-radius":["step",["get","point_count"],10,20,13,55,16],
          "circle-stroke-width":1.5,"circle-stroke-color":"rgba(255,255,255,.82)","circle-opacity":.88
        }});
        map.addLayer({id:"mobile-cluster-count",type:"symbol",source:"mobile-venues",filter:["has","point_count"],minzoom:9.2,layout:{"text-field":["get","point_count_abbreviated"],"text-size":9},paint:{"text-color":"#081016"}});
        map.addLayer({id:"mobile-venue-pins",type:"circle",source:"mobile-venues",filter:["!",["has","point_count"]],minzoom:11.3,paint:{
          "circle-radius":["interpolate",["linear"],["zoom"],11.3,3.5,14,6.5,16,8],
          "circle-color":["step",["get","score"],"#43d879",45,"#f2c94c",65,"#ff8b34",82,"#ff554a"],
          "circle-stroke-width":["interpolate",["linear"],["zoom"],11.3,.8,14,1.5],"circle-stroke-color":"rgba(255,255,255,.86)","circle-opacity":.94
        }});
        map.addLayer({id:"mobile-venue-score",type:"symbol",source:"mobile-venues",filter:["!",["has","point_count"]],minzoom:14.2,layout:{"text-field":["to-string",["get","score"]],"text-size":7.5},paint:{"text-color":"#ffffff"}});

        map.on("click","mobile-clusters",e=>{
          const feature=map.queryRenderedFeatures(e.point,{layers:["mobile-clusters"]})[0];
          const clusterId=feature?.properties?.cluster_id;
          const source=map.getSource("mobile-venues") as mapboxgl.GeoJSONSource;
          if(clusterId===undefined)return;
          source.getClusterExpansionZoom(clusterId,(error,zoom)=>{
            if(error||zoom===undefined)return;
            map.easeTo({center:(feature.geometry as GeoJSON.Point).coordinates as [number,number],zoom});
          });
        });
        map.on("click","mobile-venue-pins",e=>{
          const feature=e.features?.[0];
          const index=Number(feature?.properties?.index);
          const venue=mapped[index];
          if(venue){setSelected(venue);map.easeTo({center:[venue.lng,venue.lat],zoom:Math.max(map.getZoom(),13),duration:550});}
        });
        ["mobile-clusters","mobile-venue-pins"].forEach(layer=>{
          map.on("mouseenter",layer,()=>{map.getCanvas().style.cursor="pointer"});
          map.on("mouseleave",layer,()=>{map.getCanvas().style.cursor=""});
        });
      }
      if(mapped.length){
        const bounds=new mapboxgl.LngLatBounds();mapped.forEach(v=>bounds.extend([v.lng,v.lat]));
        if(mapped.length===1)map.easeTo({center:[mapped[0].lng,mapped[0].lat],zoom:13,duration:500});
        else map.fitBounds(bounds,{padding:{top:38,right:28,bottom:38,left:28},maxZoom:9.8,duration:650});
      }
    };
    setSelected(null);
    map.loaded()?render():map.once("load",render);
  },[mapped]);

  const activePlaces=filtered.filter(v=>score(v)>=52&&v.openNow!==false).length;
  const rising=filtered.filter(v=>v.activity?.trendLabel?.toLowerCase().includes("busier")).length;
  const pulseText=active==="All"?`${activePlaces} active places across Hampton Roads`:`${activePlaces} active ${active.toLowerCase()} spots right now`;

  return <div className="mobile-native-home lg:hidden">
    <header className="mobile-native-header"><div className="mobile-native-brand"><strong>757</strong><span>THINGS TO DO</span></div><div className="mobile-native-actions"><button aria-label="Search"><Search/></button><button aria-label="Saved places"><Bookmark/></button><button className="mobile-avatar" aria-label="Profile">D<i/></button></div></header>
    <main className="mobile-native-scroll">
      <section className="mobile-native-pulse"><div className="pulse-kicker"><b/> LIVE NOW <span>Updated just now</span></div><h1>{active==="All"?"What’s happening around you":"What’s happening in "+active}</h1><div className="pulse-summary"><strong>{pulseText}</strong>{rising>0&&<span>🔥 {rising} heating up</span>}</div></section>
      <section className="mobile-native-map"><div ref={mapEl} className="mobile-native-mapbox"/><div className="map-key"><span><i className="quiet"/>Quiet</span><span><i className="moderate"/>Moderate</span><span><i className="busy"/>Busy</span><span><i className="hot"/>Very busy</span></div>{selected&&<article className="map-preview"><button className="map-preview-close" onClick={()=>setSelected(null)} aria-label="Close preview"><X/></button><div className="map-preview-photo">{selected.photoUrl?<img src={selected.photoUrl} alt=""/>:selected.name.slice(0,1)}</div><div><span className="map-preview-score">{score(selected)}</span><strong>{selected.name}</strong><small>{selected.activity?.trendLabel||"Steady"} · {selected.activity?.label||"Active now"}</small><p>{selected.event?.name?`🎟 ${selected.event.name}`:selected.reason||"Popular nearby right now"}</p></div><ChevronRight/></article>}</section>
      <nav className="mobile-category-rail">{cats.map(([label,Icon])=><button key={label} className={active===label?"active":""} onClick={()=>setActive(label)}><span><Icon/></span><small>{label}</small></button>)}</nav>
      <section className="mobile-native-feed"><div className="feed-title"><h2>{active==="All"?"Live Activity Feed":active} <span>{filtered.length}</span></h2><button onClick={()=>setActive("All")}>All places <ChevronRight/></button></div><div className="feed-list">{filtered.map((v,i)=><article className="feed-row" key={v.id} onClick={()=>{setSelected(v);if(validVenue(v))mapRef.current?.easeTo({center:[v.lng,v.lat],zoom:13,duration:550})}}><div className="feed-photo">{v.photoUrl?<img src={v.photoUrl} alt=""/>:v.name.slice(0,1)}</div><div className={`feed-score s${i%4}`}>{score(v)}</div><div className="feed-copy"><strong>{v.name}</strong><span><b>{v.activity?.trendLabel||"Steady"}</b> · {v.activity?.label||"Active now"}</span><small>{v.event?.name?`🎟 ${v.event.name}`:`☆ ${v.reason||"Popular nearby right now"}`}</small></div><div className="feed-meta"><span>{i===0?"Just now":`${Math.min(59,i*2+1)}m ago`}</span><ChevronRight/><Heart/></div></article>)}</div></section>
      <button className="mobile-plan-card"><span className="plan-orb"><Sparkles/></span><span><strong>Plan my night</strong><small>AI-powered recommendations<br/>built around you</small></span><b>Get started <ChevronRight/></b></button>
    </main>
    <nav className="mobile-native-bottom"><button className="active"><span><Compass/></span><small>Explore</small></button><button><span><Map/></span><small>Map</small></button><button><span><Heart/></span><small>Favorites</small></button><button><span><Bell/><i/></span><small>Alerts</small></button><button><span><CalendarDays/></span><small>Plans</small></button></nav>
  </div>;
}