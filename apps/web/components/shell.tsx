"use client";

import { usePathname } from "next/navigation";
import { PersistenceBanner } from "@/components/persistence-banner";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

// Wraps the app chrome but skips Sidebar/Topbar/banner on auth pages
// (otherwise the login screen renders inside a sidebar showing nav items
// the user can't actually use yet).
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/login" || pathname?.startsWith("/login/");
  if (bare) return <>{children}</>;
  return (
    <div className="flex flex-col h-screen">
      <PersistenceBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Topbar />
          <div className="flex-1 overflow-y-auto p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
