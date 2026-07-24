"use client";

import { useEffect } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapController } from "./map-controller";

export default function MapLayerGuard(){
  const {map,setSelectedVenueId}=useMapController();

  useEffect(()=>{
    if(!map)return;
    let cancelled=false;
    let retryTimer:number|undefined;

    const selectFeature=(feature?:mapboxgl.MapboxGeoJSONFeature)=>{
      const venueId=String(feature?.properties?.id||"");
      if(!venueId)return;
      setSelectedVenueId(venueId);
      if(feature?.geometry.type==="Point"){
        map.easeTo({center:feature.geometry.coordinates as [number,number],zoom:Math.max(map.getZoom(),13),duration:500});
      }
    };

    const onLiveClick=(event:mapboxgl.MapLayerMouseEvent)=>selectFeature(event.features?.[0]);
    const onVenueClick=(event:mapboxgl.MapLayerMouseEvent)=>selectFeature(event.features?.[0]);
    const onEnter=()=>{map.getCanvas().style.cursor="pointer";};
    const onLeave=()=>{map.getCanvas().style.cursor="";};

    const install=()=>{
      if(cancelled)return;
      const liveSource=map.getSource("mobile-live-dots");
      const venueSource=map.getSource("mobile-venues");
      if(!liveSource||!venueSource){retryTimer=window.setTimeout(install,120);return;}

      if(!map.getLayer("mobile-live-hit"))map.addLayer({
        id:"mobile-live-hit",
        type:"circle",
        source:"mobile-live-dots",
        paint:{"circle-radius":18,"circle-color":"rgba(0,0,0,0.01)","circle-opacity":0.01,"circle-stroke-width":0},
      });
      if(!map.getLayer("mobile-venue-hit"))map.addLayer({
        id:"mobile-venue-hit",
        type:"circle",
        source:"mobile-venues",
        filter:["!",["has","point_count"]],
        minzoom:7.5,
        paint:{"circle-radius":20,"circle-color":"rgba(0,0,0,0.01)","circle-opacity":0.01,"circle-stroke-width":0},
      });

      map.on("click","mobile-live-hit",onLiveClick);
      map.on("click","mobile-venue-hit",onVenueClick);
      map.on("mouseenter","mobile-live-hit",onEnter);
      map.on("mouseleave","mobile-live-hit",onLeave);
      map.on("mouseenter","mobile-venue-hit",onEnter);
      map.on("mouseleave","mobile-venue-hit",onLeave);
    };

    if(map.isStyleLoaded())install();else map.once("load",install);
    return()=>{
      cancelled=true;
      if(retryTimer)window.clearTimeout(retryTimer);
      if(map.getLayer("mobile-live-hit")){
        map.off("click","mobile-live-hit",onLiveClick);
        map.off("mouseenter","mobile-live-hit",onEnter);
        map.off("mouseleave","mobile-live-hit",onLeave);
      }
      if(map.getLayer("mobile-venue-hit")){
        map.off("click","mobile-venue-hit",onVenueClick);
        map.off("mouseenter","mobile-venue-hit",onEnter);
        map.off("mouseleave","mobile-venue-hit",onLeave);
      }
    };
  },[map,setSelectedVenueId]);

  return null;
}
