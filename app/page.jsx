"use client";

import { useState, useEffect } from "react";
import { scrapeImages } from "./actions/scraper";
import JSZip from "jszip";
import { saveAs } from "file-saver";

// ---- helpers ----
function sanitizeForFilename(name) {
  if (!name) return "Product_Images";
  return (
    name.replace(/[<>:"/\\|?*]+/g, "").trim().replace(/\s+/g, "_").substring(0, 80) ||
    "Product_Images"
  );
}

function getSafeFilename(url, index) {
  try {
    const parsed = new URL(url);
    let raw = parsed.pathname.split("/").pop()?.split("?")[0] || "";
    raw = raw.replace(/[<>:"/\\|?*]+/g, "_").trim();
    if (!raw || raw.length < 2) raw = `image_${index + 1}.jpg`;
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(raw);
    if (!hasExt) raw = raw + ".jpg";
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
  const [data, setData] = useState(null);
  const [downloadingIndex, setDownloadingIndex] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [lightbox, setLightbox] = useState(null); // { group, groupIdx, idx }

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
        return;
      }
      setData(result);
    } catch (err) {
      setError(err.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  const fetchAndAddToZip = async (zip, imageUrl, filename) => {
    const proxied = `/api/proxy?url=${encodeURIComponent(imageUrl)}`;
    let res = await fetch(proxied);
    if (!res.ok) {
      try {
        res = await fetch(imageUrl, { mode: "cors" });
      } catch {
        throw new Error(`Proxy ${res.status} + direct CORS blocked`);
      }
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.type.includes("text/html") && blob.size < 6000) {
      const text = await blob.text().catch(() => "");
      if (text.includes("<html") || text.includes("<!DOCTYPE")) {
        throw new Error("HTML instead of image");
      }
      zip.file(filename, blob);
    } else {
      zip.file(filename, blob);
    }
  };

  const handleDownloadCategory = async (group, groupIndex) => {
    if (!data?.title) return;
    setDownloadingIndex(groupIndex);
    setError("");
    const zip = new JSZip();
    const zipName = `${sanitizeForFilename(data.title)}_${sanitizeForFilename(group.selector)}.zip`;
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < group.urls.length; i++) {
      const safe = getSafeFilename(group.urls[i], i);
      try {
        await fetchAndAddToZip(zip, group.urls[i], safe);
        ok++;
      } catch (err) {
        fail++;
        console.warn(err.message);
      }
    }
    if (ok === 0) {
      setError(`All ${group.urls.length} images failed. Check CORS / URL.`);
      setDownloadingIndex(null);
      return;
    }
    try {
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, zipName);
      if (fail > 0) setError(`Downloaded ${ok}/${group.urls.length} — ${fail} failed.`);
    } catch (err) {
      setError(`ZIP failed: ${err.message}`);
    } finally {
      setDownloadingIndex(null);
    }
  };

  const handleDownloadAll = async () => {
    if (!data?.groups || data.groups.length === 0) return;
    setDownloadingAll(true);
    setError("");
    const allUrls = data.groups.flatMap((g) => g.urls);
    const zip = new JSZip();
    const zipName = `${sanitizeForFilename(data.title)}_ALL.zip`;
    let ok = 0;
    let fail = 0;
    let globalIdx = 0;
    for (const group of data.groups) {
      for (let i = 0; i < group.urls.length; i++) {
        const safe = getSafeFilename(group.urls[i], globalIdx);
        try {
          await fetchAndAddToZip(zip, group.urls[i], safe);
          ok++;
        } catch {
          fail++;
        }
        globalIdx++;
      }
    }
    if (ok === 0) {
      setError(`All ${allUrls.length} images failed.`);
      setDownloadingAll(false);
      return;
    }
    try {
      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, zipName);
      if (fail > 0) setError(`Downloaded ${ok}/${allUrls.length} — ${fail} failed.`);
    } catch (err) {
      setError(`ZIP failed: ${err.message}`);
    } finally {
      setDownloadingAll(false);
    }
  };

  const totalImages = data?.groups ? data.groups.reduce((a, g) => a + g.urls.length, 0) : 0;

  // Lightbox controls
  const openLightbox = (group, groupIdx, idx) => setLightbox({ group, groupIdx, idx });
  const closeLightbox = () => setLightbox(null);
  const goNext = () =>
    setLightbox((prev) => {
      if (!prev) return prev;
      const len = prev.group.urls.length;
      return { ...prev, idx: (prev.idx + 1) % len };
    });
  const goPrev = () =>
    setLightbox((prev) => {
      if (!prev) return prev;
      const len = prev.group.urls.length;
      return { ...prev, idx: (prev.idx - 1 + len) % len };
    });

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", onKey);
    // lock scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox]);

  return (
    <main className="min-h-screen bg-[#f9f9f9] text-neutral-900 selection:bg-neutral-900 selection:text-white">
      {/* TOP NAV */}
      <header className="border-b border-neutral-900">
        <div className="max-w-[1280px] mx-auto px-6 md:px-8 h-[48px] flex items-center justify-between">
          <span className="text-[11px] tracking-[0.22em] font-mono uppercase">(TOOLS)</span>
          <span className="text-[11px] tracking-[0.22em] font-mono uppercase hidden md:inline">
            (IMAGE SCRAPER — 2026)
          </span>
          <a
            href="https://github.com/rohitkumar91131/image-scrapper"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] tracking-[0.22em] font-mono uppercase hover:underline"
          >
            (GITHUB)
          </a>
        </div>
      </header>

      {/* HERO / INPUT */}
      <section className="max-w-[1280px] mx-auto px-6 md:px-8">
        {/* Massive heading */}
        <div className="pt-10 md:pt-14 pb-6">
          <h1 className="text-[56px] md:text-[96px] lg:text-[128px] font-black tracking-tighter leading-[0.85] uppercase">
            PIXELVAULT
          </h1>
          <div className="mt-4 flex flex-col md:flex-row md:items-baseline gap-2 md:gap-6">
            <p className="font-serif italic text-[16px] md:text-[18px] text-neutral-700 leading-none">
              Minimal editorial scraper —
            </p>
            <p className="text-[11px] tracking-[0.18em] font-mono uppercase text-neutral-500">
              (EXTRACT / GROUP / DOWNLOAD)
            </p>
          </div>
        </div>

        {/* Thin rule */}
        <div className="border-b border-neutral-300" />

        {/* Input row */}
        <div className="py-8 md:py-10">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-[11px] tracking-[0.2em] font-mono uppercase">(URL INPUT)</span>
            <span className="h-px flex-1 bg-neutral-300 hidden md:block" />
            <span className="text-[11px] font-mono text-neutral-500 hidden md:inline">
              PASTE PRODUCT / DETAIL PAGE URL
            </span>
          </div>

          <form onSubmit={handleScan} className="flex flex-col md:flex-row gap-0">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/product/123"
              disabled={loading}
              className="flex-1 h-[56px] px-5 bg-white border border-neutral-900 rounded-none text-[14px] font-mono placeholder:text-neutral-400 focus:outline-none focus:border-neutral-900 focus:ring-0 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={loading}
              className="h-[56px] px-8 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[13px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900 transition-none disabled:opacity-60 disabled:cursor-not-allowed shrink-0"
            >
              {loading ? "( SCANNING... )" : "[ SCAN PAGE ]"}
            </button>
          </form>

          {/* helpers */}
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <span className="text-[11px] tracking-[0.16em] font-mono uppercase text-neutral-500">(TRY)</span>
            {["https://picsum.photos", "https://unsplash.com"].map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setUrl(ex)}
                className="text-[11px] font-mono tracking-[0.12em] uppercase border border-neutral-300 bg-white px-2.5 py-1 rounded-none hover:border-neutral-900 transition-none"
              >
                {ex}
              </button>
            ))}
            <span className="ml-auto text-[11px] font-mono tracking-[0.12em] uppercase text-neutral-400 hidden md:inline">
              (FLAT / SQUARED / NO BLUR)
            </span>
          </div>

          {error && (
            <div className="mt-6 border border-red-600 bg-white px-4 py-3 flex items-start justify-between gap-4 rounded-none">
              <p className="text-[13px] font-mono leading-relaxed text-red-700">
                (ERROR) — {error}
              </p>
              <button
                onClick={() => setError("")}
                className="text-[12px] font-mono tracking-[0.14em] uppercase border border-red-600 px-2 py-1 hover:bg-red-600 hover:text-white transition-none shrink-0"
              >
                [ DISMISS ]
              </button>
            </div>
          )}
        </div>

        {/* GLOBAL ACTION — only when data */}
        {data?.success && (
          <>
            <div className="border-b border-neutral-900" />
            <div className="py-6 md:py-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[11px] tracking-[0.2em] font-mono uppercase text-neutral-500">
                  (TARGET PAGE)
                </div>
                <h2 className="mt-2 font-serif text-[22px] md:text-[28px] leading-tight break-words">
                  {data.title}
                </h2>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] tracking-[0.16em] font-mono uppercase">
                  <span className="border border-neutral-900 px-2 py-1 bg-white">
                    (CATEGORIES: {data.groups.length})
                  </span>
                  <span className="border border-neutral-900 px-2 py-1 bg-white">
                    (TOTAL IMAGES: {totalImages})
                  </span>
                  <span className="border border-neutral-300 px-2 py-1 bg-white text-neutral-500">
                    (GROUPED BY SELECTOR)
                  </span>
                </div>
              </div>

              <button
                onClick={handleDownloadAll}
                disabled={downloadingAll || downloadingIndex !== null}
                className="h-[44px] px-6 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[12px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900 transition-none disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {downloadingAll ? "( ZIPPING ALL... )" : "(DOWNLOAD ALL IMAGES)"}
              </button>
            </div>
            <div className="border-b border-neutral-300" />
          </>
        )}

        {/* CATEGORY LIST */}
        {data?.groups && data.groups.length > 0 ? (
          <div className="pb-16">
            <div className="py-4 flex items-center justify-between">
              <span className="text-[11px] tracking-[0.2em] font-mono uppercase">(CATEGORIES)</span>
              <span className="text-[11px] tracking-[0.14em] font-mono uppercase text-neutral-500">
                ({data.groups.length} GROUPS — SORTED BY COUNT)
              </span>
            </div>

            <div className="border-t border-neutral-900">
              {data.groups.map((group, idx) => (
                <div key={`${group.selector}-${idx}`} className="border-b border-neutral-300 py-6 md:py-8">
                  {/* label row */}
                  <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-3">
                    <div className="flex flex-wrap items-baseline gap-2 min-w-0">
                      <span className="text-[12px] md:text-[13px] tracking-[0.14em] font-mono uppercase">
                        (SELECTOR: {group.selector})
                      </span>
                      <span className="text-[12px] tracking-[0.14em] font-mono uppercase text-neutral-500">
                        — {group.urls.length} IMAGES
                      </span>
                    </div>
                    <button
                      onClick={() => handleDownloadCategory(group, idx)}
                      disabled={downloadingIndex !== null || downloadingAll}
                      className="self-start md:self-auto text-[11px] tracking-[0.16em] font-mono uppercase border border-neutral-900 bg-white px-3 py-2 hover:bg-neutral-900 hover:text-white transition-none disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                    >
                      {downloadingIndex === idx ? "( ZIPPING... )" : "[ DOWNLOAD CATEGORY ]"}
                    </button>
                  </div>

                  {/* rule */}
                  <div className="mt-4 border-b border-neutral-200" />

                  {/* grid - sharp, squared — tap to fullscreen */}
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                    {group.urls.map((imgUrl, i) => (
                      <button
                        key={`${imgUrl}-${i}`}
                        type="button"
                        onClick={() => openLightbox(group, idx, i)}
                        className="aspect-square bg-white border border-neutral-900 overflow-hidden text-left rounded-none hover:border-neutral-900 focus:outline-none focus:border-neutral-900"
                        aria-label={`Open image ${i + 1} fullscreen`}
                      >
                        <img
                          src={imgUrl}
                          alt={`${group.selector} ${i + 1}`}
                          loading="lazy"
                          className="w-full h-full object-cover rounded-none pointer-events-none"
                          onError={(e) => {
                            const t = e.currentTarget;
                            if (!t.dataset.retried) {
                              t.dataset.retried = "1";
                              t.src = `/api/proxy?url=${encodeURIComponent(imgUrl)}`;
                            }
                          }}
                        />
                      </button>
                    ))}
                  </div>

                  {/* url list - editorial mono */}
                  <details className="mt-4">
                    <summary className="cursor-pointer list-none text-[11px] tracking-[0.16em] font-mono uppercase underline decoration-1 underline-offset-4 hover:no-underline">
                      (SHOW URLS — {group.urls.length})
                    </summary>
                    <div className="mt-3 border border-neutral-300 bg-white p-3 max-h-[180px] overflow-auto">
                      <ul className="space-y-1">
                        {group.urls.map((u, i) => (
                          <li key={u + i} className="text-[11px] font-mono break-all leading-relaxed">
                            <span className="text-neutral-500">{String(i + 1).padStart(2, "0")}.</span>{" "}
                            <a href={u} target="_blank" rel="noreferrer" className="underline hover:no-underline">
                              {u}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </div>
        ) : !data && !loading ? (
          <>
            <div className="border-b border-neutral-300" />
            <div className="py-16 text-center">
              <div className="text-[11px] tracking-[0.2em] font-mono uppercase text-neutral-500">(EMPTY STATE)</div>
              <p className="mt-3 font-serif italic text-[18px] text-neutral-700">No scan yet.</p>
              <p className="mt-1 text-[12px] font-mono tracking-[0.12em] uppercase text-neutral-500">
                Paste a URL above and press [ SCAN PAGE ]
              </p>
            </div>
            <div className="border-b border-neutral-300" />
          </>
        ) : null}

        {/* footer rule */}
        <div className="border-t border-neutral-900 mt-8 pt-4 flex flex-col md:flex-row justify-between gap-2 text-[11px] tracking-[0.14em] font-mono uppercase text-neutral-500">
          <span>(PIXELVAULT — EDITORIAL / NEO-BRUTALIST)</span>
          <span>(NEXT.JS 14 — AXIOS / CHEERIO — JSZIP)</span>
        </div>
        <div className="h-10" />
      </section>

      {/* LIGHTBOX — fullscreen, neo-brutalist */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-[#f9f9f9] text-neutral-900 flex flex-col">
          {/* top bar */}
          <div className="h-[48px] border-b border-neutral-900 flex items-center justify-between px-4 md:px-6 shrink-0 bg-[#f9f9f9]">
            <span className="text-[11px] tracking-[0.22em] font-mono uppercase hidden md:inline">(VIEWER)</span>
            <span className="text-[11px] tracking-[0.16em] font-mono uppercase">
              (SELECTOR: {lightbox.group.selector}) — {lightbox.idx + 1} / {lightbox.group.urls.length}
            </span>
            <button
              onClick={closeLightbox}
              className="h-[32px] px-4 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900"
            >
              [ CLOSE ]
            </button>
          </div>

          {/* image area */}
          <div className="flex-1 flex items-center justify-center p-4 md:p-8 overflow-hidden relative bg-white">
            {/* prev */}
            <button
              onClick={goPrev}
              className="absolute left-2 md:left-6 top-1/2 -translate-y-1/2 h-[44px] px-4 md:px-6 bg-[#f9f9f9] border border-neutral-900 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-neutral-900 hover:text-white z-10"
              aria-label="Previous"
            >
              [ PREV ]
            </button>

            <img
              src={lightbox.group.urls[lightbox.idx]}
              alt={`Fullscreen ${lightbox.idx + 1}`}
              className="max-w-full max-h-[72vh] md:max-h-[78vh] object-contain border border-neutral-900 bg-[#f9f9f9] rounded-none"
              onError={(e) => {
                const t = e.currentTarget;
                if (!t.dataset.retried) {
                  t.dataset.retried = "1";
                  t.src = `/api/proxy?url=${encodeURIComponent(lightbox.group.urls[lightbox.idx])}`;
                }
              }}
            />

            {/* next */}
            <button
              onClick={goNext}
              className="absolute right-2 md:right-6 top-1/2 -translate-y-1/2 h-[44px] px-4 md:px-6 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900 z-10"
              aria-label="Next"
            >
              [ NEXT ]
            </button>
          </div>

          {/* bottom bar — url + counter */}
          <div className="h-auto md:h-[48px] border-t border-neutral-900 flex flex-col md:flex-row items-center justify-between gap-2 px-4 md:px-6 py-3 bg-[#f9f9f9] shrink-0">
            <span className="text-[11px] font-mono tracking-[0.14em] uppercase text-neutral-500 order-2 md:order-1">
              {String(lightbox.idx + 1).padStart(2, "0")} / {String(lightbox.group.urls.length).padStart(2, "0")}
            </span>
            <a
              href={lightbox.group.urls[lightbox.idx]}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-mono break-all underline hover:no-underline max-w-full md:max-w-[60%] text-center order-1 md:order-2"
            >
              {lightbox.group.urls[lightbox.idx]}
            </a>
            <span className="text-[11px] tracking-[0.16em] font-mono uppercase text-neutral-500 hidden md:inline order-3">
              (ARROWS / ESC)
            </span>
          </div>

          {/* click backdrop to close */}
          <button
            aria-label="Close backdrop"
            onClick={closeLightbox}
            className="absolute inset-0 -z-10"
            tabIndex={-1}
          />
        </div>
      )}
    </main>
  );
}
