"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import JSZip from "jszip";
import { saveAs } from "file-saver";

function VirtualGrid({ urls, group, groupIdx, onOpen }) {
  const [visible, setVisible] = useState(16);
  const sentinelRef = useRef(null);
  useEffect(() => setVisible(16), [urls]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible((v) => Math.min(v + 16, urls.length));
      },
      { rootMargin: "800px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [urls.length, visible < urls.length]);
  const visibleUrls = urls.slice(0, visible);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ contentVisibility: "auto" }}>
        {visibleUrls.map((imgUrl, i) => (
          <button
            key={`${imgUrl}-${i}`}
            onClick={() => onOpen(group, groupIdx, i)}
            className="aspect-square bg-white border border-neutral-900 overflow-hidden rounded-none"
          >
            <img
              src={imgUrl}
              alt={`${group.selector} ${i + 1}`}
              loading="lazy"
              decoding="async"
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
      {visible < urls.length && (
        <div ref={sentinelRef} className="py-6 flex flex-col items-center gap-3">
          <div className="text-[11px] tracking-[0.16em] font-mono uppercase text-neutral-500">
            ({visible} / {urls.length} — {urls.length - visible} MORE)
          </div>
          <button
            onClick={() => setVisible((v) => Math.min(v + 32, urls.length))}
            className="border border-neutral-900 bg-white px-6 py-2 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-neutral-900 hover:text-white"
          >
            [ LOAD MORE ]
          </button>
        </div>
      )}
    </>
  );
}

function sanitizeForFilename(name) {
  if (!name) return "Product_Images";
  return name.replace(/[<>:"/\\|?*]+/g, "").trim().replace(/\s+/g, "_").substring(0, 80) || "Product_Images";
}
function getSafeFilename(url, index) {
  try {
    const parsed = new URL(url);
    let raw = parsed.pathname.split("/").pop()?.split("?")[0] || "";
    raw = raw.replace(/[<>:"/\\|?*]+/g, "_").trim();
    if (!raw || raw.length < 2) raw = `image_${index + 1}.jpg`;
    if (!/\.[a-z0-9]{2,5}$/i.test(raw)) raw = raw + ".jpg";
    return `${index + 1}_${raw.replace(/\s+/g, "_")}`;
  } catch {
    return `${index + 1}_image_${index + 1}.jpg`;
  }
}

export default function HistoryDetailPage() {
  const params = useParams();
  const id = params.id;
  const [entry, setEntry] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [downloadingIndex, setDownloadingIndex] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pixelvault_history");
      const history = raw ? JSON.parse(raw) : [];
      const found = history.find((h) => h.id === id);
      setEntry(found || null);
    } catch {}
    setLoaded(true);
  }, [id]);

  const fetchAndAddToZip = async (zip, imageUrl, filename) => {
    const proxied = `/api/proxy?url=${encodeURIComponent(imageUrl)}`;
    let res = await fetch(proxied);
    if (!res.ok) try { res = await fetch(imageUrl, { mode: "cors" }); } catch { throw new Error(`Proxy ${res.status}`); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (blob.type.includes("text/html") && blob.size < 6000) {
      const text = await blob.text().catch(() => "");
      if (text.includes("<html")) throw new Error("HTML instead of image");
      zip.file(filename, blob);
    } else zip.file(filename, blob);
  };

  const handleDownloadCategory = async (group, groupIndex) => {
    if (!entry?.title) return;
    setDownloadingIndex(groupIndex); setError("");
    const zip = new JSZip(); const zipName = `${sanitizeForFilename(entry.title)}_${sanitizeForFilename(group.selector)}.zip`;
    let ok=0,fail=0;
    for(let i=0;i<group.urls.length;i++){ try{ await fetchAndAddToZip(zip, group.urls[i], getSafeFilename(group.urls[i],i)); ok++; }catch(e){ fail++; } }
    if(ok===0){ setError(`All failed`); setDownloadingIndex(null); return; }
    try{ const c=await zip.generateAsync({type:"blob"}); saveAs(c,zipName); if(fail>0) setError(`Downloaded ${ok}/${group.urls.length} — ${fail} failed.`);}catch(e){ setError(e.message);} finally{ setDownloadingIndex(null); }
  };

  const handleDownloadAll = async () => {
    if(!entry?.groups) return; setDownloadingAll(true); setError("");
    const allUrls=entry.groups.flatMap(g=>g.urls); const zip=new JSZip(); const zipName=`${sanitizeForFilename(entry.title)}_ALL.zip`;
    let ok=0,fail=0,gi=0; for(const g of entry.groups){ for(let i=0;i<g.urls.length;i++){ try{ await fetchAndAddToZip(zip,g.urls[i],getSafeFilename(g.urls[i],gi)); ok++; }catch{ fail++; } gi++; } }
    if(ok===0){ setError(`All failed`); setDownloadingAll(false); return; }
    try{ const c=await zip.generateAsync({type:"blob"}); saveAs(c,zipName); if(fail>0) setError(`${ok}/${allUrls.length}`);}catch(e){ setError(e.message);} finally{ setDownloadingAll(false); }
  };

  const openLightbox=(group,groupIdx,idx)=>setLightbox({group,groupIdx,idx});
  const closeLightbox=()=>setLightbox(null);
  const goNext=()=>setLightbox(p=>p?{...p,idx:(p.idx+1)%p.group.urls.length}:p);
  const goPrev=()=>setLightbox(p=>p?{...p,idx:(p.idx-1+p.group.urls.length)%p.group.urls.length}:p);
  const handleDownloadSingle=async()=>{
    if(!lightbox) return;
    const url=lightbox.group.urls[lightbox.idx];
    try{
      const proxied=`/api/proxy?url=${encodeURIComponent(url)}`;
      let res=await fetch(proxied);
      if(!res.ok) res=await fetch(url,{mode:"cors"});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob=await res.blob();
      saveAs(blob,getSafeFilename(url,lightbox.idx));
    }catch{ window.open(url,"_blank"); }
  };
  useEffect(()=>{
    if(!lightbox) return;
    const onKey=e=>{ if(e.key==="Escape") closeLightbox(); if(e.key==="ArrowRight") goNext(); if(e.key==="ArrowLeft") goPrev(); };
    window.addEventListener("keydown",onKey); const prev=document.body.style.overflow; document.body.style.overflow="hidden";
    return()=>{ window.removeEventListener("keydown",onKey); document.body.style.overflow=prev; };
  },[lightbox]);

  if (!loaded) return <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center text-[11px] tracking-[0.2em] font-mono uppercase">(LOADING...)</div>;
  if (!entry) return (
    <main className="min-h-screen bg-[#f9f9f9] text-neutral-900">
      <div className="max-w-[1280px] mx-auto px-6 md:px-8 py-16 text-center">
        <div className="text-[11px] tracking-[0.2em] font-mono uppercase text-neutral-500">(NOT FOUND)</div>
        <p className="mt-3 font-serif italic text-[18px]">History entry not found.</p>
        <Link href="/history" className="mt-6 inline-block border border-neutral-900 px-6 py-2 text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-neutral-900 hover:text-white">[ BACK TO HISTORY ]</Link>
      </div>
    </main>
  );

  const totalImages = entry.groups.reduce((a,g)=>a+g.urls.length,0);

  return (
    <main className="min-h-screen bg-[#f9f9f9] text-neutral-900 selection:bg-neutral-900 selection:text-white overflow-x-hidden">
      <header className="border-b border-neutral-900">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 h-[48px] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Link href="/" className="flex items-center gap-2">
              <img src="/logo.svg" alt="PIXELVAULT" className="h-[22px] sm:h-[28px] w-auto" />
              <span className="text-[10px] sm:text-[11px] tracking-[0.22em] font-mono uppercase hover:underline hidden md:inline">(HOME)</span>
            </Link>
            <Link href="/history" className="text-[10px] sm:text-[11px] tracking-[0.22em] font-mono uppercase border border-neutral-900 px-2 sm:px-2.5 py-1 bg-white hover:bg-neutral-900 hover:text-white">(HISTORY)</Link>
          </div>
          <span className="text-[10px] sm:text-[11px] tracking-[0.22em] font-mono uppercase hidden md:inline truncate">(DETAIL)</span>
          <a href={entry.pageUrl} target="_blank" rel="noreferrer" className="text-[11px] tracking-[0.16em] font-mono uppercase underline hover:no-underline max-w-[40%] truncate hidden lg:inline">{entry.pageUrl}</a>
        </div>
      </header>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8">
        <div className="pt-6 sm:pt-8 pb-6">
          <Link href="/history" className="text-[11px] tracking-[0.2em] font-mono uppercase underline hover:no-underline">← (BACK)</Link>
          <h1 className="mt-3 font-serif text-[20px] sm:text-[24px] md:text-[32px] leading-tight break-words">{entry.title}</h1>
          <a href={entry.pageUrl} target="_blank" rel="noreferrer" className="mt-2 block text-[11px] font-mono break-all text-neutral-500 underline hover:no-underline">{entry.pageUrl}</a>
          <div className="mt-3 flex flex-wrap gap-2 text-[10px] sm:text-[11px] tracking-[0.16em] font-mono uppercase">
            <span className="border border-neutral-900 px-2 py-1 bg-white">(GROUPS: {entry.groupsCount})</span>
            <span className="border border-neutral-900 px-2 py-1 bg-white">(IMAGES: {totalImages})</span>
            <span className="border border-neutral-300 px-2 py-1 bg-white text-neutral-500 break-all">({new Date(entry.createdAt).toLocaleString()})</span>
          </div>
        </div>

        <div className="border-b border-neutral-900" />
        <div className="py-4 flex justify-end">
          <button onClick={handleDownloadAll} disabled={downloadingAll||downloadingIndex!==null} className="h-[44px] w-full sm:w-auto px-6 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[12px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900 disabled:opacity-50">
            {downloadingAll ? "( ZIPPING ALL... )" : "(DOWNLOAD ALL IMAGES)"}
          </button>
        </div>
        {error && (
          <div className="mb-4 border border-red-600 bg-white px-4 py-2 text-[12px] font-mono text-red-700">(ERROR) — {error}</div>
        )}
        <div className="border-b border-neutral-300 mb-6" />

        <div className="border-t border-neutral-900">
          {entry.groups.map((group, idx) => (
            <div key={`${group.selector}-${idx}`} className="border-b border-neutral-300 py-5 sm:py-6">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-2 break-words">
                  <span className="text-[11px] sm:text-[12px] tracking-[0.14em] font-mono uppercase break-all">(SELECTOR: {group.selector})</span>
                  <span className="text-[11px] sm:text-[12px] tracking-[0.14em] font-mono uppercase text-neutral-500">— {group.urls.length} IMAGES</span>
                </div>
                <button onClick={() => handleDownloadCategory(group, idx)} disabled={downloadingIndex!==null||downloadingAll} className="w-full sm:w-auto self-stretch sm:self-start text-[11px] tracking-[0.16em] font-mono uppercase border border-neutral-900 bg-white px-3 py-2.5 hover:bg-neutral-900 hover:text-white disabled:opacity-50">
                  {downloadingIndex===idx ? "( ZIPPING... )" : "[ DOWNLOAD CATEGORY ]"}
                </button>
              </div>
              <div className="mt-4 border-b border-neutral-200" />
              <div className="mt-4">
                <VirtualGrid urls={group.urls} group={group} groupIdx={idx} onOpen={openLightbox} />
              </div>
            </div>
          ))}
        </div>

        <div className="h-10" />
      </section>

      {lightbox && (
        <div className="fixed inset-0 z-50 bg-[#f9f9f9] text-neutral-900 flex flex-col">
          <div className="min-h-[48px] border-b border-neutral-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-3 sm:px-4 md:px-6 py-2 sm:py-0 bg-[#f9f9f9]">
            <span className="text-[10px] sm:text-[11px] tracking-[0.16em] font-mono uppercase break-all line-clamp-1">(SELECTOR: {lightbox.group.selector}) — {lightbox.idx+1} / {lightbox.group.urls.length}</span>
            <div className="flex items-center gap-2 self-stretch sm:self-auto">
              <button onClick={handleDownloadSingle} className="flex-1 sm:flex-none h-[36px] sm:h-[32px] px-3 sm:px-4 bg-white border border-neutral-900 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-neutral-900 hover:text-white">[ DOWNLOAD ]</button>
              <button onClick={closeLightbox} className="flex-1 sm:flex-none h-[36px] sm:h-[32px] px-3 sm:px-4 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900">[ CLOSE ]</button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-2 sm:p-0 overflow-hidden relative bg-white">
            <button onClick={goPrev} className="absolute left-2 sm:left-3 md:left-6 top-1/2 -translate-y-1/2 h-[36px] sm:h-[44px] px-3 sm:px-4 md:px-6 bg-[#f9f9f9] border border-neutral-900 rounded-none text-[10px] sm:text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-neutral-900 hover:text-white z-10">[ PREV ]</button>
            <img src={lightbox.group.urls[lightbox.idx]} alt="" className="h-[calc(100dvh-120px)] sm:h-[calc(100dvh-96px)] w-auto max-w-[92vw] sm:max-w-[88vw] md:max-w-[80vw] object-contain border border-neutral-900 bg-[#f9f9f9] rounded-none" onError={e=>{ const t=e.currentTarget; if(!t.dataset.retried){ t.dataset.retried="1"; t.src=`/api/proxy?url=${encodeURIComponent(lightbox.group.urls[lightbox.idx])}`; }}} />
            <button onClick={goNext} className="absolute right-2 sm:right-3 md:right-6 top-1/2 -translate-y-1/2 h-[36px] sm:h-[44px] px-3 sm:px-4 md:px-6 bg-neutral-900 text-white border border-neutral-900 rounded-none text-[10px] sm:text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900 z-10">[ NEXT ]</button>
          </div>
          <div className="min-h-[48px] border-t border-neutral-900 flex flex-col sm:flex-row items-center justify-between gap-1 sm:gap-2 px-3 sm:px-4 md:px-6 py-2 sm:py-3 bg-[#f9f9f9]">
            <span className="text-[11px] font-mono tracking-[0.14em] uppercase text-neutral-500 order-2 sm:order-1">{String(lightbox.idx+1).padStart(2,"0")} / {String(lightbox.group.urls.length).padStart(2,"0")}</span>
            <span className="text-[11px] tracking-[0.16em] font-mono uppercase text-neutral-500 hidden md:inline order-3">(ARROWS / ESC)</span>
          </div>
        </div>
      )}
    </main>
  );
}
