import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// CSP nonces are per-request, so every page must render dynamically
// (see lib/security-headers.ts); static HTML cannot carry a nonce.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tallyline",
  description: "Agent-native issue tracker",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
