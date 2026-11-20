'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueStore } from '@/store/queueStore';
import { useConfigStore } from '@/store/configStore';
import { useHistoryStore } from '@/store/historyStore';
import { setGlobalCurrentTime } from '@/hooks/useCurrentTime';
import { consumePrefetchedStreamUrl } from '@/hooks/usePrefetch';

export function NativeAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastPositionUpdateRef = useRef<number>(0);
  const historyAddedRef = useRef<boolean>(false);

  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    activePlayer,
    setIsPlaying,
    setDuration,
    setCurrentTrack,
    advanceToNext,
    setPlayerReady,
  } = usePlayerStore();

  const { playPrevious } = useQueueStore();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const isActive = activePlayer === 'native' && currentTrack;

  // 1. Fetch / Resolve Stream URL
  useEffect(() => {
    if (!isActive) {
      setStreamUrl(null);
      return;
    }

    // Stop old audio IMMEDIATELY to prevent overlap during transition
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }

    if (currentTrack.streamUrl) {
      setStreamUrl(currentTrack.streamUrl);
      return;
    }

    if (currentTrack.audioUrl) {
      let urlToPlay = currentTrack.audioUrl;
      const isProxied = urlToPlay.startsWith('/api/stream-proxy?url=');
      let rawUrl = isProxied ? decodeURIComponent(urlToPlay.replace('/api/stream-proxy?url=', '')) : urlToPlay;

      // Fix old Google Drive /view URLs to direct download URLs
      if (rawUrl.includes('drive.google.com/file/d/')) {
        const match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          rawUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
        }
      }

      if (rawUrl.includes('drive.google.com')) {
        setStreamUrl(`/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`);
      } else {
        setStreamUrl(rawUrl);
      }
      return;
    }

    const saavnIdToUse = currentTrack.saavnId || (currentTrack.videoId?.startsWith('saavn_') ? currentTrack.videoId.replace('saavn_', '') : null);
    const trackIdToFetch = saavnIdToUse || currentTrack.videoId;

    if (trackIdToFetch) {
      setStreamUrl(null);

      // Check prefetch cache first for instant resolution
      const prefetched = consumePrefetchedStreamUrl(currentTrack.videoId);
      if (prefetched) {
        setStreamUrl(prefetched);
        return;
      }

      // Fetch stream dynamically
      fetch(`/api/tracks/${trackIdToFetch}/stream`)
        .then(res => res.json())
        .then(data => {
          if (data.streamUrl) {
            setStreamUrl(data.streamUrl);
          } else {
            const { youtubeFallbackEnabled } = useConfigStore.getState();
            if (youtubeFallbackEnabled && !currentTrack.videoId?.startsWith('saavn_')) {
              usePlayerStore.getState().setActivePlayer('youtube');
            } else {
              usePlayerStore.getState().advanceToNext();
            }
          }
        })
        .catch(() => {
          const { youtubeFallbackEnabled } = useConfigStore.getState();
          if (youtubeFallbackEnabled && !currentTrack.videoId?.startsWith('saavn_')) {
            usePlayerStore.getState().setActivePlayer('youtube');
          } else {
            usePlayerStore.getState().advanceToNext();
          }
        });
    }
  }, [currentTrack, isActive]);

  // 2. Sync Play/Pause State
  useEffect(() => {
    if (!audioRef.current || !isActive || !streamUrl) return;

    if (isPlaying) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          if (e.name !== 'AbortError') {
            console.error('Native Audio Play Error:', e);
          }
        });
      }
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying, isActive, streamUrl]);

  // 3. Sync Volume
  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = isMuted ? 0 : volume / 100;
  }, [volume, isMuted]);

  // 4. Global Expose for Seek and Sync Play (TrackRow.tsx)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const originalSeekTo = (window as any).seekTo;
    (window as any).seekTo = (seconds: number) => {
      if (usePlayerStore.getState().activePlayer === 'native' && audioRef.current) {
        audioRef.current.currentTime = seconds;
        setGlobalCurrentTime(seconds);
      } else if (originalSeekTo) {
        originalSeekTo(seconds);
      }
    };
  }, []);

  // 5. Media Session (Lockscreen controls)
  useEffect(() => {
    if (!isActive || !currentTrack || !('mediaSession' in navigator)) return;

    const art = currentTrack.thumbnails?.high || currentTrack.thumbnails?.default;
    const artwork = art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : [];

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown Title',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.albumName || 'Unknown Album',
        artwork,
      });
    } catch { /* ignore */ }
  }, [isActive, currentTrack]);

  useEffect(() => {
    if (!isActive || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isActive, isPlaying]);

  useEffect(() => {
    if (!isActive || !('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play().catch(() => {});
      setIsPlaying(true);
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
      setIsPlaying(false);
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      const prev = playPrevious();
      if (prev) setCurrentTrack(prev);
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      advanceToNext();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (audioRef.current && details.seekTime !== undefined) {
        audioRef.current.currentTime = details.seekTime;
        setGlobalCurrentTime(details.seekTime);
      }
    });
  }, [isActive, playPrevious, advanceToNext, setCurrentTrack, setIsPlaying]);

  useEffect(() => {
    historyAddedRef.current = false;
    lastPositionUpdateRef.current = 0;
  }, [currentTrack?.videoId]);

  const handleTimeUpdate = () => {
    if (audioRef.current && isActive) {
      const t = audioRef.current.currentTime;
      const duration = audioRef.current.duration;
      setGlobalCurrentTime(t);

      // Throttle MediaSession positionState updates to once per 1.5 seconds to minimize OS IPC overhead
      const now = Date.now();
      if (now - lastPositionUpdateRef.current >= 1500) {
        lastPositionUpdateRef.current = now;
        if ('mediaSession' in navigator && isFinite(duration) && duration > 0) {
          try {
            navigator.mediaSession.setPositionState({
              duration,
              playbackRate: audioRef.current.playbackRate || 1,
              position: t,
            });
          } catch { /* ignore */ }
        }
      }

      if (t >= 30 && !historyAddedRef.current && currentTrack) {
        historyAddedRef.current = true;
        useHistoryStore.getState().addToHistory(currentTrack);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && isActive) {
      setDuration(audioRef.current.duration);
      setPlayerReady(true);
      if (isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  const handleEnded = () => {
    if (isActive) {
      advanceToNext();
    }
  };

  const handleError = (e: any) => {
    if (!streamUrl) return;

    if (isActive) {
      console.error('Native Audio Player Error:', e?.nativeEvent);
      const { youtubeFallbackEnabled } = useConfigStore.getState();

      if (youtubeFallbackEnabled && !currentTrack?.videoId?.startsWith('saavn_')) {
        console.error('Falling back to YouTube Embed...');
        useHistoryStore.getState().removeFromHistory(currentTrack!.videoId);
        usePlayerStore.getState().setActivePlayer('youtube');
      } else {
        usePlayerStore.getState().advanceToNext();
      }
    }
  };

  if (!isActive) return null;

  return (
    <audio
      ref={audioRef}
      src={streamUrl || undefined}
      preload="auto"
      playsInline
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onEnded={handleEnded}
      onError={handleError}
      className="hidden"
    />
  );
}
