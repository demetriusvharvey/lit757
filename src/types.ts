export type Vibe = "lit" | "decent" | "dead" | "line_crazy";

export type Venue = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  type?: string | null;
  category?: string | null;
  music_genre?: string | null;
  age_limit?: string | null;
  cover?: string | null;
  parking?: string | null;
  dress_code?: string | null;
  score?: number;
  status?: "lit" | "decent" | "dead";
  lastUpdated?: string | null;
  tonightEvent?: Event | null;
};

export type Event = {
  id: string;
  venue_id: string;
  title: string;
  event_date: string;
  start_time?: string | null;
  genre?: string | null;
  dj?: string | null;
  cover_price?: string | null;
  dress_code?: string | null;
  description?: string | null;
  created_at?: string | null;
};