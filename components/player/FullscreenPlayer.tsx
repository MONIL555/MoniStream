'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { PlayerControls } from './PlayerControls';
import { ProgressBar } from './ProgressBar';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { LikeButton } from '@/components/music/LikeButton';
import { motion, AnimatePresence } from 'framer-motion';
import useSWR from 'swr';
import Image from 'next/image';

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

export function FullscreenPlayer() {
  const { currentTrack, isFullscreen, toggleFullscreen, currentTime } = usePlayerStore();
  const [viewMode, setViewMode] = useState<'cover' | 'lyrics'>('cover');

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setTimeout(() => setViewMode('cover'), 300);
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  const lyricsUrl = currentTrack
    ? `/api/lyrics?track=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(currentTrack.artist || currentTrack.channelTitle || '')}${currentTrack.saavnId ? `&saavnId=${encodeURIComponent(currentTrack.saavnId)}` : ''}${currentTrack.source ? `&source=${currentTrack.source}` : ''}`
    : null;

  const { data: lyricsData, isLoading: lyricsLoading } = useSWR(lyricsUrl, fetcher);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLDivElement>(null);

  const syncedLyrics = useMemo(() => {
    if (lyricsData?.syncedLyrics) {
      return parseSyncedLyrics(lyricsData.syncedLyrics);
    }
    return null;
  }, [lyricsData?.syncedLyrics]);

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

  if (!currentTrack || !isFullscreen) return null;

  const highThumb = typeof currentTrack.thumbnails?.high === 'string' ? currentTrack.thumbnails.high : (currentTrack.thumbnails?.high as any)?.url;
  const defaultThumb = typeof currentTrack.thumbnails?.default === 'string' ? currentTrack.thumbnails.default : (currentTrack.thumbnails?.default as any)?.url;
  const thumbnail = highThumb || defaultThumb || '';

  return (
    <motion.div
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      drag="y"
      dragDirectionLock
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.7 }}
      onDragEnd={(e, info) => {
        if (info.offset.y > 100 || info.velocity.y > 500) {
          toggleFullscreen();
        }
      }}
      className="fixed inset-0 z-[100] bg-[#121212] flex flex-col font-sans"
    >
      <div className="absolute inset-0 z-0">
        <div
          className="absolute inset-0 opacity-40 blur-[100px] scale-125 pointer-events-none transition-all duration-1000"
          style={{
            backgroundImage: thumbnail ? `url(${thumbnail})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/80 pointer-events-none" />
      </div>

      <div className="relative z-10 flex items-center justify-between p-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className="hover:bg-white/10 rounded-full h-12 w-12 text-white transition-colors"
        >
          <ChevronDown className="h-8 w-8" />
        </Button>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 mb-1">
            Now Playing
          </span>
          <span className="text-sm font-semibold text-white/90">
            {currentTrack.artist || currentTrack.channelTitle}
          </span>
        </div>
        <div className="w-12" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col p-6 max-w-md mx-auto w-full gap-8">

        <div className="w-full flex-1 flex items-center justify-center min-h-0 relative [perspective:1200px]">
          <motion.div
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(e, info) => {
              if (info.offset.x < -60 && viewMode === 'cover') {
                setViewMode('lyrics');
              } else if (info.offset.x > 60 && viewMode === 'lyrics') {
                setViewMode('cover');
              }
            }}
            initial={false}
            animate={{ rotateY: viewMode === 'lyrics' ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 25 }}
            style={{ transformStyle: 'preserve-3d' }}
            className="w-full aspect-square relative cursor-grab active:cursor-grabbing"
          >
            <div
              className="absolute inset-0 w-full h-full rounded-[32px] overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.6)]"
              style={{ backfaceVisibility: 'hidden' }}
            >
              {thumbnail ? (
                <Image
                  src={thumbnail}
                  alt={currentTrack.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-cover"
                  draggable={false}
                  priority
                />
              ) : (
                <div className="w-full h-full bg-surface-hover flex items-center justify-center">
                  <span className="text-4xl text-muted-foreground font-bold">{currentTrack.title?.charAt(0)}</span>
                </div>
              )}
              <div className="absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] rounded-[32px] pointer-events-none" />
              <div className="absolute bottom-4 right-6 pointer-events-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/70 bg-black/50 px-3 py-1.5 rounded-full backdrop-blur-md">
                  Swipe for Lyrics
                </span>
              </div>
            </div>

            <div
              className="absolute inset-0 w-full h-full rounded-[32px] overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.6)] bg-white/5 backdrop-blur-3xl flex flex-col p-6 border border-white/10"
              style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white tracking-tight">Lyrics</h3>
                <span className="text-xs font-bold uppercase tracking-wider text-white/50">Swipe Back</span>
              </div>
              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto hide-scrollbar relative"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {lyricsLoading ? (
                  <div className="h-full flex flex-col items-center justify-center space-y-4">
                    <div className="h-8 w-8 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
                  </div>
                ) : syncedLyrics && syncedLyrics.length > 0 ? (
                  <div className="space-y-4 pb-[100vh] pt-16">
                    {syncedLyrics.map((lyric, index) => {
                      const isActive = index === activeLineIndex;
                      const isPassed = index < activeLineIndex;

                      return (
                        <div
                          key={index}
                          ref={isActive ? activeLineRef : null}
                          className={`text-xl md:text-2xl font-bold leading-[1.6] transition-all duration-300 text-center ${isActive
                            ? 'text-white scale-105 origin-center'
                            : isPassed
                              ? 'text-white/30'
                              : 'text-white/60'
                            }`}
                        >
                          {lyric.text}
                        </div>
                      );
                    })}
                  </div>
                ) : lyricsData && lyricsData.plainLyrics ? (
                  <div className="whitespace-pre-wrap text-xl md:text-2xl font-bold leading-[1.6] text-white/90 pb-8 text-center pt-2">
                    {lyricsData.plainLyrics}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-white/50 font-medium text-center">
                    Looks like we don't have lyrics for this track yet.
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        <div className="w-full flex flex-col gap-6 mt-auto">
          <div className="w-full flex items-center justify-between">
            <div className="flex flex-col overflow-hidden pr-4">
              <h1 className="text-2xl md:text-3xl font-bold text-white truncate tracking-tight">
                {currentTrack.title}
              </h1>
              <h2 className="text-lg md:text-xl font-medium text-white/60 truncate mt-1">
                {currentTrack.artist || currentTrack.channelTitle}
              </h2>
            </div>
            <LikeButton videoId={currentTrack.videoId} className="h-12 w-12 text-white shrink-0 hover:bg-white/10 rounded-full transition-colors" />
          </div>

          <div className="w-full flex flex-col gap-5">
            <ProgressBar />
            <div className="w-full pt-2 pb-6">
              <PlayerControls />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
