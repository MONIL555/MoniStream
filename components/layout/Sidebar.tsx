'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Home, Search, Heart, ShieldAlert, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import useSWR from 'swr';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { CreatePlaylistModal } from '@/components/layout/CreatePlaylistModal';
import { Skeleton } from '@/components/ui/skeleton';

const NAV_ITEMS = [
  { icon: Home, label: 'Home', href: '/' },
  { icon: Search, label: 'Search', href: '/search' },
  { icon: Heart, label: 'Liked Songs', href: '/collection/tracks' },
];

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) return []; // Return empty array on auth failure — avoids 401 noise
  return res.json();
};

export function Sidebar() {
  const pathname = usePathname();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { user } = useAuth();
  const isAuthenticated = !!user;
  const { data: playlists } = useSWR(
    isAuthenticated ? '/api/playlists' : null,
    fetcher
  );

  return (
    <aside className="hidden md:flex flex-col w-[200px] h-[calc(100vh-2rem)] my-4 ml-4 z-20 shrink-0">
      <div className="clay-panel flex flex-col h-full overflow-hidden">
        
        {/* Brand */}
        <div className="p-6 pb-2">
          <Link href="/" className="flex items-center gap-3 group">
            <Image src="/logo-v3.png" alt="MoniStream Logo" width={40} height={40} className="drop-shadow-md hover:scale-105 transition-transform duration-300 rounded-xl" />
            <span className="font-bold text-xl tracking-tight text-foreground">MoniStream</span>
          </Link>
        </div>

        {/* Main Navigation */}
        <nav className="flex flex-col flex-1 px-4 mt-6 space-y-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300",
                  isActive 
                    ? "clay-inset text-brand-primary" 
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                )}
              >
                <item.icon className={cn("h-5 w-5", isActive ? "text-brand-primary" : "text-muted-foreground")} />
                {item.label}
              </Link>
            );
          })}
          
          {user?.role === 'admin' && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 mt-2",
                pathname.startsWith('/admin')
                  ? "clay-inset text-brand-primary" 
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
              )}
            >
              <ShieldAlert className={cn("h-5 w-5", pathname.startsWith('/admin') ? "text-brand-primary" : "text-muted-foreground")} />
              Admin
            </Link>
          )}
        </nav>

        {/* Playlists */}
        <div className="px-4 mt-6 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 mb-2">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Playlists</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex-1 overflow-y-auto hide-scrollbar space-y-1 pb-4">
            {!playlists ? (
              <div className="px-3 flex flex-col gap-3 mt-2">
                <Skeleton className="h-4 w-3/4 rounded" />
                <Skeleton className="h-4 w-5/6 rounded" />
                <Skeleton className="h-4 w-2/3 rounded" />
              </div>
            ) : Array.isArray(playlists) && playlists.map((pl: any) => (
              <Link
                key={pl._id}
                href={`/playlist/${pl._id}`}
                className={cn(
                  "block px-3 py-2 rounded-lg text-xs font-medium transition-colors truncate",
                  pathname === `/playlist/${pl._id}`
                    ? "clay-inset text-brand-primary"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                )}
              >
                {pl.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
      
      <CreatePlaylistModal  
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)} 
      />
    </aside>
  );
}
