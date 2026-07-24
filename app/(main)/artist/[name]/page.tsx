'use client';

import useSWR from 'swr';
import { TrackRow } from '@/components/music/TrackRow';
import { useParams } from 'next/navigation';
import { Loader2, Music2, Play } from 'lucide-react';
import { TrackSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueStore } from '@/store/queueStore';
import { safeDecodeURIComponent } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function ArtistPage() {
  const params = useParams();
  const artistName = params.name ? safeDecodeURIComponent(params.name as string) : '';
  
  // We search for the artist specifically
  const { data, error, isLoading } = useSWR(artistName ? `/api/search?q=${encodeURIComponent(artistName + ' songs')}` : null, fetcher);
  
  const { setCurrentTrack, fetchMixForTrack } = usePlayerStore();
  const { loadSingle } = useQueueStore();

  const handlePlayAll = () => {
    if (data && data.items && data.items.length > 0) {
      const track = data.items[0];
      const trackData = {
        videoId: track.videoId,
        title: track.title || 'Unknown Title',
        artist: track.artist || track.channelName || track.channelTitle || 'Unknown Artist',
        channelId: track.channelId || '',
        thumbnails: {
          default: track.thumbnail || track.thumbnails?.default || '',
          high: track.thumbnail || track.thumbnails?.high || '',
        },
        duration: track.duration || 0,
        durationText: track.durationText || '',
        tags: [],
        playCount: 0,
        likeCount: 0,
        cachedAt: new Date().toISOString(),
      };
      loadSingle(trackData);
      setCurrentTrack(trackData);
      fetchMixForTrack(trackData);
      
      if (typeof window !== 'undefined' && (window as any).playVideoSync) {
        (window as any).playVideoSync(track.videoId);
      } else if (typeof window !== 'undefined' && (window as any).playSilentAudio) {
        (window as any).playSilentAudio();
      }
    }
  };

  return (
    <div className="py-6 flex flex-col gap-8 animate-fade-in">
      <section>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight text-foreground mb-2">
              {artistName}
            </h1>
            <p className="text-muted-foreground font-semibold">Artist</p>
          </div>
          
          {data && data.items && data.items.length > 0 && (
            <Button 
              size="icon" 
              className="h-14 w-14 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.4)] hover:scale-105 transition-transform border-0 !bg-brand-primary !text-black hover:!bg-brand-primary/90"
              onClick={handlePlayAll}
            >
              <Play className="h-6 w-6 fill-current ml-1" />
            </Button>
          )}
        </div>
        
        <h2 className="text-2xl font-bold tracking-tight text-foreground mb-4">
          Popular Tracks
        </h2>
        
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <TrackSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="clay-card p-12 text-center">
            <h3 className="text-xl font-bold text-destructive">Error loading artist.</h3>
          </div>
        ) : !data || !data.items || data.items.length === 0 ? (
          <div className="clay-card p-12 text-center flex flex-col items-center gap-4">
            <Music2 className="h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="text-xl font-bold text-muted-foreground">No tracks found for {artistName}</h3>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {data.items.map((track: any, i: number) => (
              <TrackRow 
                key={track.videoId} 
                track={track} 
                index={i}
                contextTracks={data.items}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
