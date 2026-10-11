import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// CSP nonces are per-request, so every page must render dynamically
// (see lib/security-headers.ts); static HTML cannot carry a nonce.
export const dynamic = "force-dynamic";

const description = "Agent-native issue tracker";

// Icons, apple-icon, opengraph-image and twitter-image come from the file
// conventions in this directory (regenerate with tools/brand/export.mjs).
export const metadata: Metadata = {
  metadataBase: new URL(process.env.WEB_URL ?? "http://localhost:3100"),
  title: "Tallyline",
  description,
  openGraph: { title: "Tallyline", description, siteName: "Tallyline", type: "website" },
  twitter: { card: "summary_large_image", title: "Tallyline", description },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
