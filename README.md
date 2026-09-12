# Visual Intelligent Bot - Image Scrapper

Migrated Node.js CLI image scraping script into a full-stack **Next.js 14 (App Router)** web application.

## Tech Stack
- Next.js 14 / App Router, React 18, Tailwind CSS
- axios, cheerio, jszip, file-saver

## Features
- **Smart Extraction**: `<img src>`, `data-src`, `data-original`, `srcset` (highest resolution), `<picture><source>`, inline `background-image`
- **Grouping**: Groups images by tag + CSS class or parent class (crash-safe `parent()[0]`)
- **Robust Fetch**: 10s timeout, spoofed User-Agent, HTTP status validation
- **Deduplication** within groups & absolute URL resolution via `new URL(src, base)`
- **ZIP Download**: Client-side via JSZip + file-saver, safe filenames `1_image.jpg`, sanitized product title from `<h1>`
- **CORS Proxy**: `app/api/proxy/route.js` pipes images server-side

## Project Structure
```
app/
  actions/scraper.js    # Server Action scrapeImages(pageUrl)
  api/proxy/route.js    # CORS proxy
  page.jsx              # Client UI with Tailwind + ZIP download
  layout.jsx
  globals.css
```

## Getting Started

```bash
# install
npm install

# dev
npm run dev
# open http://localhost:3000

# build
npm run build
npm start
```

## Usage
1. Paste product Detail Page URL
2. Click **Scan** - view groups sorted by image count with live previews
3. Click **Download This Group as ZIP** - fetches via `/api/proxy` and saves as `<sanitized_title>.zip`

## Server Action Return
```json
{ "success": true, "title": "Product Name", "groups": [ { "selector": "img.gallery", "urls": ["https://..."] } ] }
```

## Proxy
`GET /api/proxy?url=https://example.com/image.jpg` - use when direct `fetch(url)` hits CORS.

---
Built from CLI script migration.
