"use client";

import mapboxgl from "mapbox-gl";

let installed=false;

export default function MapLayerGuard(){
  if(!installed&&typeof window!=="undefined"){
    installed=true;
    const originalAddLayer=mapboxgl.Map.prototype.addLayer;
    mapboxgl.Map.prototype.addLayer=function(layer:any,beforeId?:string){
      if(layer?.id==="mobile-clusters"||layer?.id==="mobile-cluster-count")layer={...layer,minzoom:0};
      if(layer?.id==="mobile-venue-pins")layer={...layer,minzoom:7.5};
      return originalAddLayer.call(this,layer,beforeId);
    } as typeof mapboxgl.Map.prototype.addLayer;
  }
  return null;
}
