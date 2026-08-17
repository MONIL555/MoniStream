'use client';

import { usePlayerStore } from '@/store/playerStore';
import { Slider } from '@/components/ui/slider';
import { formatDuration } from '@/lib/utils';
import { useState, useRef } from 'react';
import { useCurrentTime } from '@/hooks/useCurrentTime';

export function ProgressBar() {
  const duration = usePlayerStore(s => s.duration);
  const currentTime = useCurrentTime(4); // 4fps polling — smooth enough for a progress bar
  const [localTime, setLocalTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Display time: use local (dragged) time if dragging, otherwise use polled time
  const displayTime = isDragging ? localTime : currentTime;

  const handleChange = (val: number) => {
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    setIsDragging(true);
    setLocalTime(val);
  };

  const handleCommit = (val: number) => {
    if (typeof window !== 'undefined' && (window as any).seekTo) {
      (window as any).seekTo(val);
    }
    
    // Prevent the progress bar from immediately jumping back to the old time
    // before the YouTube player has a chance to update the state.
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);
    dragTimeoutRef.current = setTimeout(() => {
      setIsDragging(false);
    }, 800);
  };

  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-xs font-semibold text-muted-foreground min-w-[40px] text-right">
        {formatDuration(displayTime)}
      </span>
      <Slider
        value={displayTime}
        max={duration || 100}
        step={1}
        onChange={handleChange}
        onValueCommit={handleCommit}
        className="flex-1"
      />
      <span className="text-xs font-semibold text-muted-foreground min-w-[40px]">
        {formatDuration(duration)}
      </span>
    </div>
  );
}
