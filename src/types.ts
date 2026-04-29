export type Vibe = "lit" | "decent" | "dead" | "line_crazy";

export type Venue = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  score?: number;
  status?: "lit" | "decent" | "dead";
  lastUpdated?: string | null;
};