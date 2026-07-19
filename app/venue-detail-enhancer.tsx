"use client";

import { useEffect } from "react";

const escapeSelector=(value:string)=>value.replace(/["\\]/g,"\\$&");

export default function VenueDetailEnhancer(){
  useEffect(()=>{
    const enhance=()=>{
      document.querySelectorAll<HTMLElement>(".utility-sheet").forEach(sheet=>{
        if(!sheet.textContent?.includes("LIVE SCORE")||sheet.dataset.venueEnhanced==="true")return;
        sheet.dataset.venueEnhanced="true";
        sheet.classList.add("venue-detail-sheet");

        const title=sheet.querySelector<HTMLHeadingElement>(".utility-head h2")?.textContent?.trim()||"This place";
        const directions=[...sheet.querySelectorAll<HTMLButtonElement>("button")].find(button=>button.textContent?.includes("Get directions"));
        if(!directions)return;

        const proof=document.createElement("div");
        proof.className="venue-detail-proof";
        proof.innerHTML="<span><strong>Live activity</strong>Updated now</span><span><strong>Local momentum</strong>30-minute trend</span><span><strong>Smart timing</strong>Arrival guidance</span>";
        directions.insertAdjacentElement("afterend",proof);

        const actions=document.createElement("div");
        actions.className="venue-detail-actions";

        const save=document.createElement("button");
        save.type="button";
        save.className="venue-detail-secondary";
        save.setAttribute("aria-label",`Save ${title}`);
        const matchingRow=[...document.querySelectorAll<HTMLElement>(".feed-row")].find(row=>row.querySelector(".feed-copy strong")?.textContent?.trim()===title);
        const favorite=matchingRow?.querySelector<HTMLButtonElement>(".favorite-toggle");
        const syncSave=()=>{const saved=favorite?.classList.contains("saved")??false;save.classList.toggle("saved",saved);save.textContent=saved?"♥ Saved":"♡ Save place";};
        syncSave();
        save.addEventListener("click",()=>{favorite?.click();window.setTimeout(syncSave,0);});

        const share=document.createElement("button");
        share.type="button";
        share.className="venue-detail-secondary";
        share.textContent="↗ Share";
        share.setAttribute("aria-label",`Share ${title}`);
        share.addEventListener("click",async()=>{
          const data={title:`${title} on LIT757`,text:`Check out ${title} on LIT757.`,url:window.location.href};
          try{if(navigator.share)await navigator.share(data);else{await navigator.clipboard.writeText(window.location.href);share.textContent="✓ Link copied";window.setTimeout(()=>share.textContent="↗ Share",1600);}}catch{}
        });

        actions.append(save,share);
        proof.insertAdjacentElement("afterend",actions);
      });
    };

    enhance();
    const observer=new MutationObserver(enhance);
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>observer.disconnect();
  },[]);

  return null;
}
