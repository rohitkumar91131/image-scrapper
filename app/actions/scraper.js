"use server";

import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import http from "http";

// Keep-alive agents for universal compatibility (e-commerce, CDN, adult)
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });
const httpAgent = new http.Agent({ keepAlive: true });

// ZenRows — set ZENROWS_API_KEY in .env (local) and Vercel env (prod)
// When present, all fetches go via residential premium_proxy (bypasses Vercel IP + ISP block)
function getZenRowsUrl(pageUrl) {
  const key = process.env.ZENROWS_API_KEY;
  if (!key) return null;
  // premium_proxy=true = residential IP (for adult/Cloudflare), js_render=false = cheaper, set true if site needs JS
  return `https://api.zenrows.com/v1/?apikey=${key}&url=${encodeURIComponent(pageUrl)}&premium_proxy=true`;
}

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];

function buildHeaders(targetUrl) {
  const ua = UAS[Math.floor(Math.random() * UAS.length)];
  let origin = "https://www.google.com/";
  try {
    origin = new URL(targetUrl).origin;
  } catch {}
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: origin + "/",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    Connection: "keep-alive",
  };
}

/**
 * Extract highest resolution from srcset / data-srcset
 * Per spec: usually last item is highest; we also handle w/x descriptors
 */
function pickHighestFromSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") return null;
  const entries = srcset
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(/\s+/);
      const url = parts[0]?.trim();
      const descriptor = parts[1]?.trim() || "";
      let score = 0;
      if (descriptor.endsWith("w")) score = parseInt(descriptor.slice(0, -1), 10) || 0;
      else if (descriptor.endsWith("x")) {
        const v = parseFloat(descriptor.slice(0, -1));
        score = isNaN(v) ? 0 : v * 1000;
      }
      return { url, score };
    })
    .filter((e) => e.url);
  if (entries.length === 0) return null;
  const hasScore = entries.some((e) => e.score > 0);
  if (!hasScore) return entries[entries.length - 1].url; // last = highest per spec
  entries.sort((a, b) => b.score - a.score);
  return entries[0].url;
}

