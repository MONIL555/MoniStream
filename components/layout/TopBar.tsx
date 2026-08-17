'use client';

import { useRouter, usePathname } from 'next/navigation';
import { ChevronLeft, ChevronRight, User, Settings, LogOut, Search, HelpCircle, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown';
import Link from 'next/link';
import Image from 'next/image';
import React, { useState, useRef, useEffect } from 'react';

function SearchInput() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Auto-focus on mount
    inputRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim()) {
        router.push(`/search/${encodeURIComponent(value.trim())}`);
      } else {
        router.push('/search');
      }
    }, 350);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      router.push(`/search/${encodeURIComponent(query.trim())}`);
    }
  };

  return (
    <div className="relative w-full max-w-sm">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="What do you want to listen to?"
        className="w-full h-10 clay-inset rounded-full pl-10 pr-4 bg-transparent text-foreground text-sm font-medium placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-primary/30 transition-all text-ellipsis overflow-hidden whitespace-nowrap"
      />
    </div>
  );
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();
  const [isStandalone, setIsStandalone] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const checkStandalone = () => {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://')
      );
    };
    
    setIsStandalone(checkStandalone());
    
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  return (
    <header className="sticky top-2 md:top-4 z-40 flex h-16 items-center justify-between px-4 md:px-6 pt-2 pb-2 transition-all duration-300 mx-2 md:mx-4 rounded-2xl bg-background/80 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      {/* Navigation / Brand */}
      <div className={`flex items-center gap-2 pl-1 ${pathname.startsWith('/search') ? 'hidden md:flex md:flex-1' : 'flex-1'}`}>
        {!pathname.startsWith('/search') && (
          <div className="flex items-center gap-2 md:hidden animate-fade-in">
            <Image src="/logo-v3.png" alt="MoniStream Logo" width={32} height={32} className="drop-shadow-md rounded-lg" />
            <span className="font-bold text-lg tracking-tight text-foreground">MoniStream</span>
          </div>
        )}
      </div>

      {/* Center: Search Bar (visible on all routes, navigates to /search) */}
      <div className={`flex-1 flex justify-center max-w-lg ${pathname.startsWith('/search') ? 'px-1 md:px-4' : 'px-4'}`}>
        {pathname.startsWith('/search') ? (
          <React.Suspense fallback={<div className="h-10 w-full max-w-sm rounded-full clay-inset animate-pulse" />}>
            <SearchInput />
          </React.Suspense>
        ) : null}
      </div>

      {/* User Actions */}
      <div className="flex items-center gap-3">
        {!isAuthenticated ? (
          <>
            <Button variant="ghost" className="hidden sm:flex rounded-full px-5 font-bold text-sm">
              <Link href="/register">Sign up</Link>
            </Button>
            <Button variant="brand" className="rounded-full px-6 font-bold text-white text-sm">
              <Link href="/login">Log in</Link>
            </Button>
          </>
        ) : (
          <DropdownMenu 
            trigger={
              <div className="h-10 w-10 rounded-full clay-btn flex items-center justify-center p-0.5 cursor-pointer hover:scale-105 transition-transform">
                <Avatar 
                  size="sm" 
                  src={user?.avatarUrl || ''} 
                  alt={user?.displayName || ''} 
                  fallbackColor={user?.avatarColor}
                  className="h-full w-full shadow-none border-none"
                />
              </div>
            }
          >
            <div className="p-1 min-w-[200px]">
              <DropdownMenuLabel>
                <div className="flex flex-col space-y-1 py-1">
                  <p className="text-sm font-bold text-foreground">{user?.displayName}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/profile')}>
                <User className="mr-3 h-4 w-4" />
                <span className="font-semibold">Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Settings className="mr-3 h-4 w-4" />
                <span className="font-semibold">Settings</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/help')}>
                <HelpCircle className="mr-3 h-4 w-4" />
                <span className="font-semibold">Help & Features</span>
              </DropdownMenuItem>
              {!isStandalone && (
                <DropdownMenuItem onClick={async () => {
                  if (deferredPrompt) {
                    deferredPrompt.prompt();
                    const { outcome } = await deferredPrompt.userChoice;
                    if (outcome === 'accepted') {
                      setDeferredPrompt(null);
                    }
                  } else {
                    alert("To install the app, tap your browser's menu and select 'Add to Home Screen' or 'Install App'. On iOS Safari, tap the Share button and select 'Add to Home Screen'.");
                  }
                }}>
                  <Download className="mr-3 h-4 w-4" />
                  <span className="font-semibold">Install as App</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive hover:text-destructive">
                <LogOut className="mr-3 h-4 w-4" />
                <span className="font-semibold">Log out</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
