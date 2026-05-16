import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { QueryProvider } from "@/components/query-provider";

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// Fraunces is a variable serif with optical sizing — looks editorial at
// display sizes, civilised at small sizes. Used for h1 / display only.
const display = Fraunces({
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Staff Room OS",
  description: "Your autonomous AI staff room.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <QueryProvider>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 flex flex-col overflow-hidden">
              <Topbar />
              <div className="flex-1 overflow-y-auto p-8">{children}</div>
            </main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
