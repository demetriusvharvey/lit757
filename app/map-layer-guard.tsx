"use client";

import mapboxgl from "mapbox-gl";

let installed=false;

const HIT_LAYERS:Record<string,string>={
  "mobile-live-dot":"mobile-live-hit",
  "mobile-venue-pins":"mobile-venue-hit",
};

export default function MapLayerGuard(){
  if(!installed&&typeof window!=="undefined"){
    installed=true;

    const mapPrototype=mapboxgl.Map.prototype as any;
    const originalAddLayer=mapPrototype.addLayer;
    const originalOn=mapPrototype.on;

    mapPrototype.addLayer=function(layer:any,beforeId?:string){
      let nextLayer=layer;
      if(layer?.id==="mobile-clusters"||layer?.id==="mobile-cluster-count")nextLayer={...layer,minzoom:0};
      if(layer?.id==="mobile-venue-pins")nextLayer={...layer,minzoom:7.5};

      const result=originalAddLayer.call(this,nextLayer,beforeId);
      const hitLayerId=HIT_LAYERS[nextLayer?.id];

      if(hitLayerId&&!this.getLayer(hitLayerId)){
        const visualRadius=nextLayer?.id==="mobile-live-dot"?18:20;
        originalAddLayer.call(this,{
          id:hitLayerId,
          type:"circle",
          source:nextLayer.source,
          ...(nextLayer["source-layer"]?{"source-layer":nextLayer["source-layer"]}:{}),
          ...(nextLayer.filter?{filter:nextLayer.filter}:{}),
          minzoom:nextLayer?.id==="mobile-venue-pins"?7.5:0,
          maxzoom:nextLayer.maxzoom,
          paint:{
            "circle-radius":visualRadius,
            "circle-color":"rgba(0,0,0,0.01)",
            "circle-opacity":0.01,
            "circle-stroke-width":0,
          },
        },beforeId);
      }

      return result;
    };

    mapPrototype.on=function(type:string,layerOrListener:any,listener?:any){
      const result=originalOn.apply(this,arguments as any);
      if(typeof layerOrListener==="string"&&typeof listener==="function"){
        const hitLayerId=HIT_LAYERS[layerOrListener];
        if(hitLayerId){
          originalOn.call(this,type,hitLayerId,listener);
        }
      }
      return result;
    };
  }

  return null;
}
