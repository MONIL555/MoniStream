// ============================================================
// MoniStream — Ultra Power-Saving Current Time System
// ============================================================
// Decouples playback time from Zustand to prevent re-renders.
// Optimized for all devices (low-end mobile, laptops on battery):
//
// 1. Zero polling when paused: When music is paused, RAF loop is
//    completely stopped (no setTimeout timers waking up CPU).
// 2. Pocket/Lockscreen Power Saving: When the screen is off or
//    tab is in background (document.hidden), UI loops are suspended.
//    No React state updates when nobody is looking at the screen!
// 3. Instant sync on wakeup: When the screen turns back on,
//    time updates immediately with zero latency.
// ============================================================

'use client';

import { useEffect, useRef, useState } from 'react';

// ── Module-level shared state (zero React overhead) ──────────
let _currentTime = 0;
let _isPlaying = false;
const _playStateListeners = new Set<(playing: boolean) => void>();

/** Called by audio players to update time without triggering React renders */
export function setGlobalCurrentTime(t: number) {
  _currentTime = t;
}

/** Synchronous getter for imperative reads (history, mediaSession, etc.) */
export function getGlobalCurrentTime(): number {
  return _currentTime;
}

/** Reset time on track transition */
export function resetGlobalCurrentTime() {
  _currentTime = 0;
}

/** Set global playing state and wake up sleeping UI listeners */
export function setGlobalPlayingState(playing: boolean) {
  _isPlaying = playing;
  _playStateListeners.forEach(listener => {
    try {
      listener(playing);
    } catch { /* ignore */ }
  });
}

/** Synchronous getter for playing state */
export function getGlobalPlayingState(): boolean {
  return _isPlaying;
}

/**
 * Ultra-low power hook for displaying playback progress / synced lyrics.
 * - Suspends completely when tab/screen is hidden (saves battery in pocket)
 * - Suspends completely when paused (no timer wakeups)
 * - Batches UI updates according to target FPS
 */
export function useCurrentTime(fps: number = 4): number {
  const [time, setTime] = useState(_currentTime);
  const rafRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);
  const intervalMs = 1000 / fps;

  useEffect(() => {
    let active = true;

    const stopLoop = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };

    const updateTimeOnce = () => {
      const t = _currentTime;
      setTime(prev => (Math.abs(prev - t) >= 0.08 ? t : prev));
    };

    const tick = (now: number) => {
      if (!active) return;

      // If document is hidden (screen off / in pocket) or music stopped, suspend loop
      if (typeof document !== 'undefined' && document.hidden) {
        rafRef.current = 0;
        return;
      }

      if (!_isPlaying) {
        updateTimeOnce();
        rafRef.current = 0;
        return;
      }

      if (now - lastUpdateRef.current >= intervalMs) {
        lastUpdateRef.current = now;
        updateTimeOnce();
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (!_isPlaying) {
        updateTimeOnce();
        return;
      }
      if (!rafRef.current) {
        lastUpdateRef.current = performance.now();
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    // Listen to play/pause transitions from audio players
    const onPlayStateChange = (playing: boolean) => {
      if (playing) {
        startLoop();
      } else {
        stopLoop();
        updateTimeOnce();
      }
    };

    _playStateListeners.add(onPlayStateChange);

    // Listen to visibility change (screen turn on/off, tab switch)
    const onVisibilityChange = () => {
      if (document.hidden) {
        // Phone screen turned off or switched away — halt RAF loop immediately
        stopLoop();
      } else {
        // Screen turned back on — instant sync and resume if playing
        updateTimeOnce();
        if (_isPlaying) {
          startLoop();
        }
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    // Initial start if currently playing and visible
    startLoop();

    return () => {
      active = false;
      stopLoop();
      _playStateListeners.delete(onPlayStateChange);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, [intervalMs]);

  return time;
}
