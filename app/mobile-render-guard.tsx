"use client";

import { useEffect } from "react";

export default function MobileRenderGuard() {
  useEffect(() => {
    document.documentElement.classList.add("mobile-home-mounted");
    return () => document.documentElement.classList.remove("mobile-home-mounted");
  }, []);

  return null;
}
