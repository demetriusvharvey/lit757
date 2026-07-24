"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";

type RemoteVenueImageProps = {
  src?: string | null;
  alt: string;
  fallback: ReactNode;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
};

/**
 * Shared image boundary for provider-controlled venue media.
 *
 * Venue URLs come from several providers whose hostnames change over time.
 * `unoptimized` keeps Next.js in charge of sizing, lazy loading, and layout
 * without opening the image optimizer to arbitrary remote hosts. Failed
 * provider images fall back to a stable local initial instead of a broken icon.
 */
export function RemoteVenueImage({
  src,
  alt,
  fallback,
  width = 320,
  height = 240,
  sizes = "(max-width: 1023px) 96px, 240px",
  priority = false,
  className,
}: RemoteVenueImageProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!src || failedSource === src) return <>{fallback}</>;

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      priority={priority}
      unoptimized
      className={className}
      onError={() => setFailedSource(src)}
    />
  );
}
