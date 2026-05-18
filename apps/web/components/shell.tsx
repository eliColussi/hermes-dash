"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { PersistenceBanner } from "@/components/persistence-banner";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

// Wraps the app chrome but skips Sidebar/Topbar/banner on auth pages
// (otherwise the login screen renders inside a sidebar showing nav items
// the user can't actually use yet).
//
// Responsive: on md+ the sidebar is a permanent column (existing layout
// untouched). On smaller screens it becomes an overlay drawer toggled by
// a hamburger button in the topbar.
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = pathname === "/login" || pathname?.startsWith("/login/");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (bare) return <>{children}</>;
  return (
    <div className="flex flex-col h-screen">
      <PersistenceBanner />
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
        />
        {/* Backdrop that closes the drawer when tapped — only on mobile */}
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 bg-black/40 z-30 md:hidden"
          />
        )}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />
          <div className="flex-1 overflow-y-auto p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
