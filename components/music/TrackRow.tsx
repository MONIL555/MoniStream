'use client';
import React, { useState, useRef, memo } from 'react';

import { Play, Pause, MoreHorizontal, ListPlus, User, Trash2 } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';
import { motion, useAnimation } from 'framer-motion';
import { useQueueStore } from '@/store/queueStore';
import { LikeButton } from './LikeButton';
import { Button } from '@/components/ui/button';
import { formatDuration, cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { useRouter } from 'next/navigation';

const fetcher = (url: string) => fetch(url).then(res => res.json());

import { useShallow } from 'zustand/react/shallow';

interface TrackRowProps {
  track: any;
  index?: number;
  showCover?: boolean;
  onRemove?: () => void;
  contextTracks?: any[];
  isPlaylistContext?: boolean;
  currentPlaylistId?: string;
}

export const TrackRow = memo(function TrackRow({ track, index, showCover = true, onRemove, contextTracks, isPlaylistContext = false, currentPlaylistId }: TrackRowProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const togglePlay = usePlayerStore(s => s.togglePlay);
  const setCurrentTrack = usePlayerStore(s => s.setCurrentTrack);
  const fetchMixForTrack = usePlayerStore(s => s.fetchMixForTrack);
  
  const loadPlaylist = useQueueStore(s => s.loadPlaylist);
  const loadSingle = useQueueStore(s => s.loadSingle);
  const addToQueue = useQueueStore(s => s.addToQueue);
  
  const { mutate, cache } = useSWRConfig();
  // Read playlists from shared SWR cache (populated by Sidebar) instead of firing a new fetch per row
  const cachedPlaylists = cache.get('/api/playlists');
  const playlists = cachedPlaylists?.data;
  
  const isCurrentTrack = currentTrack?.videoId === track.videoId;
  
  const title = track.title || 'Unknown Title';
  const artist = track.artist || track.channelName || track.channelTitle || 'Unknown Artist';
  const thumbnail = typeof track.thumbnails?.default === 'string' ? track.thumbnails.default : (track.thumbnails?.default as any)?.url || track.thumbnail || '';
  const durationText = track.durationText || (track.duration ? formatDuration(track.duration) : '');
  const isPendingAdmin = (track.source === 'admin_manual' || track.videoId?.startsWith('req_')) && !track.audioUrl;

  const handlePlay = () => {
    if (isDragging || isPendingAdmin) return; // Prevent click if dragging or pending admin
    const isNativeTrack = !!(track.streamUrl || track.saavnId || track.videoId?.startsWith('saavn_') || track.audioUrl || (track.source && (track.source.endsWith('_cached') || track.source === 'admin_manual')));
    
    if (typeof window !== 'undefined') {
      if (isCurrentTrack) {
        // Toggle play/pause for current track
        if (!isPlaying) {
          if (isNativeTrack) {
            // Just unlock audio context for native tracks
            (window as any).playSilentAudio?.();
          } else {
            (window as any).playVideoSync?.();
          }
        }
      } else {
        if (isNativeTrack) {
          // Native track — only unlock audio context, don't touch YouTube
          (window as any).playSilentAudio?.();
        } else {
          // YouTube track — load into YouTube player
          (window as any).playVideoSync?.(track.videoId);
        }
      }
    }
    
    if (isCurrentTrack) {
      togglePlay();
    } else {
      const trackData = {
        videoId: track.videoId,
        saavnId: track.saavnId,
        source: track.source,
        streamUrl: track.streamUrl,
        audioUrl: track.audioUrl,
        title, artist,
        channelId: track.channelId || '',
        albumName: track.albumName,
        thumbnails: { default: thumbnail, high: typeof track.thumbnails?.high === 'string' ? track.thumbnails.high : '' },
        duration: track.duration || 0, durationText,
        tags: [], playCount: 0, likeCount: 0, cachedAt: new Date().toISOString()
      };

      if (isPlaylistContext && contextTracks && contextTracks.length > 0) {
        // Playlist mode: load all tracks, play in order, no autoplay
        // Filter out admin requested tracks from the queue
        const validContextTracks = contextTracks.filter(t => !(t.source === 'admin_manual' || t.videoId?.startsWith('req_')) || t.audioUrl);
        
        const playlist = validContextTracks.map(t => ({
          videoId: t.videoId,
          saavnId: t.saavnId,
          source: t.source,
          streamUrl: t.streamUrl,
          title: t.title || 'Unknown Title',
          artist: t.artist || t.channelName || t.channelTitle || 'Unknown Artist',
          channelId: t.channelId || '',
          albumName: t.albumName,
          audioUrl: t.audioUrl,
          thumbnails: { default: typeof t.thumbnails?.default === 'string' ? t.thumbnails.default : (t.thumbnails?.default as any)?.url || '', high: typeof t.thumbnails?.high === 'string' ? t.thumbnails.high : (t.thumbnails?.high as any)?.url || '' },
          duration: t.duration || 0,
          durationText: t.durationText || (t.duration ? formatDuration(t.duration) : ''),
          tags: [], playCount: 0, likeCount: 0, cachedAt: new Date().toISOString()
        }));
        
        const startIndex = index !== undefined ? index : playlist.findIndex(t => t.videoId === track.videoId);
        const currentTrackToPlay = loadPlaylist(playlist, Math.max(0, startIndex), 'playlist');
        if (currentTrackToPlay) setCurrentTrack(currentTrackToPlay);
      } else {
        // Single mode: play this track, generate a mix for autoplay
        loadSingle(trackData);
        setCurrentTrack(trackData);
        // Immediately fetch mix in the background
        fetchMixForTrack(trackData);
      }
    }
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    const playlistKey = `/api/playlists/${playlistId}`;
    
    // Optimistic update
    mutate(playlistKey, (currentData: any) => {
      if (!currentData || !currentData.playlist) return currentData;
      // We don't know the exact format of the playlist payload, but if it has tracks array, we append
      return {
        ...currentData,
        playlist: {
          ...currentData.playlist,
          tracks: [...(currentData.playlist.tracks || []), track]
        }
      };
    }, { revalidate: false });

    try {
      const res = await fetch(playlistKey, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track })
      });
      if (res.ok) {
        toast.success('Added to playlist');
        mutate('/api/playlists');
        mutate(playlistKey);
      } else {
        toast.error('Failed to add to playlist');
        mutate(playlistKey); // Revert
      }
    } catch {
      toast.error('Error adding to playlist');
      mutate(playlistKey); // Revert
    }
  };

  return (
    <div className="relative w-full rounded-xl mb-1">
      {/* Background for swipe action */}
      {!isPendingAdmin && (
        <div className="absolute inset-0 bg-brand-primary/20 rounded-xl flex items-center justify-start px-4 overflow-hidden">
          <span className="text-brand-primary font-bold text-sm flex items-center gap-2">
            <ListPlus className="h-5 w-5" /> Add to Queue
          </span>
        </div>
      )}

      <motion.div 
        drag={!isPendingAdmin ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0, right: 0.5 }}
        onDragStart={() => !isPendingAdmin && setIsDragging(true)}
        onDragEnd={(e, info) => {
          setTimeout(() => setIsDragging(false), 100); // delay so onClick can check it
          if (info.offset.x > 80) {
            const trackData = {
              videoId: track.videoId, title, artist,
              channelId: track.channelId || '',
              thumbnails: { default: thumbnail },
              duration: track.duration || 0, durationText,
              tags: [], playCount: 0, likeCount: 0, cachedAt: new Date().toISOString()
            };
            addToQueue(trackData);
            toast.success('Added to queue');
          }
        }}
        className={cn(
          "relative bg-background group flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 md:py-2 rounded-xl transition-colors duration-200",
          menuOpen ? "z-50" : "z-10",
          isCurrentTrack 
            ? "clay-inset bg-brand-primary/10" 
            : isPendingAdmin
              ? "opacity-60"
              : "hover:bg-surface-hover cursor-pointer"
        )}
        onClick={handlePlay}
      >
      {/* Thumbnail with play overlay */}
      {showCover && (
        <div className="relative shrink-0 rounded-lg overflow-hidden h-9 w-9 md:h-11 md:w-11">
          <Avatar 
            size="md" 
            src={thumbnail} 
            alt={title}
            className="rounded-lg h-9 w-9 md:h-11 md:w-11 border-none shadow-none" 
          />
          {!isPendingAdmin && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              {isCurrentTrack && isPlaying ? (
                <Pause className="h-3 w-3 md:h-4 md:w-4 text-white fill-white" />
              ) : (
                <Play className="h-3 w-3 md:h-4 md:w-4 text-white fill-white ml-0.5" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Title & Artist — takes maximum space */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className={cn(
          "font-bold truncate text-xs md:text-sm flex items-center gap-2",
          isCurrentTrack ? "text-brand-primary" : "text-foreground group-hover:text-brand-primary transition-colors"
        )}>
          {title}
          {isPendingAdmin && (
            <span className="bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap">
              Pending Admin
            </span>
          )}
        </div>
        <div className="text-[10px] md:text-xs font-semibold text-muted-foreground truncate">
          {artist}
        </div>
      </div>

      {/* Right Actions — compact */}
      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className={cn("transition-opacity", !isCurrentTrack && "md:opacity-0 md:group-hover:opacity-100")}>
          <LikeButton videoId={track.videoId} className="h-8 w-8" />
        </div>
        
        <span className="text-xs font-semibold text-muted-foreground min-w-[40px] text-right hidden sm:block">
          {durationText}
        </span>

        <DropdownMenu 
          onOpenChange={setMenuOpen}
          trigger={
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          }
        >
          <div className="py-1 w-48">
            {!isPendingAdmin && (
              <DropdownMenuItem onClick={(e) => {
                // Intentionally NOT calling e.stopPropagation() so that the DropdownMenu's close handler triggers.
                const trackData = {
                  videoId: track.videoId, title, artist,
                  channelId: track.channelId || '',
                  thumbnails: { default: thumbnail },
                  duration: track.duration || 0, durationText,
                  tags: [], playCount: 0, likeCount: 0, cachedAt: new Date().toISOString()
                };
                addToQueue(trackData);
                toast.success('Added to queue');
              }}>
                <ListPlus className="mr-3 h-4 w-4" /> Add to queue
              </DropdownMenuItem>
            )}
            
            {playlists && playlists.filter((p: any) => String(p._id) !== String(currentPlaylistId)).length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
                {playlists.filter((p: any) => String(p._id) !== String(currentPlaylistId)).map((pl: any) => (
                  <DropdownMenuItem key={pl._id} onClick={() => handleAddToPlaylist(pl._id)} className="pl-6">
                    {pl.name}
                  </DropdownMenuItem>
                ))}
              </>
            )}
            
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push(`/artist/${encodeURIComponent(artist)}`)}>
              <User className="mr-3 h-4 w-4" /> Go to artist
            </DropdownMenuItem>
            {onRemove && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onRemove} className="text-destructive hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="mr-3 h-4 w-4" /> Remove from this list
                </DropdownMenuItem>
              </>
            )}
          </div>
        </DropdownMenu>
      </div>
      </motion.div>
    </div>
  );
});
