"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

export default function HistoryPage() {
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("pixelvault_history");
      setHistory(raw ? JSON.parse(raw) : []);
    } catch {}
    setLoaded(true);
  }, []);

  const clearAll = () => {
    if (!confirm("Clear all history?")) return;
    localStorage.removeItem("pixelvault_history");
    setHistory([]);
  };

  const removeOne = (id) => {
    const filtered = history.filter((h) => h.id !== id);
    setHistory(filtered);
    localStorage.setItem("pixelvault_history", JSON.stringify(filtered));
  };

  return (
    <main className="min-h-screen bg-[#f9f9f9] text-neutral-900 selection:bg-neutral-900 selection:text-white">
      <header className="border-b border-neutral-900">
        <div className="max-w-[1280px] mx-auto px-6 md:px-8 h-[48px] flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-6">
            <Link href="/" className="text-[11px] tracking-[0.22em] font-mono uppercase hover:underline">(HOME)</Link>
            <span className="text-[11px] tracking-[0.22em] font-mono uppercase bg-neutral-900 text-white px-2.5 py-1">(HISTORY)</span>
          </div>
          <span className="text-[11px] tracking-[0.22em] font-mono uppercase hidden md:inline">(IMAGE SCRAPER — 2026)</span>
          <a href="https://github.com/rohitkumar91131/image-scrapper" target="_blank" rel="noreferrer" className="text-[11px] tracking-[0.22em] font-mono uppercase hover:underline">(GITHUB)</a>
        </div>
      </header>

      <section className="max-w-[1280px] mx-auto px-6 md:px-8">
        <div className="pt-10 md:pt-12 pb-6">
          <h1 className="text-[48px] md:text-[72px] font-black tracking-tighter leading-none uppercase">HISTORY</h1>
          <p className="mt-3 text-[11px] tracking-[0.18em] font-mono uppercase text-neutral-500">
            (ALL SCANS — STORED IN LOCAL STORAGE) — {history.length} ITEMS
          </p>
        </div>
        <div className="border-b border-neutral-300" />

        <div className="py-6 flex items-center justify-between">
          <span className="text-[11px] tracking-[0.2em] font-mono uppercase">(LIST)</span>
          {history.length > 0 && (
            <button onClick={clearAll} className="text-[11px] tracking-[0.16em] font-mono uppercase border border-red-600 px-3 py-1.5 bg-white hover:bg-red-600 hover:text-white">
              [ CLEAR ALL ]
            </button>
          )}
        </div>

        {!loaded ? (
          <div className="py-16 text-center text-[11px] tracking-[0.2em] font-mono uppercase text-neutral-500">(LOADING...)</div>
        ) : history.length === 0 ? (
          <>
            <div className="border-t border-neutral-900" />
            <div className="py-16 text-center">
              <div className="text-[11px] tracking-[0.2em] font-mono uppercase text-neutral-500">(EMPTY)</div>
              <p className="mt-3 font-serif italic text-[18px] text-neutral-700">No history yet.</p>
              <p className="mt-1 text-[12px] font-mono tracking-[0.12em] uppercase text-neutral-500">Scan a page on <Link href="/" className="underline hover:no-underline">(HOME)</Link></p>
            </div>
            <div className="border-b border-neutral-300" />
          </>
        ) : (
          <div className="border-t border-neutral-900">
            {history.map((item) => (
              <div key={item.id} className="border-b border-neutral-300 py-6 flex flex-col md:flex-row gap-4 justify-between">
                <div className="min-w-0 flex-1">
                  <Link href={`/history/${item.id}`} className="group">
                    <h2 className="font-serif text-[18px] md:text-[20px] leading-tight group-hover:underline decoration-1 underline-offset-4 break-words">{item.title || "Untitled"}</h2>
                  </Link>
                  <a href={item.pageUrl} target="_blank" rel="noreferrer" className="mt-1 block text-[11px] font-mono break-all text-neutral-500 underline hover:no-underline">
                    {item.pageUrl}
                  </a>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] tracking-[0.14em] font-mono uppercase">
                    <span className="border border-neutral-900 px-2 py-1 bg-white">(IMAGES: {item.totalImages})</span>
                    <span className="border border-neutral-900 px-2 py-1 bg-white">(GROUPS: {item.groupsCount})</span>
                    <span className="border border-neutral-300 px-2 py-1 bg-white text-neutral-500">({new Date(item.createdAt).toLocaleString()})</span>
                  </div>
                </div>
                <div className="flex md:flex-col gap-2 shrink-0">
                  <Link href={`/history/${item.id}`} className="h-[36px] px-5 flex items-center justify-center bg-neutral-900 text-white border border-neutral-900 rounded-none text-[11px] tracking-[0.16em] font-mono uppercase hover:bg-white hover:text-neutral-900">
                    [ VIEW ]
                  </Link>
                  <button onClick={() => removeOne(item.id)} className="h-[36px] px-5 border border-neutral-300 bg-white text-[11px] tracking-[0.16em] font-mono uppercase hover:border-red-600 hover:text-red-600">
                    [ DELETE ]
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-neutral-900 mt-8 pt-4 flex justify-between text-[11px] tracking-[0.14em] font-mono uppercase text-neutral-500">
          <span>(PIXELVAULT — HISTORY)</span>
          <Link href="/" className="hover:underline">(BACK TO SCANNER)</Link>
        </div>
        <div className="h-10" />
      </section>
    </main>
  );
}
