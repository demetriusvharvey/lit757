import { unstable_cache } from "next/cache";
import { fetchOsmVenueCandidates } from "./osm";

export const getCachedOsmVenueCandidates = unstable_cache(
  fetchOsmVenueCandidates,
  ["buzz-hampton-roads-osm-venues-v1"],
  { revalidate: 21_600 },
);
