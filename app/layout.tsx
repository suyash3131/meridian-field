import type { Metadata } from "next";
import Link from "next/link";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/* Plex rather than the usual geometric sans: it has an industrial, slightly
   engineered feel that suits a field-operations tool, and it is not the
   typeface every generated app arrives in. Mono carries every figure. */
const sans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Meridian Field",
  description: "An agentic CRM for a pharmaceutical field sales team",
};

const TABS = [
  { href: "/", label: "Today" },
  { href: "/ask", label: "Eight o'clock" },
  { href: "/rep", label: "At the counter" },
  { href: "/health", label: "Agent health" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        {/* A masthead, not a nav bar: the name sits on the baseline with the
            sections, separated by a single firm rule. */}
        <header className="border-b border-rule-firm">
          <div className="mx-auto max-w-[68rem] px-5 sm:px-8">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 py-3.5">
              <Link href="/" className="flex items-baseline gap-2.5">
                <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">
                  Meridian
                </span>
                <span className="h-3 w-px bg-rule-firm translate-y-[1px]" aria-hidden />
                <span className="text-[0.8125rem] text-ink-faint">Field</span>
              </Link>
              <nav className="flex items-baseline gap-5 sm:gap-6">
                {TABS.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className="text-[0.8125rem] text-ink-soft hover:text-ink
                               underline-offset-[6px] decoration-rule-firm hover:underline"
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="mt-20 border-t border-rule">
          <div className="mx-auto max-w-[68rem] px-5 sm:px-8 py-5">
            <p className="label leading-relaxed">
              Demo data · Meridian Healthcare is invented for this exercise ·
              No login anywhere, by design
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
