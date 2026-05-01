import dotenv from "dotenv";
import path from "path";
import { createClient } from "@supabase/supabase-js";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
});

console.log("ENV CHECK:");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "Loaded" : "Missing");
console.log(
  "SUPABASE_KEY:",
  process.env.SUPABASE_SERVICE_ROLE_KEY ? "Loaded" : "Missing"
);
console.log("FSQ_KEY:", process.env.FSQ_API_KEY ? "Loaded" : "Missing");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_KEY = process.env.FSQ_API_KEY;

async function getVenuePhoto(placeId) {
  const res = await fetch(
    `https://places-api.foursquare.com/places/${placeId}/photos?limit=1`,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        Accept: "application/json",
        "X-Places-Api-Version": "2025-06-17",
      },
    }
  );

  if (!res.ok) {
    console.log("Photo API failed:", res.status, await res.text());
    return null;
  }

  const photos = await res.json();

  if (!Array.isArray(photos) || photos.length === 0) {
    return null;
  }

  const photo = photos[0];
  return `${photo.prefix}original${photo.suffix}`;
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !API_KEY) {
    console.log("❌ Missing env vars. Fix .env.local first.");
    return;
  }

  const { data: venues, error } = await supabase
    .from("venues")
    .select("*")
    .is("photo_url", null);

  if (error) {
    console.error("❌ Supabase fetch error:", error);
    return;
  }

  console.log(`Found ${venues.length} venues missing photos`);

  for (const venue of venues) {
    console.log(`\nProcessing: ${venue.name}`);

    try {
      if (!venue.lat || !venue.lng) {
        console.log("⚠️ Missing lat/lng");
        continue;
      }

      const searchUrl =
        `https://places-api.foursquare.com/places/search?query=${encodeURIComponent(
          venue.name
        )}` + `&ll=${venue.lat},${venue.lng}&limit=3`;

      const searchRes = await fetch(searchUrl, {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          Accept: "application/json",
          "X-Places-Api-Version": "2025-06-17",
        },
      });

      if (!searchRes.ok) {
        console.log("❌ Search failed:", searchRes.status, await searchRes.text());
        continue;
      }

      const searchData = await searchRes.json();
      const place = searchData.results?.[0];

      if (!place) {
        console.log("⚠️ No Foursquare match");
        continue;
      }

      console.log("Matched:", place.name);

      const photoUrl = await getVenuePhoto(place.fsq_place_id);

      if (!photoUrl) {
        console.log("⚠️ No photo found");
        continue;
      }

      const { error: updateError } = await supabase
        .from("venues")
        .update({
          fsq_id: place.fsq_place_id,
          photo_url: photoUrl,
          photo_source: "foursquare",
        })
        .eq("id", venue.id);

      if (updateError) {
        console.log("❌ Supabase update failed:", updateError.message);
        continue;
      }

      console.log("✅ Saved photo:", venue.name);

      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (err) {
      console.log("❌ Error:", err.message);
    }
  }

  console.log("\n🔥 DONE");
}

run();