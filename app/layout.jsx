import "./globals.css";

export const metadata = {
  title: "PIXELVAULT — Editorial Image Scraper",
  description: "Minimalist neo-brutalist image scraper — PIXELVAULT",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-[#f9f9f9] text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
