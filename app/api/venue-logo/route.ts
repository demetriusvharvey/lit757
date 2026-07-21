import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 2_500_000;
const MAX_HTML_BYTES = 600_000;

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[character] || character));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || "")
    .join("") || "B";
}

function fallbackLogo(name: string, reason = "fallback") {
  const safeName = escapeXml(name || "Local business");
  const safeInitials = escapeXml(initials(name));
  const hue = [...name].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 58% 38%)"/><stop offset="1" stop-color="hsl(${(hue + 44) % 360} 58% 19%)"/></linearGradient></defs><rect width="192" height="192" rx="42" fill="#fff"/><rect x="8" y="8" width="176" height="176" rx="36" fill="url(#g)"/><text x="96" y="111" text-anchor="middle" fill="#fff" font-size="62" font-weight="800" font-family="Arial, sans-serif">${safeInitials}</text><title>${safeName}</title></svg>`;
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "X-Venue-Logo-Source": "buzz-monogram",
      "X-Venue-Logo-Reason": encodeURIComponent(reason.slice(0, 100)),
    },
  });
}

function privateIpv4(address: string) {
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function privateIp(address: string) {
  if (isIP(address) === 4) return privateIpv4(address);
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

async function safeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported protocol");
  if (url.username || url.password) throw new Error("Credentials are not allowed");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Unsupported port");
  if (url.hostname === "localhost" || url.hostname.endsWith(".local")) throw new Error("Private host");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(result => privateIp(result.address))) throw new Error("Private address");
  return url;
}

async function fetchSafe(urlValue: string, accept: string, maxRedirects = 3) {
  let current = await safeUrl(urlValue);
  for (let index = 0; index <= maxRedirects; index += 1) {
    const response = await fetch(current, {
      cache: "no-store",
      redirect: "manual",
      headers: {
        Accept: accept,
        "User-Agent": "BuzzVenueLogo/1.0 (+https://lit757.vercel.app)",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || index === maxRedirects) throw new Error("Too many redirects");
      current = await safeUrl(new URL(location, current).toString());
      continue;
    }
    return response;
  }
  throw new Error("Redirect failed");
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1]?.trim() || null;
}

function logoCandidates(html: string, base: URL) {
  const weighted: Array<{ url: string; weight: number }> = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = String(attribute(tag, "rel") || "").toLowerCase();
    const href = attribute(tag, "href");
    if (!href || !/icon/.test(rel)) continue;
    const sizes = String(attribute(tag, "sizes") || "").toLowerCase();
    const weight = /apple-touch-icon/.test(rel) ? 100 : /192|180|512/.test(sizes) ? 90 : /shortcut/.test(rel) ? 60 : 70;
    try { weighted.push({ url: new URL(href, base).toString(), weight }); } catch { /* Ignore invalid links. */ }
  }

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const key = String(attribute(tag, "property") || attribute(tag, "name") || attribute(tag, "itemprop") || "").toLowerCase();
    const content = attribute(tag, "content");
    if (!content || !/logo|tileimage/.test(key)) continue;
    try { weighted.push({ url: new URL(content, base).toString(), weight: 95 }); } catch { /* Ignore invalid links. */ }
  }

  for (const match of html.matchAll(/["']logo["']\s*:\s*["']([^"']+)["']/gi)) {
    try { weighted.push({ url: new URL(match[1], base).toString(), weight: 92 }); } catch { /* Ignore invalid links. */ }
  }

  return [...new Map(weighted.sort((left, right) => right.weight - left.weight).map(item => [item.url, item])).values()];
}

async function imageResponse(response: Response, source: string) {
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return null;
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      "X-Venue-Logo-Source": source,
    },
  });
}

async function fromBrandfetch(domain: string) {
  const clientId = process.env.BRANDFETCH_CLIENT_ID || process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  if (!clientId) return null;
  const url = `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/h/192/w/192/icon.png?c=${encodeURIComponent(clientId)}`;
  const response = await fetch(url, {
    next: { revalidate: 604800 },
    signal: AbortSignal.timeout(8_000),
  });
  return imageResponse(response, "brandfetch");
}

async function fromOfficialWebsite(website: URL) {
  const homepage = new URL("/", website).toString();
  const response = await fetchSafe(homepage, "text/html,application/xhtml+xml");
  if (!response.ok) return null;
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_HTML_BYTES) return null;
  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  for (const candidate of logoCandidates(html, new URL(response.url || homepage)).slice(0, 8)) {
    try {
      const image = await fetchSafe(candidate.url, "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*");
      const proxied = await imageResponse(image, "official-website");
      if (proxied) return proxied;
    } catch {
      // Try the next official asset.
    }
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = String(url.searchParams.get("name") || "Local business").slice(0, 120);
  const websiteValue = String(url.searchParams.get("website") || "").trim();
  if (!websiteValue) return fallbackLogo(name, "website-missing");

  try {
    const website = await safeUrl(websiteValue.startsWith("http") ? websiteValue : `https://${websiteValue}`);
    const domain = website.hostname.replace(/^www\./i, "");
    const branded = await fromBrandfetch(domain);
    if (branded) return branded;
    const official = await fromOfficialWebsite(website);
    if (official) return official;
    return fallbackLogo(name, "official-logo-not-found");
  } catch (error) {
    return fallbackLogo(name, error instanceof Error ? error.message : "logo-error");
  }
}
