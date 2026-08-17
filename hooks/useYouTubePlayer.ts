'use client';

import { usePlayerStore } from '@/store/playerStore';
import { getGlobalCurrentTime } from '@/hooks/useCurrentTime';

export function useYouTubePlayer() {
  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    duration,
    isLyricsOpen,
    isQueueOpen,
    isFullscreen,
    isPlayerReady,
    togglePlay,
    setVolume,
    toggleMute,
    toggleLyrics,
    toggleQueue,
    toggleFullscreen,
  } = usePlayerStore();

  const seekTo = (seconds: number) => {
    // Call the global seekTo exposed by YouTubeEmbed
    if (typeof window !== 'undefined' && (window as any).seekTo) {
      (window as any).seekTo(seconds);
    }
  };

  return {
    // State
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    currentTime: getGlobalCurrentTime(),
    duration,
    isLyricsOpen,
    isQueueOpen,
    isFullscreen,
    isPlayerReady,
    
    // Actions
    togglePlay,
    setVolume,
    toggleMute,
    toggleLyrics,
    toggleQueue,
    toggleFullscreen,
    seekTo,
  };
}
