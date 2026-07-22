import { mkdir, writeFile } from "node:fs/promises";

const outputDir = "tourism-source-probe/newport-news-details";
await mkdir(outputDir, { recursive: true });

const urls = [
  "https://www.visitnewportnews.com/event/alex-mcquilkin%3a-magic-moments-(technology-transformation-wonder-woman)/1903/",
  "https://www.visitnewportnews.com/event/live-music-zen-mojo/1911/",
];

const report = [];
for (const url of urls) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "User-Agent": "BuzzOfficialTourismProbe/1.0",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });
    const body = await response.text();
    const markers = {
      jsonLd: /application\/ld\+json/i.test(body),
      eventType: /["']@type["']\s*:\s*["']Event["']/i.test(body),
      startDate: /startDate/i.test(body),
      endDate: /endDate/i.test(body),
      location: /["']location["']\s*:/i.test(body),
      address: /streetAddress|postalAddress/i.test(body),
      eventStartMeta: /event:start_time/i.test(body),
      eventEndMeta: /event:end_time/i.test(body),
      simpleviewEvent: /plugins_events/i.test(body),
    };
    const jsonLdBlocks = [...body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
      .map(match => match[1].trim())
      .slice(0, 10);
    const meta = [...body.matchAll(/<meta[^>]+(?:property|name|itemprop)=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi)]
      .map(match => ({ key: match[1], value: match[2] }))
      .filter(item => /event|date|location|address|og:|description/i.test(item.key))
      .slice(0, 80);
    report.push({ url, status: response.status, finalUrl: response.url, length: body.length, markers, jsonLdBlocks, meta });
    await writeFile(`${outputDir}/${url.split('/').filter(Boolean).at(-2)}.html`, body.slice(0, 1_500_000));
    console.log(JSON.stringify({ url, status: response.status, length: body.length, markers, jsonLdBlocks, meta }, null, 2));
  } catch (error) {
    report.push({ url, error: error instanceof Error ? error.message : String(error) });
  }
}

await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
