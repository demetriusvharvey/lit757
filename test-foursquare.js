const API_KEY = process.env.FSQ_API_KEY;

async function test() {
  const res = await fetch(
    "https://places-api.foursquare.com/places/search?query=The%20Norva&ll=36.8508,-76.2859",
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "X-Places-Api-Version": "2025-06-17",
      },
    }
  );

  console.log("STATUS:", res.status);
  console.log(await res.text());
}

test().catch(console.error);