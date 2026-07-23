import type { Metadata } from "next";
import LiveClient from "./live-client";

export const metadata: Metadata = {
  title: "Buzz Live — Real-time activity in the 757",
  description: "See what is active now, what is rising, and what a place should feel like when you arrive.",
};

export default function LivePage() {
  return <LiveClient />;
}
