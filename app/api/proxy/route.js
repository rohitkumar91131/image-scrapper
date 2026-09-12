import { NextResponse } from "next/server";

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];

function buildImageHeaders(imageUrl) {
  const ua = UAS[Math.floor(Math.random() * UAS.length)];
  let origin = "";
  try {
    origin = new URL(imageUrl).origin;
  } catch {}
  return {
    "User-Agent": ua,
    Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Referer: origin ? origin + "/" : "https://www.google.com/",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "cross-site",
    Connection: "keep-alive",
  };
}

/**
 * Proxy to fetch images server-side to avoid CORS blocks.
 * Universal: retry on ECONNRESET, 429, 5xx, with exponential backoff
 * Usage: /api/proxy?url=https://example.com/image.jpg
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const u = new URL(imageUrl);
    if (!["http:", "https:"].includes(u.protocol)) {
      return NextResponse.json({ error: "Invalid protocol" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  let lastErr;
  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(imageUrl, {
        headers: buildImageHeaders(imageUrl),
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });

      if (!response.ok) {
        // Retry on 429, 5xx, 408, 403
        if ([429, 500, 502, 503, 504, 408, 403].includes(response.status) && attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 600 + Math.random() * 400;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return NextResponse.json(
          { error: `Failed to fetch image: ${response.status} ${response.statusText}` },
          { status: response.status }
        );
      }

      const contentType = response.headers.get("content-type") || "application/octet-stream";
      const buffer = await response.arrayBuffer();

      // Basic validation: if content is HTML instead of image, return error (anti-bot page)
      if (contentType.includes("text/html") && buffer.byteLength < 8000) {
        const text = new TextDecoder().decode(buffer.slice(0, 2000)).toLowerCase();
        if (text.includes("<html") || text.includes("cloudflare") || text.includes("access denied")) {
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 600 + Math.random() * 400;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return NextResponse.json({ error: "Image blocked by remote (HTML returned instead of image)" }, { status: 403 });
        }
      }

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": buffer.byteLength.toString(),
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        },
      });
    } catch (err) {
      lastErr = err;
      const msg = (err.message || "").toLowerCase();
      const isRetryable =
        err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        msg.includes("econnreset") ||
        msg.includes("socket hang up") ||
        msg.includes("terminated") ||
        msg.includes("fetch failed");

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 700 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const message =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? "Image fetch timed out after 15s"
          : msg.includes("econnreset")
          ? "Connection reset (ECONNRESET) — retrying failed"
          : err.message || "Failed to proxy image";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
  return NextResponse.json({ error: lastErr?.message || "Failed after retries" }, { status: 500 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
