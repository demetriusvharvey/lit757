import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(content, before, after, label) {
  if (content.includes(after)) return content;
  if (!content.includes(before)) throw new Error(`Could not find ${label}`);
  return content.replace(before, after);
}

function patchFile(path, transform) {
  const current = readFileSync(path, "utf8");
  const next = transform(current);
  if (next !== current) {
    writeFileSync(path, next);
    console.log(`Updated ${path}`);
  } else {
    console.log(`No change needed for ${path}`);
  }
}

patchFile("app/api/discover/route.ts", content => {
  let next = replaceOnce(
    content,
    'import { inferInterestTags } from "../../../src/lib/interest-tags";\n',
    'import { inferInterestTags } from "../../../src/lib/interest-tags";\nimport { getVenueImage } from "../../../src/lib/venue-image";\n',
    "discover image resolver import",
  );

  next = replaceOnce(
    next,
    `  const photoUrl =\n    venue.photo_source === "google_streetview" && venue.google_place_id\n      ? \`/api/venue-photo?placeId=\${encodeURIComponent(venue.google_place_id)}\`\n      : null;`,
    `  const photoUrl = getVenueImage({\n    name: venue.name,\n    kind: venue.kind,\n    category: venue.category,\n    type: venue.type,\n    googlePlaceId: venue.google_place_id,\n    lat: venue.lat,\n    lng: venue.lng,\n  });`,
    "discover photo URL gate",
  );
  return next;
});

patchFile("app/api/me/likes/route.ts", content => {
  let next = replaceOnce(
    content,
    'import { getRequestUser } from "../../../../src/lib/server-auth";\n',
    'import { getRequestUser } from "../../../../src/lib/server-auth";\nimport { getVenueImage } from "../../../../src/lib/venue-image";\n',
    "saved places image resolver import",
  );

  next = replaceOnce(
    next,
    '.select("id,name,city,type,google_place_id,photo_source")',
    '.select("id,name,city,type,category,lat,lng,google_place_id,photo_source")',
    "saved places image fields",
  );

  next = replaceOnce(
    next,
    `      photoUrl:\n        venue.photo_source === "google_streetview" && venue.google_place_id\n          ? \`/api/venue-photo?placeId=\${encodeURIComponent(venue.google_place_id)}\`\n          : null,`,
    `      photoUrl: getVenueImage({\n        name: venue.name,\n        category: venue.category,\n        type: venue.type,\n        googlePlaceId: venue.google_place_id,\n        lat: venue.lat,\n        lng: venue.lng,\n      }),`,
    "saved places photo URL gate",
  );
  return next;
});

patchFile("app/api/nearby/route.ts", content => {
  let next = replaceOnce(
    content,
    'import { createClient } from "@supabase/supabase-js";\n',
    'import { createClient } from "@supabase/supabase-js";\nimport { getVenueImage } from "../../../src/lib/venue-image";\n',
    "nearby image resolver import",
  );

  next = replaceOnce(
    next,
    `    const imageParams = new URLSearchParams({\n      name: String(venue.name || "Local place"),\n      category: kind,\n      lat: String(venueLat),\n      lng: String(venueLng),\n    });\n    if (venue.google_place_id) imageParams.set("placeId", String(venue.google_place_id));\n    const photoUrl = \`/api/venue-photo?\${imageParams.toString()}\`;`,
    `    const photoUrl = getVenueImage({\n      name: venue.name,\n      kind,\n      category: venue.category,\n      type: venue.type,\n      googlePlaceId: venue.google_place_id,\n      lat: venueLat,\n      lng: venueLng,\n    });`,
    "nearby inline image resolver",
  );
  return next;
});

patchFile("app/account-panel.tsx", content => {
  let next = replaceOnce(
    content,
    'import { FormEvent, useEffect, useState, type ReactNode } from "react";\n',
    'import { FormEvent, useEffect, useState, type ReactNode } from "react";\nimport Image from "next/image";\n',
    "saved card Image import",
  );

  next = replaceOnce(
    next,
    '                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-black/[0.055] text-[13px] font-semibold text-black/42">{place.name.slice(0, 1).toUpperCase()}</span>',
    `                      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-black/[0.055] text-[13px] font-semibold text-black/42">\n                        {place.photoUrl ? (\n                          <Image src={place.photoUrl} alt={\`\${place.name} venue\`} fill unoptimized sizes="40px" className="object-cover" />\n                        ) : (\n                          place.name.slice(0, 1).toUpperCase()\n                        )}\n                      </span>`,
    "saved place thumbnail",
  );
  return next;
});
