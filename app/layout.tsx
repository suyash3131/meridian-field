import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Shell from "./shell";
import "./globals.css";

/* Geist for text, Geist Mono for every figure: one family, so the numbers
   feel like part of the sentence rather than pasted in from a spreadsheet. */
const sans = Geist({ variable: "--font-geist", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Meridian Field",
  description: "An agentic CRM for a pharmaceutical field sales team",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <body className="h-full">
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
