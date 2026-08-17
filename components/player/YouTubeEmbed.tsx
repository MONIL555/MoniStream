'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { mutate } from 'swr';
import { toast } from 'sonner';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueStore } from '@/store/queueStore';
import { useHistoryStore } from '@/store/historyStore';
import { setGlobalCurrentTime, getGlobalCurrentTime } from '@/hooks/useCurrentTime';

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

export function YouTubeEmbed() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [isApiReady, setIsApiReady] = useState(false);
  const silentAudioRef = useRef<HTMLAudioElement>(null);
  const wakeLockRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  // In-memory dedup: skip /api/cache-track GET for videoIds we've already checked this session
  const cacheCheckedIds = useRef<Set<string>>(new Set());

  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    activePlayer, // New
    setPlayerReady,
    setIsPlaying,
    setDuration,
    setCurrentTrack,
    advanceToNext,
  } = usePlayerStore();

  const { playNext, playPrevious } = useQueueStore();
  const isActive = activePlayer === 'youtube'; // New

  const handleAdvanceToNext = useCallback(async () => {
    await advanceToNext();
  }, [advanceToNext]);

  // ══════════════════════════════════════════════════════════════
  // 1. Initialize YouTube IFrame API
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.YT && window.YT.Player) {
      setIsApiReady(true);
      return;
    }

    window.onYouTubeIframeAPIReady = () => {
      setIsApiReady(true);
    };

    if (!document.getElementById('youtube-api-script')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-api-script';
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // ══════════════════════════════════════════════════════════════
  // 2. Create the Player Instance
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!isApiReady || !containerRef.current || playerRef.current) return;

    playerRef.current = new window.YT.Player(containerRef.current, {
      height: '100',
      width: '100',
      playerVars: {
        autoplay: 0,
        controls: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        rel: 0,
        showinfo: 0,
        modestbranding: 1,
        playsinline: 1,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
      },
      events: {
        onReady: () => {
          setPlayerReady(true);
          console.log('[YouTube Player] Ready');
        },
        onStateChange: (event: any) => {
          const state = event.data;
          const YT = window.YT;
          const store = usePlayerStore.getState();
          const isYouTubeActive = store.activePlayer === 'youtube';

          if (!isYouTubeActive) {
            // If YouTube is not the active player but it starts playing, force it to pause
            if (state === YT.PlayerState.PLAYING || state === YT.PlayerState.BUFFERING) {
              event.target.pauseVideo();
            }
            return;
          }

          if (state === YT.PlayerState.PLAYING) {
            setIsPlaying(true);
            setDuration(event.target.getDuration());
          } else if (state === YT.PlayerState.PAUSED) {
            if (document.hidden && store.isPlaying) {
              // Try to force play if it was paused while backgrounded
              event.target.playVideo();
            } else {
              setIsPlaying(false);
            }
          } else if (state === YT.PlayerState.CUED) {
            // When cued, if we intend to play, force play it
            if (store.isPlaying) {
              event.target.playVideo();
            }
          } else if (state === YT.PlayerState.ENDED) {
            setIsPlaying(false);
            handleAdvanceToNext();
          }
        },
        onError: () => {
          // Only advance if YouTube is actually the active player!
          const store = usePlayerStore.getState();
          if (store.activePlayer === 'youtube') {
            console.error('[YouTube Player] Error occurred, advancing to next track...');
            setTimeout(handleAdvanceToNext, 1000);
          } else {
            console.warn('[YouTube Player] Error occurred, but ignored since native player is active.');
          }
        },
      },
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
        setPlayerReady(false);
      }
    };
  }, [isApiReady, setPlayerReady, setIsPlaying, setDuration, handleAdvanceToNext]);

  // ══════════════════════════════════════════════════════════════
  // 3. Sync Current Track (Load new video)
  // ══════════════════════════════════════════════════════════════

  useEffect(() => {
    if (!currentTrack || !playerRef.current || !isActive) return;

    // Stop old video IMMEDIATELY to prevent overlap during transition
    if (typeof playerRef.current.stopVideo === 'function') {
      playerRef.current.stopVideo();
    }

    // Only load by ID when YouTube is the active player
    if (typeof playerRef.current.loadVideoById === 'function') {
      playerRef.current.loadVideoById(currentTrack.videoId);
      // Wait for it to play, the onStateChange will handle the isPlaying state update
    }
  }, [currentTrack, isApiReady, isActive]);

  // ══════════════════════════════════════════════════════════════
  // 3.5 Auto-Swap to Cached Version (If available)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (isActive && currentTrack) {
      // Skip if we've already checked this videoId this session
      if (cacheCheckedIds.current.has(currentTrack.videoId)) return;
      cacheCheckedIds.current.add(currentTrack.videoId);

      // Check if it's already cached in the database
      fetch(`/api/prepare-audio?videoId=${currentTrack.videoId}`)
        .then(res => res.json())
        .then(data => {
          if (data.status === 'ready' && data.track && data.track.audioUrl) {
            // Swap to the cached track seamlessly
            const store = usePlayerStore.getState();
            const t = getGlobalCurrentTime();
            store.swapToCachedTrack({
              ...currentTrack,
              source: data.track.source || 'pagalworld_cached',
              audioUrl: data.track.audioUrl,
            });
            setTimeout(() => {
              if (typeof (window as any).seekTo === 'function') {
                (window as any).seekTo(t);
              }
            }, 300);
            mutate(
              (key) => typeof key === 'string' && (key.includes('/api/search') || key.includes('/api/library') || key.includes('/api/admin')),
              undefined,
              { revalidate: true }
            );
          }
        })
        .catch(err => console.error('Failed to check cache status:', err));
    }
  }, [currentTrack?.videoId, isActive]);

  // ══════════════════════════════════════════════════════════════
  // 4. Sync Play/Pause State (Global toggle)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!playerRef.current) return;

    if (isPlaying && isActive) {
      if (typeof playerRef.current.playVideo === 'function') {
        playerRef.current.playVideo();
      }
    } else {
      if (typeof playerRef.current.pauseVideo === 'function') {
        playerRef.current.pauseVideo();
      }
    }
  }, [isPlaying, isActive]);

  // ══════════════════════════════════════════════════════════════
  // 5. Sync Volume
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!playerRef.current || typeof playerRef.current.setVolume !== 'function') return;
    if (isMuted) {
      playerRef.current.setVolume(0);
    } else {
      playerRef.current.setVolume(volume);
    }
  }, [volume, isMuted]);

  // ══════════════════════════════════════════════════════════════
  // 6. Time Tracking Loop & Speculative Pre-Cache
  // ══════════════════════════════════════════════════════════════
  // Flow: At ~5s → fire speculative POST (background search/scrape)
  //       At 30s → confirm + swap to cached track
  //       Skip before 30s → abort, nothing gets cached
  // ══════════════════════════════════════════════════════════════
  const speculativeFiredRef = useRef(false);
  const speculativeResultRef = useRef<{ audioUrl?: string; status?: string; error?: string } | null>(null);
  const speculativeAbortRef = useRef<AbortController | null>(null);
  const cacheConfirmedRef = useRef(false);
  const historyAddedRef = useRef(false);

  useEffect(() => {
    // Reset all refs when track changes
    speculativeFiredRef.current = false;
    speculativeResultRef.current = null;
    cacheConfirmedRef.current = false;
    historyAddedRef.current = false;
    // Abort any in-flight speculative request from previous track
    if (speculativeAbortRef.current) {
      speculativeAbortRef.current.abort();
      speculativeAbortRef.current = null;
    }
  }, [currentTrack?.videoId]);

  useEffect(() => {
    if (!isPlaying || !isActive) return;

    const id = setInterval(() => {
      if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
        try { 
          const t = playerRef.current.getCurrentTime();
          const duration = playerRef.current.getDuration();
          if (isFinite(t) && t > 0) {
            setGlobalCurrentTime(t);

            // Sync media session position state
            if ('mediaSession' in navigator && isFinite(duration) && duration > 0) {
              try {
                navigator.mediaSession.setPositionState({
                  duration: duration,
                  playbackRate: 1,
                  position: t
                });
              } catch (e) { /* ignore */ }
            }

            // Add to history after 30 seconds
            if (t >= 30 && !historyAddedRef.current && currentTrack) {
               historyAddedRef.current = true;
               useHistoryStore.getState().addToHistory(currentTrack);
            }
            
            // ── Speculative pre-cache at ~5 seconds ──
            if (t >= 5 && !speculativeFiredRef.current && currentTrack) {
              speculativeFiredRef.current = true;
              const abortController = new AbortController();
              speculativeAbortRef.current = abortController;
              
              fetch('/api/prepare-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  videoId: currentTrack.videoId,
                  title: currentTrack.title,
                  artist: currentTrack.artist,
                  duration: currentTrack.duration || (isFinite(duration) ? duration : 0),
                  speculative: true,
                }),
                signal: abortController.signal,
              })
              .then(res => res.json())
              .then(data => {
                speculativeResultRef.current = data;
                console.log(`[Pre-cache] Speculative result for "${currentTrack.title}": ${data.status}`);
              })
              .catch(err => {
                if (err.name !== 'AbortError') {
                  console.error('[Pre-cache] Speculative cache failed:', err);
                }
              });
            }
            
            // ── Confirm + swap at 30 seconds ──
            if (t >= 30 && !cacheConfirmedRef.current && currentTrack) {
              cacheConfirmedRef.current = true;
              
              const doConfirmAndSwap = async () => {
                // Wait for speculative result if it hasn't arrived yet
                let result = speculativeResultRef.current;
                if (!result && speculativeFiredRef.current) {
                  // Poll briefly for the result (speculative request still in flight)
                  for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    result = speculativeResultRef.current;
                    if (result) break;
                  }
                }
                
                if (!result) {
                  // Speculative request never completed — fall back to direct cache
                  toast('🎵 Caching this song for lockscreen playback...', { duration: 3000 });
                  try {
                    const res = await fetch('/api/prepare-audio', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        videoId: currentTrack.videoId,
                        title: currentTrack.title,
                        artist: currentTrack.artist,
                        duration: currentTrack.duration || (isFinite(duration) ? duration : 0),
                        speculative: false,
                      }),
                    });
                    result = await res.json();
                  } catch (err) {
                    console.error('Failed to cache track:', err);
                    toast.error(`⚠️ Song couldn't be cached — lockscreen won't work for this track`);
                    return;
                  }
                }

                // If speculative/ready, confirm it
                if (result && (result.status === 'speculative' || result.status === 'ready')) {
                  if (result.status === 'speculative') {
                    // Confirm: flip speculative → ready
                    try {
                      const confirmRes = await fetch('/api/prepare-audio/confirm', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ videoId: currentTrack.videoId }),
                      });
                      const confirmData = await confirmRes.json();
                      if (confirmData.status === 'ready') {
                        result = confirmData;
                      }
                    } catch (err) {
                      console.error('Failed to confirm cache:', err);
                    }
                  }

                  if (result!.audioUrl) {
                    toast.success(`✅ "${currentTrack.title}" is now available with full lockscreen support!`);
                    const store = usePlayerStore.getState();
                    const currentT = getGlobalCurrentTime();
                    store.swapToCachedTrack({
                      ...currentTrack,
                      source: 'pagalworld_cached',
                      audioUrl: result!.audioUrl,
                    });
                    mutate(
                      (key) => typeof key === 'string' && (key.includes('/api/search') || key.includes('/api/library') || key.includes('/api/admin')),
                      undefined,
                      { revalidate: true }
                    );
                    setTimeout(() => {
                      if (typeof (window as any).seekTo === 'function') {
                        (window as any).seekTo(currentT);
                      }
                    }, 200);
                  }
                } else if (result && result.status === 'processing') {
                  // Still processing — poll until ready
                  toast('🎵 Caching this song for lockscreen playback...', { duration: 3000 });
                  for (let i = 0; i < 12; i++) {
                    await new Promise(r => setTimeout(r, 5000));
                    try {
                      const res = await fetch(`/api/prepare-audio?videoId=${currentTrack.videoId}`);
                      const statusData = await res.json();
                      if (statusData.status === 'ready' && statusData.track?.audioUrl) {
                        toast.success(`✅ "${currentTrack.title}" is now available with full lockscreen support!`);
                        const store = usePlayerStore.getState();
                        const currentT = getGlobalCurrentTime();
                        store.swapToCachedTrack({
                          ...currentTrack,
                          source: statusData.track.source || 'pagalworld_cached',
                          audioUrl: statusData.track.audioUrl,
                        });
                        mutate(
                          (key) => typeof key === 'string' && (key.includes('/api/search') || key.includes('/api/library') || key.includes('/api/admin')),
                          undefined,
                          { revalidate: true }
                        );
                        setTimeout(() => {
                          if (typeof (window as any).seekTo === 'function') {
                            (window as any).seekTo(currentT);
                          }
                        }, 200);
                        return;
                      }
                    } catch { /* continue polling */ }
                  }
                  toast.error(`⚠️ Song couldn't be cached — lockscreen won't work for this track`);
                } else if (result && result.error) {
                  toast.error(`⚠️ Song couldn't be cached — lockscreen won't work for this track`);
                }
              };

              doConfirmAndSwap();
            }
          }
        } catch { /* ignore */ }
      }
    }, 1000);

    return () => clearInterval(id);
  }, [isPlaying, isActive, currentTrack]);
  // ══════════════════════════════════════════════════════════════
  // 7. Global Expose for Seek and Sync Play (TrackRow.tsx)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (typeof window === 'undefined') return;

    (window as any).seekTo = (seconds: number) => {
      if (playerRef.current && typeof playerRef.current.seekTo === 'function') {
        playerRef.current.seekTo(seconds, true);
      }
    };

    (window as any).playVideoSync = (videoId?: string) => {
      audioContextRef.current?.resume().catch(() => {});
      silentAudioRef.current?.play().catch(() => {});
      
      if (playerRef.current) {
        if (videoId && typeof playerRef.current.loadVideoById === 'function') {
          playerRef.current.loadVideoById(videoId);
        }
        if (typeof playerRef.current.playVideo === 'function') {
          playerRef.current.playVideo();
        }
      }
    };

    (window as any).playSilentAudio = () => {
      audioContextRef.current?.resume().catch(() => {});
      silentAudioRef.current?.play().catch(() => {});
    };

    (window as any).pauseSilentAudio = () => {
      silentAudioRef.current?.pause();
    };
  }, []);

  // ══════════════════════════════════════════════════════════════
  // 8. Background Keep-Alive Hacks (Web Audio & Silent Audio)
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    const setup = () => {
      if (audioContextRef.current) return;
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        audioContextRef.current = ctx;
        const osc = ctx.createOscillator();
        osc.frequency.value = 1;
        const gain = ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
      } catch { /* ignore */ }
    };

    const onInteract = () => {
      setup();
      audioContextRef.current?.resume().catch(() => {});
    };

    document.addEventListener('click', onInteract);
    document.addEventListener('touchstart', onInteract);
    return () => {
      document.removeEventListener('click', onInteract);
      document.removeEventListener('touchstart', onInteract);
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isPlaying && isActive) {
      silentAudioRef.current?.play().catch(() => {});
      audioContextRef.current?.resume().catch(() => {});

      if ('wakeLock' in navigator && !wakeLockRef.current) {
        (navigator as any).wakeLock.request('screen')
          .then((lock: any) => {
            wakeLockRef.current = lock;
            lock.addEventListener('release', () => {
              wakeLockRef.current = null;
            });
          })
          .catch(() => {});
      }
    } else {
      silentAudioRef.current?.pause();
      wakeLockRef.current?.release().then(() => { wakeLockRef.current = null; }).catch(() => {});
    }
  }, [isPlaying, isActive]);

  // 9a. Set Metadata only when track changes
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

  // 9b. Update playback state only when playing state changes
  useEffect(() => {
    if (!isActive || !('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isActive, isPlaying]);

  // 9c. Setup action handlers
  useEffect(() => {
    if (!isActive || !('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      audioContextRef.current?.resume().catch(() => {});
      silentAudioRef.current?.play().catch(() => {});
      if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
        playerRef.current.playVideo();
      }
      setIsPlaying(true);
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      silentAudioRef.current?.pause();
      if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
        playerRef.current.pauseVideo();
      }
      setIsPlaying(false);
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      audioContextRef.current?.resume().catch(() => {});
      silentAudioRef.current?.play().catch(() => {});
      const prev = playPrevious();
      if (prev) setCurrentTrack(prev);
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      audioContextRef.current?.resume().catch(() => {});
      silentAudioRef.current?.play().catch(() => {});
      handleAdvanceToNext();
    });

    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (playerRef.current && typeof playerRef.current.seekTo === 'function' && details.seekTime !== undefined) {
        playerRef.current.seekTo(details.seekTime, true);
      }
    });
  }, [isActive, playPrevious, setCurrentTrack, setIsPlaying, handleAdvanceToNext]);

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
      <div 
        ref={containerRef} 
        className="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none z-[-9999]"
        style={{ visibility: 'hidden' }}
      />
    </>
  );
}
