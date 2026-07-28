'use client';

import { usePlayerStore } from '@/store/playerStore';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import useSWR from 'swr';
import { useEffect, useRef, useMemo } from 'react';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface SyncedLyric {
  time: number;
  text: string;
}

function parseSyncedLyrics(lyrics: string): SyncedLyric[] {
  const lines = lyrics.split('\n');
  const parsed: SyncedLyric[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3], 10);

      const timeInSeconds = minutes * 60 + seconds + (milliseconds / (match[3].length === 3 ? 1000 : 100));
      const text = line.replace(timeRegex, '').trim();

      if (text) {
        parsed.push({ time: timeInSeconds, text });
      }
    }
  }
  return parsed;
}

export function LyricsPanel() {
  const { isLyricsOpen, toggleLyrics, currentTrack, currentTime } = usePlayerStore();

  const lyricsUrl = isLyricsOpen && currentTrack
    ? `/api/lyrics?track=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(currentTrack.artist || currentTrack.channelTitle || '')}${currentTrack.saavnId ? `&saavnId=${encodeURIComponent(currentTrack.saavnId)}` : ''}${currentTrack.source ? `&source=${currentTrack.source}` : ''}`
    : null;

  const { data, isLoading, error } = useSWR(lyricsUrl, fetcher);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const syncedLyrics = useMemo(() => {
    if (data?.syncedLyrics) {
      return parseSyncedLyrics(data.syncedLyrics);
    }
    return null;
  }, [data?.syncedLyrics]);

  const activeLineIndex = useMemo(() => {
    if (!syncedLyrics) return -1;
    for (let i = syncedLyrics.length - 1; i >= 0; i--) {
      if (currentTime >= syncedLyrics[i].time) {
        return i;
      }
    }
    return -1;
  }, [currentTime, syncedLyrics]);

  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const activeLine = activeLineRef.current;

      // Calculate absolute target position
      let offsetTop = 0;
      let el: HTMLElement | null = activeLine;
      while (el && el !== container) {
        offsetTop += el.offsetTop;
        el = el.offsetParent as HTMLElement;
      }

      // Target scroll position is 32px above the element's layout position to pin it to the top
      // (120px was too large for a small square container and pushed it to the middle/bottom)
      const targetScroll = Math.max(0, offsetTop - 10);
      const startScroll = container.scrollTop;
      const change = targetScroll - startScroll;
      const duration = 400; // ms
      const startTime = performance.now();

      const animateScroll = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // EaseInOutCubic
        const ease = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        container.scrollTop = startScroll + change * ease;

        if (progress < 1) {
          requestAnimationFrame(animateScroll);
        }
      };

      requestAnimationFrame(animateScroll);
    }
  }, [activeLineIndex]);

  if (!isLyricsOpen) return null;

  return (
    <div className="fixed top-0 right-0 h-[calc(100vh-100px)] w-full max-w-md z-40 p-4 md:p-6 animate-fade-in pointer-events-none">
      <div className="clay-panel h-full w-full flex flex-col overflow-hidden pointer-events-auto shadow-2xl bg-surface/95 backdrop-blur-xl border-l-0">

        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-2">
          <h2 className="text-xl font-bold text-foreground">Lyrics</h2>
          <Button variant="ghost" size="icon" onClick={toggleLyrics} className="h-8 w-8 rounded-full">
            <X className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex-1 relative min-h-0">
          <div
            ref={scrollContainerRef}
            className="absolute inset-0 overflow-y-auto hide-scrollbar px-6"
          >
            {!currentTrack ? (
              <div className="h-full flex items-center justify-center text-muted-foreground font-semibold">
                No track playing
              </div>
            ) : isLoading ? (
              <div className="h-full flex flex-col items-center justify-center space-y-4">
                <div className="h-8 w-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
                <p className="text-muted-foreground font-bold animate-pulse">Finding lyrics...</p>
              </div>
            ) : error || !data || (!data.plainLyrics && !data.syncedLyrics) ? (
              <div className="h-full flex items-center justify-center text-muted-foreground font-semibold text-center">
                Looks like we don't have lyrics for this track yet.
              </div>
            ) : syncedLyrics && syncedLyrics.length > 0 ? (
              <div className="space-y-4 pb-[100vh] pt-8">
                {syncedLyrics.map((lyric, index) => {
                  const isActive = index === activeLineIndex;
                  const isPassed = index < activeLineIndex;

                  return (
                    <div
                      key={index}
                      ref={isActive ? activeLineRef : null}
                      className={`text-xl md:text-2xl font-bold leading-[1.6] transition-all duration-300 text-center ${isActive
                        ? 'text-foreground scale-105 origin-center'
                        : isPassed
                          ? 'text-foreground/30'
                          : 'text-foreground/60'
                        }`}
                    >                {lyric.text}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-2xl font-bold leading-relaxed text-foreground/80">
                {data.plainLyrics}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