function sanitizeTitle(raw) {
  if (!raw) return "Product_Images";
  let t = raw.replace(/[<>:"/\\|?*]+/g, "").trim();
  t = t.replace(/\s+/g, " ").substring(0, 100).trim();
  return t || "Product_Images";
}

function isValidImageHref(href) {
  if (!href || typeof href !== "string") return false;
  href = href.trim().replace(/&quot;/g, "");
  // Must point to image file per spec: .jpg, .png, .jpeg, .webp, .avif, .gif, .svg
  if (!href.match(/\.(jpg|jpeg|png|webp|avif|gif|svg)(\?.*)?$/i)) return false;
  // Accept absolute, protocol-relative, or root-relative
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//") || href.startsWith("/")) return true;
  // Also accept relative with image extension (e.g., images/pic.jpg)
  if (href.match(/^[^?#]+\.(jpg|jpeg|png|webp|avif|gif|svg)/i)) return true;
  return false;
}

async function fetchHtmlWithRetry(pageUrl, maxRetries = 3) {
  const zenUrl = getZenRowsUrl(pageUrl);
  // If ZenRows is configured, use it directly (no retry needed for IP block)
  if (zenUrl) {
    try {
      const { data } = await axios.get(zenUrl, {
        timeout: 20000, // ZenRows needs more time for premium proxy
        headers: buildHeaders(pageUrl),
        validateStatus: (s) => s >= 200 && s < 400,
        maxRedirects: 5,
        responseType: "text",
        decompress: true,
        httpAgent,
        httpsAgent,
      });
      if (typeof data === "string" && data.length > 0) return data;
      // ZenRows sometimes returns JSON with error
      if (typeof data === "object" && data.html) return data.html;
      throw new Error("Empty ZenRows response");
    } catch (err) {
      // Fall through to direct fetch if ZenRows fails (invalid key, etc.)
      console.warn("ZenRows failed, falling back to direct:", err.message?.slice(0,120));
    }
  }

  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.get(pageUrl, {
        timeout: 10000, // spec: 10s
        headers: buildHeaders(pageUrl),
        validateStatus: (s) => s >= 200 && s < 400,
        maxRedirects: 5,
        responseType: "text",
        decompress: true,
        httpAgent,
        httpsAgent,
        family: attempt > 1 ? 4 : undefined, // IPv4 fallback helps ECONNRESET on some hosts
      });
      if (typeof data === "string" && data.length > 0) return data;
      throw new Error("Empty response from server");
    } catch (err) {
      lastErr = err;
      const code = err.code || "";
      const status = err.response?.status;
      const msg = (err.message || "").toLowerCase();
      const isRetryable =
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "ECONNABORTED" ||
        code === "EAI_AGAIN" ||
        code === "ENOTFOUND" ||
        code === "EPIPE" ||
        code === "ECONNREFUSED" ||
        msg.includes("econnreset") ||
        msg.includes("socket hang up") ||
        msg.includes("read econnreset") ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        status === 408 ||
        status === 403;
      if (attempt < maxRetries && isRetryable) {
        const delay = Math.pow(2, attempt) * 700 + Math.random() * 500;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function scrapeImages(pageUrl) {
  if (!pageUrl || typeof pageUrl !== "string") {
    return { success: false, error: "URL is required" };
  }
  pageUrl = pageUrl.trim();
  try {
    const u = new URL(pageUrl);
    if (!["http:", "https:"].includes(u.protocol)) {
      return { success: false, error: "URL must start with http:// or https://" };
    }
  } catch {
    return { success: false, error: "Invalid URL format" };
  }

  function getAlternateUrls(original) {
    try {
      const u = new URL(original);
      const variants = new Set();
      const host = u.hostname;
      const path = u.pathname + u.search + u.hash;
      // toggle www
      const withoutWww = host.startsWith("www.") ? host.slice(4) : host;
      const withWww = host.startsWith("www.") ? host : `www.${host}`;
      for (const h of [host, withoutWww, withWww]) {
        for (const proto of ["https:", "http:"]) {
          variants.add(`${proto}//${h}${path}`);
        }
      }
      variants.delete(original);
      return Array.from(variants).slice(0, 3);
    } catch {
      return [];
    }
  }

  let html;
  let lastErr = null;
  const urlsToTry = [pageUrl, ...getAlternateUrls(pageUrl)];
  let fetchedUrl = pageUrl;
  for (const tryUrl of urlsToTry) {
    // If ZenRows is configured, try it first for this variant
    const zenUrl = getZenRowsUrl(tryUrl);
    if (zenUrl) {
      try {
        html = await fetchHtmlWithRetry(tryUrl, 3); // fetchHtmlWithRetry will use ZenRows internally
        fetchedUrl = tryUrl;
        break;
      } catch (err) {
        lastErr = err;
        // ZenRows already tried, now try alternate variant
        continue;
      }
    }
    try {
      html = await fetchHtmlWithRetry(tryUrl, 3);
      fetchedUrl = tryUrl;
      break;
    } catch (err) {
      lastErr = err;
      // Fallback to native fetch for this variant
      try {
        const zenFallback = getZenRowsUrl(tryUrl);
        const fetchUrl = zenFallback || tryUrl;
        const res = await fetch(fetchUrl, {
          headers: buildHeaders(tryUrl),
          signal: AbortSignal.timeout(10000),
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
        const text = await res.text();
        if (!text || text.length < 100) throw new Error("Empty fallback response");
        html = text;
        fetchedUrl = tryUrl;
        break;
      } catch (fallbackErr) {
        lastErr = fallbackErr.message?.toLowerCase().includes("econnreset") ? err : fallbackErr;
        // continue to next variant if ECONNRESET
        const isConnReset =
          (err.message || "").toLowerCase().includes("econnreset") ||
          (fallbackErr.message || "").toLowerCase().includes("econnreset") ||
          err.code === "ECONNRESET";
        if (isConnReset) continue;
        // for non-ECONNRESET, don't try alternates
        break;
      }
    }
  }

  if (!html) {
    const err = lastErr;
    const status = err?.response?.status;
    const msg = status
      ? `Request failed with status ${status}: ${err.response?.statusText || err.message}`
      : err?.code === "ECONNABORTED" || err?.name === "TimeoutError"
      ? "Request timed out after 10s — site slow hai, 10s baad retry karo."
      : (err?.message || "").toLowerCase().includes("econnreset")
      ? "Connection reset (ECONNRESET) — ye site Vercel ke datacenter IP ko block kar raha hai + India me ISP bhi adult sites ka SNI reset karta hai. Fix: 1) Local pe 'npm run dev' se try karo (tumhara residential IP), 2) VPN on karke try karo, 3) http:// variant try karo, 4) Self-host on VPS with residential proxy."
      : err?.message || "Failed to fetch page — site may block bots (Cloudflare/Anubis). Try another URL.";
    return { success: false, error: msg };
  }

  // use fetchedUrl as base for relative URL resolution
  pageUrl = fetchedUrl;

  if (!html || typeof html !== "string" || html.length < 50) {
    return { success: false, error: "Empty or invalid HTML received" };
  }

  const $ = cheerio.load(html);

  // Title extraction & sanitization — per spec: Clean Title
  let rawTitle = $("h1").first().text().trim();
  if (!rawTitle) rawTitle = $("title").first().text().trim();
  if (!rawTitle) rawTitle = $('meta[property="og:title"]').attr("content") || "";
  const title = sanitizeTitle(rawTitle);

  const groups = {};

  const getSelector = (el) => {
    try {
      const tag = (el.tagName || el.name || "div").toLowerCase();
      const classes = $(el).attr("class");
      if (classes && classes.trim()) {
        const cls = classes.trim().split(/\s+/).filter(Boolean).join(".");
        if (cls) return `${tag}.${cls}`;
      }
      const parent = $(el).parent();
      const parentEl = parent && parent[0];
      if (parentEl) {
        const parentTag = (parentEl.tagName || parentEl.name || "").toLowerCase();
        const parentClasses = parent.attr("class");
        if (parentTag && parentClasses && parentClasses.trim()) {
          const pcls = parentClasses.trim().split(/\s+/).filter(Boolean).join(".");
          if (pcls) return `${parentTag}.${pcls} ${tag}`;
        }
      }
      return `General <${tag}> tags`;
    } catch {
      return `General tags`;
    }
  };

  const toAbsoluteUrl = (src) => {
    if (!src) return null;
    src = src.trim();
    if (!src || src.startsWith("data:image") || src.startsWith("data:") || src.includes("favicon")) return null;
    src = src.replace(/&quot;/g, "").replace(/^['"]|['"]$/g, "").trim();
    if (!src || src.startsWith("data:")) return null;
    if (src.startsWith("javascript:") || src.startsWith("mailto:")) return null;
    try {
      if (src.startsWith("//")) src = "https:" + src;
      const absolute = new URL(src, pageUrl).href;
      if (!absolute.startsWith("http")) return null;
      return absolute;
    } catch {
      return null;
    }
  };

  const addToGroup = (el, rawSrc) => {
    const abs = toAbsoluteUrl(rawSrc);
    if (!abs) return;
    const sel = getSelector(el);
    if (!groups[sel]) groups[sel] = new Set();
    groups[sel].add(abs);
  };

  const addToSelector = (selector, rawSrc) => {
    const abs = toAbsoluteUrl(rawSrc);
    if (!abs) return;
    if (!groups[selector]) groups[selector] = new Set();
    groups[selector].add(abs);
  };

  // ==========================================
  // Smart HD Image Extraction — EXACT PRIORITY per spec
  // ==========================================

  // For every <img>, apply priority order:
  // 1. <a> wrapping href to image file
  // 2. data-zoom-image, data-original, data-large, data-highres
  // 3. srcset / data-srcset highest resolution (last / max w/x)
  // 4. fallback data-src or src
  $("img").each((_, el) => {
    const $el = $(el);
    let raw = null;

    // 1. Check if wrapped in <a> pointing to valid image
    const $anchor = $el.closest("a");
    if ($anchor.length) {
      const href = $anchor.attr("href");
      if (isValidImageHref(href)) {
        raw = href;
      }
    }

    // 2. E-commerce HD data attributes (highest priority after anchor)
    if (!raw) {
      raw =
        $el.attr("data-zoom-image") ||
        $el.attr("data-original") ||
        $el.attr("data-large") ||
        $el.attr("data-highres") ||
        null;
    }

    // 3. srcset / data-srcset — highest resolution
    if (!raw) {
      const srcsetRaw = $el.attr("srcset") || $el.attr("data-srcset");
      if (srcsetRaw) {
        const picked = pickHighestFromSrcset(srcsetRaw);
        if (picked) raw = picked;
      }
    }

    // 4. Fallback data-src or src
    if (!raw) {
      raw = $el.attr("data-src") || $el.attr("src") || null;
    }

    if (raw) addToGroup(el, raw);
  });

  // <picture><source> — srcset handling
  $("picture source, source").each((_, el) => {
    const $el = $(el);
    let srcsetRaw = $el.attr("srcset") || $el.attr("data-srcset");
    let picked = null;
    if (srcsetRaw) picked = pickHighestFromSrcset(srcsetRaw);
    if (picked) addToGroup(el, picked);
    else {
      const fb = $el.attr("src") || $el.attr("data-src");
      if (fb) {
        const mp = fb.includes(",") ? pickHighestFromSrcset(fb) : fb;
        if (mp) addToGroup(el, mp);
      }
    }
  });

  // style="background-image: url(...)" — per spec
  $('[style*="background"]').each((_, el) => {
    const style = $(el).attr("style");
    if (!style) return;
    const re = /url\(['"]?(.*?)['"]?\)/g;
    let m;
    while ((m = re.exec(style)) !== null) {
      let src = m[1].replace(/&quot;/g, "").trim();
      if (src.startsWith("data:")) continue;
      addToGroup(el, src);
    }
  });

  // ----- Universal fallback extras — ensures every type of website -----
  // These run AFTER HD logic, so spec priority is preserved, but we still
  // catch images hidden in CSS files, meta, JSON-LD, and JS variables.

  // <style> tags
  $("style").each((_, el) => {
    const css = $(el).html() || "";
    const re = /url\(['"]?(https?:\/\/[^'")]+|[^'")]+)['"]?\)/g;
    let m;
    while ((m = re.exec(css)) !== null) {
      let src = m[1].replace(/&quot;/g, "").trim();
      if (src.startsWith("data:")) continue;
      addToSelector("style:background", src);
    }
  });

  // Generic data-* on any element (catches divs with data-src)
  $("[data-src], [data-original], [data-large], [data-highres], [data-zoom-image], [data-srcset], [data-background], [data-bg]").each((_, el) => {
    // Skip <img> already handled
    if (el.name === "img" || el.tagName?.toLowerCase() === "img") return;
    const $el = $(el);
    const cand =
      $el.attr("data-zoom-image") ||
      $el.attr("data-original") ||
      $el.attr("data-large") ||
      $el.attr("data-highres") ||
      $el.attr("data-src") ||
      $el.attr("data-srcset") ||
      $el.attr("data-background") ||
      $el.attr("data-bg");
    if (cand) {
      const picked = cand.includes(",") && cand.includes(" ") ? pickHighestFromSrcset(cand) : cand;
      if (picked) addToGroup(el, picked);
    }
  });

  // Meta & link
  $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[itemprop="image"]').each((_, el) => {
    const c = $(el).attr("content");
    if (c) addToSelector("meta:og:image", c);
  });
  $('link[rel="image_src"]').each((_, el) => {
    const h = $(el).attr("href");
    if (h) addToSelector("link:image_src", h);
  });

  // JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).html() || "";
    const re = /"image"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) if (m[1]) addToSelector("script:ld+json:image", m[1]);
    const re2 = /https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|avif|gif)[^"']*/gi;
    let m2;
    while ((m2 = re2.exec(txt)) !== null) addToSelector("script:ld+json:raw", m2[0]);
  });

  // Raw HTML regex fallback — JS-injected URLs
  try {
    const rawRe = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^\s"'<>]*)?/gi;
    let m;
    const seen = new Set();
    while ((m = rawRe.exec(html)) !== null) {
      let url = m[0].replace(/[),"'`]+$/, "");
      if (seen.has(url)) continue;
      seen.add(url);
      addToSelector("raw:html:regex", url);
    }
    const protoRe = /\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^\s"'<>]*)?/gi;
    while ((m = protoRe.exec(html)) !== null) {
      let url = "https:" + m[0].replace(/[),"'`]+$/, "");
      if (seen.has(url)) continue;
      seen.add(url);
      addToSelector("raw:html:regex", url);
    }
  } catch {}

  // ---- Deduplicated absolute URLs per spec ----
  const resultGroups = Object.keys(groups)
    .map((selector) => ({
      selector,
      urls: Array.from(groups[selector]),
    }))
    .filter((g) => g.urls.length > 0)
    .sort((a, b) => b.urls.length - a.urls.length);

  if (resultGroups.length === 0) {
    return {
      success: false,
      error: "No valid images found on this page — site may render images via JS or block bots. Try another URL.",
      title,
      groups: [],
    };
  }

  return {
    success: true,
    title,
    groups: resultGroups,
  };
}
