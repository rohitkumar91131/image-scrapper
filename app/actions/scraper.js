"use server";

import axios from "axios";
import * as cheerio from "cheerio";

/**
 * Pick highest resolution URL from srcset string.
 * Supports "w" and "x" descriptors. If no descriptor, returns last entry.
 * @param {string} srcset
 * @returns {string|null}
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
      if (descriptor.endsWith("w")) {
        score = parseInt(descriptor.slice(0, -1), 10) || 0;
      } else if (descriptor.endsWith("x")) {
        const v = parseFloat(descriptor.slice(0, -1));
        score = isNaN(v) ? 0 : v * 1000; // weight x so 2x > 1x, comparable to w
      }
      return { url, descriptor, score };
    })
    .filter((e) => e.url);

  if (entries.length === 0) return null;

  const hasScore = entries.some((e) => e.score > 0);
  if (!hasScore) {
    // No descriptor -> last is usually highest (e.g., srcset ordered ascending)
    return entries[entries.length - 1].url;
  }
  entries.sort((a, b) => b.score - a.score);
  return entries[0].url;
}

/**
 * Sanitize title for filesystem / zip name
 */
function sanitizeTitle(raw) {
  if (!raw) return "Product_Images";
  let t = raw.replace(/[<>:"/\\|?*]+/g, "").trim();
  t = t.replace(/\s+/g, " ").substring(0, 100).trim();
  return t || "Product_Images";
}

/**
 * Robust image extraction + grouping
 * @param {string} pageUrl
 * @returns {Promise<{success: boolean, title?: string, groups?: Array<{selector:string, urls:string[]}>, error?: string}>}
 */
export async function scrapeImages(pageUrl) {
  // ---- 1. Validate URL ----
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

  // ---- 2. Fetch HTML with robustness ----
  let html;
  try {
    const { data } = await axios.get(pageUrl, {
      timeout: 10000, // 10s
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      validateStatus: (status) => status >= 200 && status < 400,
      maxRedirects: 5,
      responseType: "text",
    });
    html = data;
    if (!html || typeof html !== "string") {
      return { success: false, error: "Empty response from server" };
    }
  } catch (err) {
    const status = err.response?.status;
    const msg = status
      ? `Request failed with status ${status}: ${err.response?.statusText || err.message}`
      : err.code === "ECONNABORTED"
      ? "Request timed out after 10s"
      : err.message || "Failed to fetch page";
    return { success: false, error: msg };
  }

  // ---- 3. Parse with cheerio ----
  const $ = cheerio.load(html);

  // Title extraction & sanitization
  let rawTitle = $("h1").first().text().trim();
  if (!rawTitle) rawTitle = $("title").first().text().trim();
  const title = sanitizeTitle(rawTitle);

  // Helpers
  const groups = {};

  const getSelector = (el) => {
    try {
      const tag = (el.tagName || el.name || "div").toLowerCase();
      const classes = $(el).attr("class");
      if (classes && classes.trim()) {
        const cls = classes
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .join(".");
        if (cls) return `${tag}.${cls}`;
      }
      const parent = $(el).parent();
      const parentEl = parent && parent[0];
      if (parentEl) {
        const parentTag = (parentEl.tagName || parentEl.name || "").toLowerCase();
        const parentClasses = parent.attr("class");
        if (parentTag && parentClasses && parentClasses.trim()) {
          const pcls = parentClasses
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .join(".");
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
    if (!src || src.startsWith("data:image") || src.includes("favicon")) return null;
    // clean html entities & quotes
    src = src.replace(/&quot;/g, "").replace(/^['"]|['"]$/g, "").trim();
    if (!src) return null;
    // skip base64, svg data, etc.
    if (src.startsWith("data:")) return null;
    try {
      if (src.startsWith("//")) src = "https:" + src;
      // handle url() with relative like /images/x.jpg
      const absolute = new URL(src, pageUrl).href;
      // final validation
      if (!absolute.startsWith("http")) return null;
      return absolute;
    } catch {
      return null;
    }
  };

  const addToGroup = (el, rawSrc) => {
    const absolute = toAbsoluteUrl(rawSrc);
    if (!absolute) return;
    const selector = getSelector(el);
    if (!groups[selector]) groups[selector] = new Set();
    groups[selector].add(absolute);
  };

  // ---- 4. Smart Extraction ----

  // 4a. <img> tags: src, data-src, data-original, data-lazy-src, srcset, data-srcset
  $("img").each((_, el) => {
    const $el = $(el);
    let raw = null;

    // Highest priority: srcset / data-srcset (pick highest res)
    const srcsetRaw = $el.attr("srcset") || $el.attr("data-srcset");
    if (srcsetRaw) {
      const picked = pickHighestFromSrcset(srcsetRaw);
      if (picked) raw = picked;
    }

    // Fallback to single source attributes
    if (!raw) {
      raw =
        $el.attr("src") ||
        $el.attr("data-src") ||
        $el.attr("data-original") ||
        $el.attr("data-lazy-src") ||
        $el.attr("data-lazy") ||
        $el.attr("data-url") ||
        $el.attr("data-actual") ||
        null;
    }

    if (raw) addToGroup(el, raw);
  });

  // 4b. <picture> <source> tags
  $("picture source, source").each((_, el) => {
    const $el = $(el);
    // source may have srcset or src
    let srcsetRaw = $el.attr("srcset") || $el.attr("data-srcset");
    let picked = null;
    if (srcsetRaw) {
      picked = pickHighestFromSrcset(srcsetRaw);
    }
    if (picked) {
      addToGroup(el, picked);
    } else {
      const fallback = $el.attr("src") || $el.attr("data-src") || $el.attr("srcset");
      if (fallback) {
        // fallback may still be srcset-like with single url
        const maybePicked = fallback.includes(",") ? pickHighestFromSrcset(fallback) : fallback;
        if (maybePicked) addToGroup(el, maybePicked);
      }
    }
  });

  // 4c. Inline CSS background-image (style="background-image: url(...)")
  $('[style*="background-image"]').each((_, el) => {
    const style = $(el).attr("style");
    if (!style) return;
    const regex = /url\(['"]?(.*?)['"]?\)/g;
    let match;
    while ((match = regex.exec(style)) !== null) {
      let src = match[1];
      if (!src) continue;
      src = src.replace(/&quot;/g, "").trim();
      // skip data: uris inside css
      if (src.startsWith("data:")) continue;
      addToGroup(el, src);
    }
  });

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
      error: "No valid images found on this page",
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
