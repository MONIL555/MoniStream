'use client';

import dynamic from 'next/dynamic';
import { YouTubeEmbed } from './YouTubeEmbed';
import { NativeAudioPlayer } from './NativeAudioPlayer';
import { PlayerBar } from './PlayerBar';
import { usePlayerStore } from '@/store/playerStore';
import { useShallow } from 'zustand/react/shallow';
import { usePrefetch } from '@/hooks/usePrefetch';

const QueuePanel = dynamic(() => import('./QueuePanel').then(m => ({ default: m.QueuePanel })), { ssr: false });
const LyricsPanel = dynamic(() => import('./LyricsPanel').then(m => ({ default: m.LyricsPanel })), { ssr: false });
const FullscreenPlayer = dynamic(() => import('./FullscreenPlayer').then(m => ({ default: m.FullscreenPlayer })), { ssr: false });

export function Player() {
  const currentTrack = usePlayerStore(useShallow(s => s.currentTrack));
  
  // Prefetch next track's stream URL for instant transitions
  usePrefetch();

  return (
    <>
      {/* 
        The YouTubeEmbed must ALWAYS be mounted to maintain background play, 
        wake locks, and state synchronization, even if no track is playing yet.
      */}
      <YouTubeEmbed />
      <NativeAudioPlayer />

      {/* Render the visible UI only if a track is active */}
      {currentTrack && (
        <>
          <PlayerBar />
          <QueuePanel />
          <LyricsPanel />
          <FullscreenPlayer />
        </>
      )}
    </>
  );
}
