import "./globals.css";
import type { Metadata } from "next";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { QueryProvider } from "@/components/query-provider";

export const metadata: Metadata = {
  title: "Staff Room OS",
  description: "Your autonomous AI staff room.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
