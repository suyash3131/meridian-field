import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Meridian Field",
  description: "An agentic CRM for a pharmaceutical field sales team",
};

const TABS = [
  { href: "/", label: "Today" },
  { href: "/ask", label: "Ask" },
  { href: "/rep", label: "Rep view" },
  { href: "/health", label: "Agent health" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Link href="/" className="font-semibold tracking-tight">
              Meridian <span className="text-muted font-normal">Field</span>
            </Link>
            <nav className="flex gap-4 text-sm">
              {TABS.map((t) => (
                <Link key={t.href} href={t.href} className="text-muted hover:text-foreground">
                  {t.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-line mt-12">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 text-xs text-muted">
            Demo data. Meridian Healthcare is invented for this exercise. Everyone sees everything —
            there is no login, by design.
          </div>
        </footer>
      </body>
    </html>
  );
}
