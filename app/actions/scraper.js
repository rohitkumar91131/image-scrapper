"use server";

import axios from "axios";
import * as cheerio from "cheerio";
import https from "https";
import http from "http";

// Keep-alive agents - universal, works for most sites incl. adult/CDN
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: true });
const httpAgent = new http.Agent({ keepAlive: true });

const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
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
    "Accept-Language": "en-US,en;q=0.9,hi;q=0.8",
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
  if (!hasScore) return entries[entries.length - 1].url;
  entries.sort((a, b) => b.score - a.score);
  return entries[0].url;
}

function sanitizeTitle(raw) {
  if (!raw) return "Product_Images";
  let t = raw.replace(/[<>:"/\\|?*]+/g, "").trim();
  t = t.replace(/\s+/g, " ").substring(0, 100).trim();
  return t || "Product_Images";
}

async function fetchHtmlWithRetry(pageUrl, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.get(pageUrl, {
        timeout: 15000,
        headers: buildHeaders(pageUrl),
        validateStatus: (s) => s >= 200 && s < 400,
        maxRedirects: 5,
        responseType: "text",
        decompress: true,
        httpAgent,
        httpsAgent,
        // Force IPv4 on retry to avoid ECONNRESET on some hosts
        family: attempt > 1 ? 4 : undefined,
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

  let html;
  try {
    html = await fetchHtmlWithRetry(pageUrl, 3);
  } catch (err) {
    // Fallback to native fetch (undici) - sometimes axios is blocked but fetch works
    try {
      const res = await fetch(pageUrl, {
        headers: buildHeaders(pageUrl),
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
      html = await res.text();
      if (!html || html.length < 100) throw new Error("Empty fallback response");
    } catch (fallbackErr) {
      const status = err.response?.status;
      const msg = status
        ? `Request failed with status ${status}: ${err.response?.statusText || err.message}`
        : err.code === "ECONNABORTED" || fallbackErr.name === "TimeoutError"
        ? "Request timed out after 15s — site may be slow or blocking Vercel IPs. Try again."
        : (err.message && err.message.includes("ECONNRESET")) || (fallbackErr.message || "").toLowerCase().includes("econnreset")
        ? "Connection reset by target site (ECONNRESET) — site is blocking bot / Vercel IP. Retried 3x. Try again in 10s or try http:// variant."
        : err.message || fallbackErr.message || "Failed to fetch page";
      return { success: false, error: msg };
    }
  }

  if (!html || typeof html !== "string" || html.length < 50) {
    return { success: false, error: "Empty or invalid HTML received" };
  }

  const $ = cheerio.load(html);

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
    if (!src) return null;
    if (src.startsWith("data:")) return null;
    // filter out javascript:, mailto:
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

  // ---- 4a. <img> ----
  $("img").each((_, el) => {
    const $el = $(el);
    let raw = null;
    const srcsetRaw = $el.attr("srcset") || $el.attr("data-srcset") || $el.attr("data-src-set");
    if (srcsetRaw) {
      const p = pickHighestFromSrcset(srcsetRaw);
      if (p) raw = p;
    }
    if (!raw) {
      raw =
        $el.attr("src") ||
        $el.attr("data-src") ||
        $el.attr("data-original") ||
        $el.attr("data-lazy-src") ||
        $el.attr("data-lazy") ||
        $el.attr("data-url") ||
        $el.attr("data-actual") ||
        $el.attr("data-image") ||
        $el.attr("data-thumb") ||
        $el.attr("data-large") ||
        null;
    }
    // also check data attributes generically for any img
    if (!raw) {
      const attrs = el.attribs || {};
      for (const [k, v] of Object.entries(attrs)) {
        if (k.startsWith("data-") && typeof v === "string" && v.match(/^https?:\/\//) && v.match(/\.(jpg|jpeg|png|webp|avif|gif)/i)) {
          raw = v;
          break;
        }
      }
    }
    if (raw) addToGroup(el, raw);
  });

  // ---- 4b. <picture> <source> ----
  $("picture source, source").each((_, el) => {
    const $el = $(el);
    let srcsetRaw = $el.attr("srcset") || $el.attr("data-srcset") || $el.attr("data-src");
    let picked = null;
    if (srcsetRaw) picked = pickHighestFromSrcset(srcsetRaw);
    if (picked) addToGroup(el, picked);
    else {
      const fb = $el.attr("src") || $el.attr("data-src") || $el.attr("srcset");
      if (fb) {
        const mp = fb.includes(",") ? pickHighestFromSrcset(fb) : fb;
        if (mp) addToGroup(el, mp);
      }
    }
  });

  // ---- 4c. Inline style background-image ----
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

  // ---- 4d. <style> tags with background images ----
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

  // ---- 4e. Generic data-* attributes on any element ----
  $("[data-src], [data-original], [data-lazy-src], [data-srcset], [data-background], [data-bg], [data-image], [data-thumb]").each((_, el) => {
    const $el = $(el);
    const cand =
      $el.attr("data-src") ||
      $el.attr("data-original") ||
      $el.attr("data-lazy-src") ||
      $el.attr("data-srcset") ||
      $el.attr("data-background") ||
      $el.attr("data-bg") ||
      $el.attr("data-image") ||
      $el.attr("data-thumb");
    if (cand) {
      const picked = cand.includes(",") && cand.includes(" ") ? pickHighestFromSrcset(cand) : cand;
      if (picked) addToGroup(el, picked);
    }
  });

  // ---- 4f. Meta & Link tags (og:image, twitter:image) ----
  $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"], meta[name="twitter:image:src"], meta[itemprop="image"]').each((_, el) => {
    const c = $(el).attr("content");
    if (c) addToSelector('meta:og:image', c);
  });
  $('link[rel="image_src"]').each((_, el) => {
    const h = $(el).attr("href");
    if (h) addToSelector('link:image_src', h);
  });

  // ---- 4g. Anchor hrefs that are direct images (common on galleries like pornpics) ----
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.match(/\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i) && href.startsWith("http")) {
      addToSelector("a:href-image", href);
    }
    // also relative image hrefs
    if (href.match(/\.(jpg|jpeg|png|webp|avif|gif)(\?.*)?$/i) && href.startsWith("/")) {
      addToSelector("a:href-image", href);
    }
  });

  // ---- 4h. JSON-LD and inline scripts with image URLs ----
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).html() || "";
    const re = /"image"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      let src = m[1];
      if (src) addToSelector("script:ld+json:image", src);
    }
    const re2 = /https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp|avif|gif)[^"']*/gi;
    let m2;
    while ((m2 = re2.exec(txt)) !== null) {
      addToSelector("script:ld+json:raw", m2[0]);
    }
  });

  // ---- 4i. Raw HTML regex fallback - catches JS-injected image URLs ----
  // This ensures "every type of website" even if images are inside JS variables
  try {
    const rawRe = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^\s"'<>]*)?/gi;
    let m;
    const seenRaw = new Set();
    while ((m = rawRe.exec(html)) !== null) {
      let url = m[0];
      // Clean trailing punctuation like ),",'
      url = url.replace(/[),"'`]+$/, "");
      if (seenRaw.has(url)) continue;
      seenRaw.add(url);
      // Skip already captured via cheerio to avoid bloat, but if groups empty this is crucial
      addToSelector("raw:html:regex", url);
    }
    // Also catch protocol-relative //cdn.../*.jpg
    const protoRe = /\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|avif|gif)(?:\?[^\s"'<>]*)?/gi;
    while ((m = protoRe.exec(html)) !== null) {
      let url = "https:" + m[0].replace(/[),"'`]+$/, "");
      if (seenRaw.has(url)) continue;
      seenRaw.add(url);
      addToSelector("raw:html:regex", url);
    }
  } catch {}

  // ---- 5. Deduplication + formatting ----
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
      error: "No valid images found on this page — site may render images via JS (client-side) or block bots. Try another URL.",
      title,
      groups: [],
    };
  }

  // Optional: filter out tiny tracking pixels (1x1) if needed? Keep for now to be universal

  return {
    success: true,
    title,
    groups: resultGroups,
  };
}
