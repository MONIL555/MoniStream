'use client';

import { usePlayerStore } from '@/store/playerStore';
import { PlayerControls } from './PlayerControls';
import { ProgressBar } from './ProgressBar';
import { VolumeControl } from './VolumeControl';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ListMusic, Mic2, Maximize2, Play, Pause, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LikeButton } from '@/components/music/LikeButton';
import { useRef, useCallback } from 'react';

import { useShallow } from 'zustand/react/shallow';

export function PlayerBar() {
  const { currentTrack, toggleQueue, toggleLyrics, isQueueOpen, isLyricsOpen, isPlaying, togglePlay, toggleFullscreen, advanceToNext, setCurrentTrack } = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      toggleQueue: s.toggleQueue,
      toggleLyrics: s.toggleLyrics,
      isQueueOpen: s.isQueueOpen,
      isLyricsOpen: s.isLyricsOpen,
      isPlaying: s.isPlaying,
      togglePlay: s.togglePlay,
      toggleFullscreen: s.toggleFullscreen,
      advanceToNext: s.advanceToNext,
      setCurrentTrack: s.setCurrentTrack
    }))
  );

  // Vanilla touch swipe-to-dismiss (replaces Framer Motion drag)
  const touchStartRef = useRef<{ y: number; time: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { y: e.touches[0].clientY, time: Date.now() };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const deltaTime = Date.now() - touchStartRef.current.time;
    const velocity = deltaY / Math.max(deltaTime, 1);

    // Swipe down to dismiss: >50px displacement OR fast velocity (>0.3px/ms)
    if (deltaY > 50 || velocity > 0.3) {
      setCurrentTrack(null);
    }
    touchStartRef.current = null;
  }, [setCurrentTrack]);

  if (!currentTrack) return null;

  const thumbnail = typeof currentTrack.thumbnails?.default === 'string' 
    ? currentTrack.thumbnails.default 
    : (currentTrack.thumbnails?.default as any)?.url || '';

  const handleNext = () => {
    if (typeof window !== 'undefined' && (window as any).playVideoSync) {
      (window as any).playVideoSync();
    } else if (typeof window !== 'undefined' && (window as any).playSilentAudio) {
      (window as any).playSilentAudio();
    }
    advanceToNext();
  };

  return (
    <>
      {/* Mobile Mini Player — sits above MobileNav */}
      <div 
        className="md:hidden fixed bottom-[88px] left-2 right-2 z-50 cursor-pointer" 
        onClick={toggleFullscreen}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-center gap-3 h-14 px-3 bg-[#282828] hover:bg-[#3E3E3E] rounded-md overflow-hidden transition-colors shadow-lg">
          <Avatar 
            size="sm" 
            src={thumbnail} 
            alt={currentTrack.title}
            className="rounded h-10 w-10 shrink-0 shadow-sm"
          />
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="text-[13px] font-bold text-white truncate leading-tight">{currentTrack.title}</div>
            <div className="text-[12px] text-muted-foreground truncate leading-tight">
              {currentTrack.artist || currentTrack.channelTitle}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="h-10 w-10 text-white shrink-0 hover:bg-transparent"
          >
            {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="h-10 w-10 text-muted-foreground shrink-0 hover:bg-transparent"
          >
            <SkipForward className="h-5 w-5 fill-current" />
          </Button>
        </div>
      </div>

      {/* Desktop Full Player Bar */}
      <div className="hidden md:flex fixed bottom-0 left-0 right-0 z-50 h-24 bg-black border-t border-border px-4 items-center justify-between">
        
          {/* Left: Now Playing */}
          <div className="flex w-[30%] min-w-[160px] items-center gap-3">
            <Avatar 
              size="md" 
              src={thumbnail} 
              alt={currentTrack.title}
              className="rounded-lg shadow-md h-12 w-12"
            />
            <div className="flex flex-col truncate">
              <span className="truncate font-bold text-sm text-foreground">
                {currentTrack.title}
              </span>
              <span className="truncate text-xs font-semibold text-muted-foreground">
                {currentTrack.artist || currentTrack.channelTitle}
              </span>
            </div>
            <LikeButton videoId={currentTrack.videoId} className="h-8 w-8" />
          </div>

          {/* Center: Controls & Progress */}
          <div className="flex w-[40%] max-w-2xl flex-col items-center justify-center gap-1">
            <PlayerControls />
            <div className="flex w-full">
              <ProgressBar />
            </div>
          </div>

          {/* Right: Actions & Volume */}
          <div className="flex w-[30%] min-w-[140px] items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLyrics}
              className={cn("h-8 w-8 transition-colors", isLyricsOpen ? "text-brand-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <Mic2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleQueue}
              className={cn("h-8 w-8 transition-colors", isQueueOpen ? "text-brand-primary" : "text-muted-foreground hover:text-foreground")}
            >
              <ListMusic className="h-4 w-4" />
            </Button>
            <VolumeControl />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground hidden lg:flex"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
      </div>
    </>
  );
}
