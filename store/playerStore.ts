// ============================================================
// MoniStream — Player Store (Zustand)
// ============================================================

'use client';

import { create } from 'zustand';
import type { Track, RepeatMode } from '@/types';
import { useQueueStore } from './queueStore';
import { useAuthStore } from './authStore';
import { useConfigStore } from './configStore';
import { toast } from 'sonner';
import { resetGlobalCurrentTime } from '@/hooks/useCurrentTime';
import { consumePrefetchedStreamUrl } from '@/hooks/usePrefetch';

interface PlayerState {
  // State
  currentTrack: Track | null;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  // currentTime is now managed via ref-based system in hooks/useCurrentTime.ts
  duration: number;
  isLyricsOpen: boolean;
  isQueueOpen: boolean;
  isFullscreen: boolean;
  contextPlaylistId: string | null;
  isPlayerReady: boolean;
  activePlayer: 'native' | 'youtube'; // New
  isFetchingMix: boolean;

  // Actions
  setCurrentTrack: (track: Track | null) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setDuration: (duration: number) => void;
  toggleLyrics: () => void;
  toggleQueue: () => void;
  toggleFullscreen: () => void;
  setContextPlaylistId: (id: string | null) => void;
  setPlayerReady: (ready: boolean) => void;
  setActivePlayer: (player: 'native' | 'youtube') => void;
  reset: () => void;
  advanceToNext: () => Promise<void>;
  fetchMixForTrack: (track: Track, force?: boolean) => Promise<void>;
  swapToCachedTrack: (track: Track) => void;
}

