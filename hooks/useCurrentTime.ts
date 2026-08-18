// ============================================================
// MoniStream — Ref-Based Current Time System
// ============================================================
// This decouples playback time from Zustand to avoid cascading
// re-renders every second across all store subscribers.
// Players write to a module-level ref (zero re-renders).
// Components that need to display time subscribe via RAF polling.
//
// Battery optimization: The RAF loop is paused when music is
// not playing, eliminating continuous CPU/GPU wake-ups.
// ============================================================

'use client';

import { useEffect, useRef, useState } from 'react';

// ── Module-level shared state (not React state) ──────────────
let _currentTime = 0;
let _isPlaying = false;

/** Called by players (YouTubeEmbed, NativeAudioPlayer) to update time — zero React re-renders */
export function setGlobalCurrentTime(t: number) {
  _currentTime = t;
}

/** Synchronous getter for imperative reads (history checks, media session, etc.) */
export function getGlobalCurrentTime(): number {
  return _currentTime;
}

/** Reset time (call on track change) */
export function resetGlobalCurrentTime() {
  _currentTime = 0;
}

/** Set global playing state — controls whether RAF loops run at all */
export function setGlobalPlayingState(playing: boolean) {
  _isPlaying = playing;
}

/** Synchronous getter for playing state */
export function getGlobalPlayingState(): boolean {
  return _isPlaying;
}

/**
 * React hook that polls the global current time at a configurable FPS.
 * Only components that actually render time (ProgressBar, FullscreenPlayer lyrics)
 * should use this. The polling is paused when:
 * - The component is unmounted
 * - Music is not playing (_isPlaying is false)
 *
 * @param fps - How many times per second to update the React state (default: 4)
 *              4fps is plenty for a progress bar. 10fps for lyrics sync.
 * @returns The current playback time in seconds
 */
export function useCurrentTime(fps: number = 4): number {
  const [time, setTime] = useState(0);
  const rafRef = useRef<number>(0);
  const lastUpdateRef = useRef(0);
  const intervalMs = 1000 / fps;

  useEffect(() => {
    let running = true;

    const tick = (now: number) => {
      if (!running) return;

      // When not playing, slow-poll at 1fps just to catch the final time value,
      // then stop. This prevents the RAF from spinning at 60Hz while paused.
      if (!_isPlaying) {
        // Update one last time with current value, then pause the loop
        setTime(prev => {
          const t = _currentTime;
          if (Math.abs(prev - t) >= 0.1) return t;
          return prev;
        });
        // Re-check every 500ms if playback resumed (cheap idle poll)
        setTimeout(() => {
          if (running) rafRef.current = requestAnimationFrame(tick);
        }, 500);
        return;
      }

      if (now - lastUpdateRef.current >= intervalMs) {
        lastUpdateRef.current = now;
        const t = _currentTime;
        // Only trigger a React re-render if the value actually changed
        setTime(prev => {
          const threshold = intervalMs / 1000;
          if (Math.abs(prev - t) >= threshold) return t;
          return prev;
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [intervalMs]);

  return time;
}
