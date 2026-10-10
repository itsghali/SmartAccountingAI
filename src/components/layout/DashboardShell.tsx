"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { AppProvider } from "@/hooks/useAppContext";
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export default function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SessionProvider>
      <AppProvider>
        <div className="flex h-screen overflow-hidden bg-background text-foreground transition-colors duration-500">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden relative">
            <Topbar
              onMobileMenuToggle={() => setSidebarOpen(!sidebarOpen)}
            />
            <main className="flex-1 overflow-y-auto p-4 md:p-6">
              {children}
            </main>
          </div>
        </div>
      </AppProvider>
    </SessionProvider>
  );
}
