'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueStore } from '@/store/queueStore';
import { useConfigStore } from '@/store/configStore';
import { useHistoryStore } from '@/store/historyStore';

export function NativeAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  
  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    activePlayer,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    setCurrentTrack,
    advanceToNext,
    setPlayerReady,
  } = usePlayerStore();

  const { playNext, playPrevious } = useQueueStore();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const isActive = activePlayer === 'native' && currentTrack;

  // 1. Fetch Stream URL if needed
  useEffect(() => {
    if (!isActive) {
      setStreamUrl(null);
      return;
    }

    if (currentTrack.streamUrl) {
      setStreamUrl(currentTrack.streamUrl);
      return;
    }

    if (currentTrack.audioUrl) {
      let urlToPlay = currentTrack.audioUrl;

      // Check if it's wrapped in our proxy
      const isProxied = urlToPlay.startsWith('/api/stream-proxy?url=');
      let rawUrl = isProxied ? decodeURIComponent(urlToPlay.replace('/api/stream-proxy?url=', '')) : urlToPlay;

      // Fix old Google Drive /view URLs to direct download URLs on the fly
      if (rawUrl.includes('drive.google.com/file/d/')) {
        const match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          rawUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
        }
      }

      // Re-evaluate proxy requirement
      if (rawUrl.includes('drive.google.com')) {
        // GDrive ALWAYS needs proxy due to CORP headers
        setStreamUrl(`/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`);
      } else {
        // Other sources can save bandwidth by skipping proxy
        setStreamUrl(rawUrl);
      }
      return;
    }

    const saavnIdToUse = currentTrack.saavnId || (currentTrack.videoId?.startsWith('saavn_') ? currentTrack.videoId.replace('saavn_', '') : null);
    const trackIdToFetch = saavnIdToUse || currentTrack.videoId;

    if (trackIdToFetch) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      // Clear the old stream URL immediately to prevent playing the old song while loading
      setStreamUrl(null);
      // Fetch stream dynamically
      fetch(`/api/tracks/${trackIdToFetch}/stream`)
        .then(res => res.json())
        .then(data => {
          if (data.streamUrl) {
            setStreamUrl(data.streamUrl);
          } else {
            // Check YouTube fallback flag before falling back
            const { youtubeFallbackEnabled } = useConfigStore.getState();
            if (youtubeFallbackEnabled && !currentTrack.videoId?.startsWith('saavn_')) {
              usePlayerStore.getState().setActivePlayer('youtube');
            } else {
              // YouTube disabled or saavn track — skip this track
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

    // We merge these with YouTube's globally exposed functions
    const originalSeekTo = (window as any).seekTo;
    (window as any).seekTo = (seconds: number) => {
      if (usePlayerStore.getState().activePlayer === 'native' && audioRef.current) {
        audioRef.current.currentTime = seconds;
      } else if (originalSeekTo) {
        originalSeekTo(seconds);
      }
    };
  }, []);

  // 5. Media Session (Lockscreen controls)
  
  // 5a. Set Metadata only when track changes
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

  // 5b. Update playback state only when playing state changes
  useEffect(() => {
    if (!isActive || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isActive, isPlaying]);

  // 5c. Setup action handlers
  useEffect(() => {
    if (!isActive || !('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      silentAudioRef.current?.play().catch(() => {});
      audioRef.current?.play();
      setIsPlaying(true);
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      silentAudioRef.current?.pause();
      audioRef.current?.pause();
      setIsPlaying(false);
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      silentAudioRef.current?.play().catch(() => {});
      const prev = playPrevious();
      if (prev) setCurrentTrack(prev);
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      silentAudioRef.current?.play().catch(() => {});
      advanceToNext();
    });
    
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (audioRef.current && details.seekTime !== undefined) {
        audioRef.current.currentTime = details.seekTime;
      }
    });
  }, [isActive, playPrevious, advanceToNext, setCurrentTrack, setIsPlaying]);

  const historyAddedRef = useRef(false);

  useEffect(() => {
    historyAddedRef.current = false;
  }, [currentTrack?.videoId]);

  const handleTimeUpdate = () => {
    if (audioRef.current && isActive) {
      const t = audioRef.current.currentTime;
      const duration = audioRef.current.duration;
      setCurrentTime(t);

      if ('mediaSession' in navigator && isFinite(duration) && duration > 0) {
        try {
          navigator.mediaSession.setPositionState({
            duration: duration,
            playbackRate: audioRef.current.playbackRate || 1,
            position: t
          });
        } catch (e) { /* ignore */ }
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
    if (!streamUrl) return; // Ignore errors caused by clearing the src during track transitions
    
    if (isActive) {
      console.error('Native Audio Player Error:', e?.nativeEvent);
      const { youtubeFallbackEnabled } = useConfigStore.getState();
      
      // Only fallback if YouTube is enabled AND it's a valid YouTube video ID (not a JioSaavn track)
      if (youtubeFallbackEnabled && !currentTrack?.videoId?.startsWith('saavn_')) {
        console.error('Falling back to YouTube Embed...');
        useHistoryStore.getState().removeFromHistory(currentTrack!.videoId);
        usePlayerStore.getState().setActivePlayer('youtube');
      } else {
        usePlayerStore.getState().advanceToNext();
      }
    }
  };

  const silentAudioRef = useRef<HTMLAudioElement>(null);

  // Keep silent audio in sync with play state to hold the lockscreen session
  useEffect(() => {
    if (isPlaying && isActive) {
      silentAudioRef.current?.play().catch(() => {});
    } else {
      silentAudioRef.current?.pause();
    }
  }, [isPlaying, isActive]);

  if (!isActive) return null;

  return (
    <>
      <audio
        ref={silentAudioRef}
        src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="
        loop
        playsInline
        preload="auto"
        className="hidden"
      />
      <audio
        ref={audioRef}
        src={streamUrl || undefined}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleError}
        className="hidden"
      />
    </>
  );
}
