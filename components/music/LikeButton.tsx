'use client';

import { useState } from 'react';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

interface LikeButtonProps {
  videoId: string;
  initialLiked?: boolean; // Kept for backwards compatibility but ignored for state
  className?: string;
}

export function LikeButton({ videoId, className }: LikeButtonProps) {
  // Fine-grained selector: only re-renders when THIS track's liked state changes
  const isLiked = useAuthStore(s => s.user?.likedTrackIds?.includes(videoId) ?? false);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const toggleLikedTrackId = useAuthStore(s => s.toggleLikedTrackId);
  const [isLoading, setIsLoading] = useState(false);

  const toggleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) return;

    // Optimistic UI update
    const newLikedState = !isLiked;
    toggleLikedTrackId(videoId, newLikedState);
    setIsLoading(true);

    try {
      const res = await fetch('/api/library/liked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      if (!res.ok) throw new Error('Failed to toggle like');
      const data = await res.json();
      
      // If server disagrees with our optimistic update, correct it
      if (data.liked !== newLikedState) {
        toggleLikedTrackId(videoId, data.liked);
      }
    } catch (error) {
      // Revert optimistic update on error
      toggleLikedTrackId(videoId, isLiked);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleLike}
      disabled={isLoading || !isAuthenticated}
      className={cn(
        "h-10 w-10 text-muted-foreground hover:text-brand-primary transition-all duration-300",
        isLiked && "text-brand-primary",
        className
      )}
    >
      <Heart className={cn("h-5 w-5 transition-transform", isLiked && "fill-current scale-110")} />
    </Button>
  );
}