const initialState = {
  currentTrack: null,
  isPlaying: false,
  volume: 100,
  isMuted: false,
  duration: 0,
  isLyricsOpen: false,
  isQueueOpen: false,
  isFullscreen: false,
  contextPlaylistId: null,
  isPlayerReady: false,
  activePlayer: 'youtube' as const,
  isFetchingMix: false,
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  ...initialState,

  setActivePlayer: (player) => set({ activePlayer: player }),

  setCurrentTrack: (track) => {
    if (!track) {
      resetGlobalCurrentTime();
      set({ currentTrack: null, duration: 0, isPlaying: false, activePlayer: 'youtube' });
      return;
    }

    let activePlayer: 'native' | 'youtube' = 'youtube';
    if (track.streamUrl || track.saavnId || track.videoId?.startsWith('saavn_') || (track.source && (track.source.endsWith('_cached') || track.source === 'admin_manual'))) {
      activePlayer = 'native';
    }

    // Check Feature Flag for YouTube Fallback
    if (activePlayer === 'youtube') {
      const { youtubeFallbackEnabled } = useConfigStore.getState();
      if (!youtubeFallbackEnabled) {
        toast.error(`Cannot play "${track.title}" - YouTube streaming is disabled by admin.`);
        
        // Use a timeout to avoid deep recursion if many tracks are skipped in a row
        setTimeout(() => {
          get().advanceToNext();
        }, 1000);
        
        return; // Don't set the track
      }
    }

    resetGlobalCurrentTime();
    set({ currentTrack: track, duration: 0, isPlaying: !!track, activePlayer });
  },

  swapToCachedTrack: (track) => {
    // Unlike setCurrentTrack, this doesn't reset currentTime or duration.
    // It just swaps the track source seamlessly.
    set({ currentTrack: track, activePlayer: 'native' });
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),

  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setVolume: (volume) => set({ volume, isMuted: volume === 0 }),

  toggleMute: () =>
    set((state) => ({ isMuted: !state.isMuted })),

  // currentTime is now managed via ref-based system — see hooks/useCurrentTime.ts

  setDuration: (duration) => set({ duration }),

  toggleLyrics: () =>
    set((state) => ({
      isLyricsOpen: !state.isLyricsOpen,
      isQueueOpen: state.isLyricsOpen ? state.isQueueOpen : false,
    })),

  toggleQueue: () =>
    set((state) => ({
      isQueueOpen: !state.isQueueOpen,
      isLyricsOpen: state.isQueueOpen ? state.isLyricsOpen : false,
    })),

  toggleFullscreen: () =>
    set((state) => ({ isFullscreen: !state.isFullscreen })),

  setContextPlaylistId: (id) => set({ contextPlaylistId: id }),

  setPlayerReady: (ready) => set({ isPlayerReady: ready }),

  reset: () => set(initialState),

  /**
   * Fetch a mix for the given track and populate the autoplay queue.
   * Called immediately when a single song starts playing, and again
   * when the autoplay queue runs low during playback (infinite radio).
   * 
   * @param force - bypass the isFetchingMix guard (used when queue is empty and we MUST fetch)
   */
  fetchMixForTrack: async (track: Track, force?: boolean) => {
    const { isFetchingMix } = get();
    if (isFetchingMix && !force) return; // prevent concurrent fetches (unless forced)

    const user = useAuthStore.getState().user as any;
    const autoplayEnabled = user?.preferences?.autoplay !== false;
    if (!autoplayEnabled) return;

    set({ isFetchingMix: true });

    try {
      const skipIds = useQueueStore.getState().getPlayedVideoIds();
      // Also include current track videoId in skip list
      const currentVideoId = get().currentTrack?.videoId;
      const allSkipIds = currentVideoId ? [...skipIds, currentVideoId] : skipIds;
      // To prevent extremely long URLs in endless radio mode, take the last 60 skip IDs
      const recentSkipIds = allSkipIds.slice(-60);
      const skipParam = recentSkipIds.length > 0 ? `&skipVideoIds=${recentSkipIds.join(',')}` : '';
      
      // Background mix fetch — no artificial delay (browser handles connection scheduling)
      
      console.log(`[Autoplay] Fetching mix for: "${track.title}" by "${track.artist}"...`);
      const res = await fetch(
        `/api/autoplay?videoId=${track.videoId}&artist=${encodeURIComponent(track.artist || '')}&title=${encodeURIComponent(track.title || '')}${skipParam}`
      );

      if (!res.ok) {
        console.warn(`[Autoplay] API returned ${res.status} for "${track.title}"`);
        return;
      }

      const data = await res.json();

      if (data.playlist && data.playlist.length > 0) {
        // Filter out any tracks already in our queues
        const existingIds = new Set([
          ...useQueueStore.getState().autoplayQueue.map(t => t.videoId),
          ...useQueueStore.getState().userQueue.map(t => t.videoId),
          ...allSkipIds,
        ]);

        const newTracks = data.playlist.filter(
          (t: any) => t.videoId && !existingIds.has(t.videoId)
        );

        if (newTracks.length > 0) {
          useQueueStore.getState().appendAutoplayQueue(newTracks);
          console.log(`[Autoplay] Added ${newTracks.length} tracks to mix queue`);
        } else {
          console.log(`[Autoplay] All ${data.playlist.length} tracks already in queue/history, skipped`);
        }
      }
    } catch (err) {
      console.error('[Autoplay] Failed to fetch mix tracks:', err);
    } finally {
      set({ isFetchingMix: false });
    }
  },

  advanceToNext: async () => {
    const { currentTrack, setCurrentTrack, setIsPlaying, fetchMixForTrack } = get();
    const queueState = useQueueStore.getState();
    let next = queueState.playNext(currentTrack);

    // If no next track, attempt autoplay if source is 'single'
    if (!next && currentTrack) {
      const { playbackSource } = useQueueStore.getState();

      if (playbackSource === 'single') {
        const user = useAuthStore.getState().user as any;
        const autoplayEnabled = user?.preferences?.autoplay !== false;

        if (autoplayEnabled) {
          // Force fetch even if another fetch is in progress — queue is empty, this is urgent
          console.log(`[Autoplay] Queue empty, urgently fetching mix for: "${currentTrack.title}"...`);
          
          try {
            await fetchMixForTrack(currentTrack, true);
            next = useQueueStore.getState().playNext(null);
          } catch (err) {
            console.error('[Autoplay] Urgent fetch failed:', err);
          }

          // If still nothing, try with a track from history for different results
          if (!next) {
            const { history } = useQueueStore.getState();
            const historyTrack = history.length > 1
              ? history[Math.floor(Math.random() * Math.min(history.length, 5))]
              : null;

            if (historyTrack && historyTrack.videoId !== currentTrack.videoId) {
              console.log(`[Autoplay] Retrying with history track: "${historyTrack.title}"...`);
              try {
                await fetchMixForTrack(historyTrack, true);
                next = useQueueStore.getState().playNext(null);
              } catch (err) {
                console.error('[Autoplay] History-based fetch also failed:', err);
              }
            }
          }
        }
      }
      // If source is 'playlist', we do NOT autoplay — playlist ends naturally
    }

    if (next) {
      // Inject prefetched stream URL if available (instant transition)
      const prefetchedUrl = consumePrefetchedStreamUrl(next.videoId);
      if (prefetchedUrl && !next.streamUrl && !next.audioUrl) {
        next = { ...next, streamUrl: prefetchedUrl };
      }
      setCurrentTrack(next);
      setIsPlaying(true);

      // Pre-fetch next batch if autoplay queue is running low (< 3 tracks)
      const { autoplayQueue, playbackSource } = useQueueStore.getState();
      if (playbackSource === 'single' && autoplayQueue.length < 3) {
        // Use the NEW track (not the old one) for diverse results
        fetchMixForTrack(next);
      }
    } else {
      console.log('[Autoplay] No next track available, stopping playback.');
      setCurrentTrack(null);
      setIsPlaying(false);
    }
  },
}));
