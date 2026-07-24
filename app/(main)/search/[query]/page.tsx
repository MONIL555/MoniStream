'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { TrackRow } from '@/components/music/TrackRow';
import { ArtistRow } from '@/components/music/ArtistRow';
import { useParams } from 'next/navigation';
import { Loader2, Music2, Users, SquarePlay } from 'lucide-react';
import { TrackSkeleton } from '@/components/ui/skeleton';
import { cn, safeDecodeURIComponent } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function SearchResultPage() {
  const params = useParams();
  const query = params.query ? safeDecodeURIComponent(params.query as string) : '';
  const [activeTab, setActiveTab] = useState<'tracks' | 'artists'>('tracks');
  const [isYoutubeEnabled, setIsYoutubeEnabled] = useState(false);

  const { data, error, isLoading } = useSWR(
    query ? `/api/search?q=${encodeURIComponent(query)}&type=${activeTab === 'artists' ? 'channel' : 'video'}${isYoutubeEnabled ? '&source=youtube&limit=2' : ''}` : null,
    fetcher
  );

  return (
    <div className="py-2 flex flex-col gap-4 animate-fade-in">
      <section>
        <div className="flex flex-col mb-4">
          {/* Tabs & Toggles */}
          <div className="flex items-center gap-1 p-1 bg-surface rounded-full w-full max-w-lg mx-auto border border-white/5 shadow-sm">
            <button
              onClick={() => setActiveTab('tracks')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-full font-semibold text-sm transition-all",
                activeTab === 'tracks'
                  ? "bg-brand-primary text-black shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <Music2 className="h-4 w-4" />
              Tracks
            </button>
            <button
              onClick={() => setActiveTab('artists')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-full font-semibold text-sm transition-all",
                activeTab === 'artists'
                  ? "bg-brand-primary text-black shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <Users className="h-4 w-4" />
              Artists
            </button>

            <div className="w-[1px] h-4 bg-white/10 mx-1 shrink-0" />
            
            <button
              onClick={() => setIsYoutubeEnabled(!isYoutubeEnabled)}
              title={isYoutubeEnabled ? "Disable YouTube Search" : "Enable YouTube Search"}
              className={cn(
                "flex items-center justify-center h-[32px] w-[32px] rounded-full transition-all shrink-0",
                isYoutubeEnabled 
                  ? "bg-[#FF0000] text-white shadow-sm" 
                  : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
            >
              <SquarePlay className="h-4 w-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <TrackSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="clay-card p-12 text-center">
            <h3 className="text-xl font-bold text-destructive">Error loading results.</h3>
          </div>
        ) : !data || !data.items || data.items.length === 0 ? (
          <div className="clay-card p-12 text-center flex flex-col items-center gap-4">
            <h3 className="text-xl font-bold text-muted-foreground">No {activeTab} found for "{query}"{isYoutubeEnabled ? ' on YouTube' : ''}</h3>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {data.items.map((item: any, i: number) => (
              activeTab === 'tracks' ? (
                <TrackRow
                  key={item.videoId}
                  track={item}
                  index={i}
                />
              ) : (
                <ArtistRow
                  key={item.videoId || item.channelId}
                  artist={item}
                  index={i}
                />
              )
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
