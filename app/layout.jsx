import "./globals.css";

export const metadata = {
  title: "Visual Intelligent Bot | Image Scraper",
  description: "Smart image scraper - group and download images by CSS selector",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
