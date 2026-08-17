'use client';

import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { MobileNav } from '@/components/layout/MobileNav';
import { Player } from '@/components/player/Player';
import { Toaster } from 'sonner';
import { SWRConfig } from 'swr';
import { useConfigStore } from '@/store/configStore';

function ConfigLoader() {
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  useEffect(() => { fetchConfig(); }, [fetchConfig]);
  return null;
}
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SWRConfig 
      value={{
        revalidateOnFocus: false, // Don't fetch when switching tabs
        revalidateIfStale: false, // Don't fetch on remount if we already have data
        dedupingInterval: 1000 * 60 * 5, // Deduplicate requests with same key within 5 minutes
        errorRetryCount: 2,
      }}
    >
      <ConfigLoader />
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-background selection:bg-brand-primary/30">
        <div className="flex flex-1 overflow-hidden">
          {/* Desktop Sidebar */}
          <Sidebar />

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col min-w-0 relative h-full">
            {/* Top Navigation */}
            <TopBar />

            {/* Page Content */}
            <main className="flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar gpu-scroll px-3 md:px-8 pt-2 md:pt-4">
              <div className="mx-auto max-w-7xl min-h-full pb-40 md:pb-32">
                {children}
              </div>
            </main>
          </div>
        </div>

        {/* Mobile Navigation */}
        <MobileNav />

        {/* Global Player Dock */}
        <Player />

        {/* Notifications */}
        <Toaster 
          theme="system" 
          toastOptions={{
            className: 'clay-card !bg-surface !border-none !text-foreground !shadow-2xl font-bold',
          }}
        />
      </div>
    </SWRConfig>
  );
}
