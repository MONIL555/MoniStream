'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Search as SearchIcon, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn, safeDecodeURIComponent } from '@/lib/utils';

export function SearchBar() {
  const router = useRouter();
  const params = useParams();
  
  const rawQuery = (params.query as string) || '';
  const currentQuery = rawQuery ? safeDecodeURIComponent(rawQuery) : '';
  
  const [query, setQuery] = useState(currentQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (window.location.pathname === '/search' && !currentQuery) {
      inputRef.current?.focus();
    }
  }, [currentQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim()) {
        router.push(`/search/${encodeURIComponent(query.trim())}`);
        const recent = JSON.parse(localStorage.getItem('recentSearches') || '[]');
        const updated = [query.trim(), ...recent.filter((q: string) => q !== query.trim())].slice(0, 10);
        localStorage.setItem('recentSearches', JSON.stringify(updated));
      } else if (query === '' && currentQuery !== '') {
        router.push('/search');
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [query, router, currentQuery]);

  const clearSearch = () => {
    setQuery('');
    router.push('/search');
    inputRef.current?.focus();
  };

  return (
    <div className="relative w-full max-w-lg mx-auto flex items-center group">
      <div className="absolute left-4 text-muted-foreground group-focus-within:text-brand-primary transition-colors z-10">
        <SearchIcon className="h-5 w-5" />
      </div>
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="What do you want to listen to?"
        className="pl-12 pr-12 rounded-full h-14 text-base font-semibold shadow-sm transition-all focus-within:shadow-md"
      />
      {query && (
        <Button
          variant="ghost"
          size="icon"
          onClick={clearSearch}
          className="absolute right-2 h-10 w-10 rounded-full text-muted-foreground hover:text-foreground z-10"
        >
          <X className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
