"use client";

import { useState } from "react";
import { scrapeImages } from "./actions/scraper";
import JSZip from "jszip";
import { saveAs } from "file-saver";

// ---- Helpers ----
function sanitizeForFilename(name) {
  if (!name) return "Product_Images";
  return name.replace(/[<>:"/\\|?*]+/g, "").trim().replace(/\s+/g, "_").substring(0, 80) || "Product_Images";
}

function getSafeFilename(url, index) {
  try {
    const parsed = new URL(url);
    let raw = parsed.pathname.split("/").pop()?.split("?")[0] || "";
    raw = raw.replace(/[<>:"/\\|?*]+/g, "_").trim();
    if (!raw || raw === "" || raw.length < 2) {
      raw = `image_${index + 1}.jpg`;
    }
    // Ensure extension exists
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(raw);
    if (!hasExt) {
      // try to infer from url search or fallback to jpg
      const possibleExt = raw.includes(".") ? "" : ".jpg";
      raw = raw + possibleExt;
    }
    // Prevent duplicate extension issues and clean
    raw = raw.replace(/\s+/g, "_");
    return `${index + 1}_${raw}`;
  } catch {
    return `${index + 1}_image_${index + 1}.jpg`;
  }
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null); // { title, groups }
  const [downloadingIndex, setDownloadingIndex] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const handleScan = async (e) => {
    e.preventDefault();
    if (!url.trim()) {
      setError("Please enter a valid URL");
      return;
    }
    if (!url.startsWith("http")) {
      setError("URL must start with http:// or https://");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    try {
      const result = await scrapeImages(url.trim());
      if (!result.success) {
        setError(result.error || "Failed to scrape images");
        if (result.title) {
          // still show partial if title exists but no images
        }
        return;
      }
      setData(result);
    } catch (err) {
      setError(err.message || "Unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadGroup = async (group, groupIndex) => {
    if (!data?.title) return;
    setDownloadingIndex(groupIndex);
    setProgress({ current: 0, total: group.urls.length });
    setError("");

    const zip = new JSZip();
    const zipFilename = `${sanitizeForFilename(data.title)}.zip`;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < group.urls.length; i++) {
      const imageUrl = group.urls[i];
      const safeName = getSafeFilename(imageUrl, i);
      setProgress({ current: i + 1, total: group.urls.length });

      try {
        // Use proxy to avoid CORS - primary method
        const proxiedUrl = `/api/proxy?url=${encodeURIComponent(imageUrl)}`;
        let res = await fetch(proxiedUrl);

        // Fallback to direct fetch if proxy fails (e.g., local dev)
        if (!res.ok) {
          // try direct fetch as fallback
          try {
            res = await fetch(imageUrl, { mode: "cors" });
          } catch {
            throw new Error(`Proxy failed ${res.status} and direct fetch CORS blocked`);
          }
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        // Ensure blob is not html error page
        if (blob.type.includes("text/html") && blob.size < 5000) {
          // Possibly error page, still skip
          // quick text check
          const text = await blob.text().catch(() => "");
          if (text.includes("<html") || text.includes("<!DOCTYPE")) {
            throw new Error("Fetched HTML instead of image (maybe blocked)");
          }
          // if not html, re-create blob
          zip.file(safeName, blob);
        } else {
          zip.file(safeName, blob);
        }
        successCount++;
      } catch (err) {
        console.warn(`Failed to fetch ${imageUrl}:`, err.message);
        failCount++;
        // Optional: add placeholder text file for failed images
        // zip.file(`${safeName}.FAILED.txt`, `Failed to fetch: ${imageUrl}\nError: ${err.message}`);
      }
    }

    if (successCount === 0) {
      setError(`All ${group.urls.length} images failed to download. Try again or check CORS.`);
      setDownloadingIndex(null);
      return;
    }

    try {
      const content = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      saveAs(content, zipFilename);
      if (failCount > 0) {
        setError(`Downloaded ${successCount}/${group.urls.length} images. ${failCount} failed (CORS or 404).`);
      }
    } catch (err) {
      setError(`Failed to generate ZIP: ${err.message}`);
    } finally {
      setDownloadingIndex(null);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-white/80 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white text-lg">
              🤖
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-none">Visual Intelligent Bot</h1>
              <p className="text-xs text-slate-500">Smart Image Scraper • Next.js 14</p>
            </div>
          </div>
          <a
            href="https://github.com"
            target="_blank"
            className="text-sm text-slate-500 hover:text-slate-800 hidden sm:block"
          >
            Docs
          </a>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 md:py-10">
        {/* Hero Scan Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
          <h2 className="text-2xl md:text-3xl font-bold text-slate-900">Scan any product page for images</h2>
          <p className="text-slate-600 mt-2 max-w-2xl">
            Paste a detail page URL. We intelligently group images by their HTML tag & CSS class (like{" "}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm">img.product-image</code>) and let you download
            any group as a ZIP.
          </p>

          <form onSubmit={handleScan} className="mt-6 flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">🔗</span>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/product/123"
                className="w-full pl-10 pr-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition placeholder:text-slate-400 text-[15px]"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition min-w-[140px] shadow-sm"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <span>⚡</span> Scan
                </>
              )}
            </button>
          </form>

          {/* Example URLs */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="text-slate-400 py-1">Try:</span>
            {[
              "https://picsum.photos",
              "https://unsplash.com",
              "https://example.com",
            ].map((ex) => (
              <button
                key={ex}
                onClick={() => setUrl(ex)}
                className="px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 transition"
              >
                {ex}
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-5 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl flex items-start gap-2.5">
              <span className="mt-0.5">❌</span>
              <p className="text-sm leading-relaxed flex-1">{error}</p>
              <button onClick={() => setError("")} className="text-red-400 hover:text-red-600 text-lg leading-none">
                ×
              </button>
            </div>
          )}

          {data?.success && (
            <div className="mt-5 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center gap-2.5">
              <span>✅</span>
              <p className="text-sm">
                Found <b>{data.groups.length}</b> group{data.groups.length !== 1 ? "s" : ""} • Product:{" "}
                <b className="break-all">{data.title}</b> • Total images:{" "}
                <b>{data.groups.reduce((a, g) => a + g.urls.length, 0)}</b>
              </p>
            </div>
          )}
        </div>

        {/* Results */}
        {data?.groups && data.groups.length > 0 && (
          <div className="mt-8">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900">
                Discovered Groups <span className="text-slate-400 font-normal">({data.groups.length})</span>
              </h3>
              <span className="text-xs text-slate-500 hidden md:inline">Grouped by tag + class • Sorted by count</span>
            </div>

            <div className="grid gap-6">
              {data.groups.map((group, idx) => (
                <div
                  key={`${group.selector}-${idx}`}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="px-5 md:px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-gradient-to-r from-slate-50 to-white">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-bold">
                          {idx + 1}
                        </span>
                        <h4 className="font-mono text-sm font-semibold text-slate-800 truncate" title={group.selector}>
                          {group.selector}
                        </h4>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 whitespace-nowrap">
                          {group.urls.length} image{group.urls.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5 hidden md:block">All images in this group share the same selector</p>
                    </div>

                    <button
                      onClick={() => handleDownloadGroup(group, idx)}
                      disabled={downloadingIndex !== null}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition shadow-sm shrink-0"
                    >
                      {downloadingIndex === idx ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          {progress.current}/{progress.total}
                        </>
                      ) : (
                        <>
                          <span>⬇️</span> Download ZIP
                        </>
                      )}
                    </button>
                  </div>

                  {/* Image Grid */}
                  <div className="p-5 md:p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                      {group.urls.slice(0, 10).map((imgUrl, i) => (
                        <div
                          key={`${imgUrl}-${i}`}
                          className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-200"
                        >
                          {/* Using proxy for preview to avoid CORS + http vs https mixed content issues */}
                          {/* Direct img tag as required - we use proxy only if direct fails via onError fallback handled by browser */}
                          <img
                            src={imgUrl}
                            alt={`${group.selector} ${i + 1}`}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            // Fallback to proxy if direct fails due to CORS / 403
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.retried) {
                                target.dataset.retried = "1";
                                target.src = `/api/proxy?url=${encodeURIComponent(imgUrl)}`;
                              }
                            }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition" />
                          <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition">
                            <span className="text-[11px] bg-black/70 text-white px-1.5 py-0.5 rounded backdrop-blur">
                              #{i + 1}
                            </span>
                            <a
                              href={imgUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] bg-white/90 hover:bg-white text-slate-800 px-1.5 py-0.5 rounded font-medium"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Open
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>

                    {group.urls.length > 10 && (
                      <p className="text-xs text-slate-500 mt-3 text-center bg-slate-50 py-2 rounded-lg border border-dashed border-slate-200">
                        + {group.urls.length - 10} more images in this group — they will all be included in the ZIP
                      </p>
                    )}

                    {/* Collapsible URL list */}
                    <details className="mt-4 group/details">
                      <summary className="cursor-pointer text-sm text-slate-600 hover:text-slate-900 list-none flex items-center gap-1.5 select-none">
                        <span className="transition group-open/details:rotate-90">▶</span> Show all URLs ({group.urls.length})
                      </summary>
                      <div className="mt-3 bg-slate-50 rounded-xl border border-slate-200 p-3 max-h-52 overflow-auto">
                        <ul className="space-y-1.5">
                          {group.urls.map((u, i) => (
                            <li key={u + i} className="flex gap-2 text-xs font-mono break-all">
                              <span className="text-slate-400 shrink-0">{i + 1}.</span>
                              <a href={u} target="_blank" rel="noreferrer" className="text-sky-600 hover:underline">
                                {u}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer helper */}
            <div className="mt-8 bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
              <span className="text-lg">💡</span>
              <div className="text-sm text-slate-600 leading-relaxed">
                <b>Tip:</b> If direct image loading is blocked (CORS), the app automatically retries via{" "}
                <code className="bg-slate-100 px-1 py-0.5 rounded">/api/proxy</code>. ZIP downloads always use the proxy
                for reliability. Filenames are saved as <code className="bg-slate-100 px-1 py-0.5 rounded">1_image.jpg, 2_photo.png...</code> to avoid
                collisions.
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!data && !loading && (
          <div className="mt-10 text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
            <div className="text-4xl mb-3">🖼️</div>
            <p className="text-slate-700 font-medium">No scan yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Enter a product page URL above and hit Scan. Groups will appear as beautiful cards with live previews.
            </p>
          </div>
        )}
      </div>

      <footer className="border-t border-slate-200 mt-10 py-6 text-center text-xs text-slate-500">
        Built with Next.js 14 • Tailwind • axios + cheerio • JSZip + file-saver • Proxy at <code>/api/proxy</code>
      </footer>
    </main>
  );
}
