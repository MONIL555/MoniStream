// ============================================================
// MoniStream — Stream URL Prefetcher
// ============================================================
// Watches the queue and prefetches the next track's stream URL
// so that song transitions are instant (no API roundtrip delay).
// ============================================================

'use client';

import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueStore } from '@/store/queueStore';

// ── Module-level prefetch cache ──────────────────────────────
const _prefetchCache = new Map<string, string>(); // videoId → streamUrl
const _inflight = new Set<string>(); // currently fetching

/** Get a cached stream URL for a videoId, or null if not cached */
export function getPrefetchedStreamUrl(videoId: string): string | null {
  return _prefetchCache.get(videoId) || null;
}

/** Clear a specific entry (after use) */
export function consumePrefetchedStreamUrl(videoId: string): string | null {
  const url = _prefetchCache.get(videoId) || null;
  _prefetchCache.delete(videoId);
  return url;
}

/** Clear all cached URLs */
export function clearPrefetchCache() {
  _prefetchCache.clear();
  _inflight.clear();
}

/**
 * Prefetch a stream URL for a given track.
 * Only prefetches native audio tracks (saavn/cached/admin_manual).
 * YouTube tracks don't need prefetching (iframe handles its own buffering).
 */
async function prefetchStreamUrl(track: any): Promise<void> {
  if (!track || !track.videoId) return;
  
  // Already cached or in-flight
  if (_prefetchCache.has(track.videoId) || _inflight.has(track.videoId)) return;

  // If the track already has a direct streamUrl or audioUrl, cache it directly
  if (track.streamUrl) {
    _prefetchCache.set(track.videoId, track.streamUrl);
    return;
  }
  
  if (track.audioUrl) {
    let urlToPlay = track.audioUrl;
    const isProxied = urlToPlay.startsWith('/api/stream-proxy?url=');
    let rawUrl = isProxied ? decodeURIComponent(urlToPlay.replace('/api/stream-proxy?url=', '')) : urlToPlay;
    
    // Fix old Google Drive /view URLs
    if (rawUrl.includes('drive.google.com/file/d/')) {
      const match = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        rawUrl = `https://drive.google.com/uc?export=download&id=${match[1]}`;
      }
    }
    
    // Re-evaluate proxy
    if (rawUrl.includes('drive.google.com')) {
      _prefetchCache.set(track.videoId, `/api/stream-proxy?url=${encodeURIComponent(rawUrl)}`);
    } else {
      _prefetchCache.set(track.videoId, rawUrl);
    }
    return;
  }

  // Only attempt API fetch for tracks that would use the stream endpoint
  const isNativeTrack = !!(track.saavnId || track.videoId?.startsWith('saavn_') || 
    (track.source && (track.source.endsWith('_cached') || track.source === 'admin_manual')));
  
  if (!isNativeTrack) return; // YouTube tracks — skip

  const saavnIdToUse = track.saavnId || (track.videoId?.startsWith('saavn_') ? track.videoId.replace('saavn_', '') : null);
  const trackIdToFetch = saavnIdToUse || track.videoId;
  
  if (!trackIdToFetch) return;

  _inflight.add(track.videoId);
  
  try {
    const res = await fetch(`/api/tracks/${trackIdToFetch}/stream`);
    const data = await res.json();
    if (data.streamUrl) {
      _prefetchCache.set(track.videoId, data.streamUrl);
    }
  } catch {
    // Silent fail — the actual player will handle errors
  } finally {
    _inflight.delete(track.videoId);
  }
}

/**
 * Hook that watches the queue and prefetches the next track's stream URL.
 * Mount this once in the Player component.
 */
export function usePrefetch() {
  const lastPrefetchedRef = useRef<string | null>(null);
  
  useEffect(() => {
    // Subscribe to queue changes outside of React render cycle
    const unsubQueue = useQueueStore.subscribe((state) => {
      const { userQueue, queue, autoplayQueue, playbackSource } = state;
      
      // Determine the next track (same priority logic as playNext)
      let nextTrack: any = null;
      if (userQueue.length > 0) {
        nextTrack = userQueue[0];
      } else if (playbackSource === 'playlist' && queue.length > 0) {
        nextTrack = queue[0];
      } else if (playbackSource === 'single' && autoplayQueue.length > 0) {
        nextTrack = autoplayQueue[0];
      }
      
      if (nextTrack && nextTrack.videoId !== lastPrefetchedRef.current) {
        lastPrefetchedRef.current = nextTrack.videoId;
        prefetchStreamUrl(nextTrack);
      }
    });

    return () => {
      unsubQueue();
    };
  }, []);
}
