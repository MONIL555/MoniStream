import { useState, useEffect } from 'react';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, CheckCircle2, XCircle, Search, Edit2, PlayCircle, PlaySquare } from 'lucide-react';
import { toast } from 'sonner';
import { Track } from '@/types';
import Image from 'next/image';

interface SpotifyImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlistId: string;
  onSuccess: () => void;
}

type TrackStatus = 'pending' | 'resolving' | 'resolved' | 'failed' | 'admin_request';

interface SpotifyTrack {
  title: string;
  artist: string;
  duration: number;
}

interface TrackMatch {
  original: SpotifyTrack;
  status: TrackStatus;
  selectedTrack?: Track;
  candidates: Track[];
  isExpanded: boolean;
}

export function SpotifyImportModal({ isOpen, onClose, playlistId, onSuccess }: SpotifyImportModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [url, setUrl] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  
  const [matches, setMatches] = useState<TrackMatch[]>([]);
  
  // Results
  const [successfulTracks, setSuccessfulTracks] = useState<Track[]>([]);
  const [adminRequestedTracks, setAdminRequestedTracks] = useState<SpotifyTrack[]>([]);

  const resetState = () => {
    setStep(1);
    setUrl('');
    setIsFetching(false);
    setIsImporting(false);
    setMatches([]);
    setSuccessfulTracks([]);
    setAdminRequestedTracks([]);
  };

  const handleClose = () => {
    if (isImporting || step === 3) return;
    resetState();
    onClose();
  };

  const handleFetchTracks = async () => {
    if (!url.includes('spotify.com/playlist')) {
      toast.error('Please enter a valid Spotify Playlist URL');
      return;
    }

    setIsFetching(true);

    try {
      const res = await fetch('/api/spotify/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to fetch Spotify playlist');
      if (!data.tracks || data.tracks.length === 0) throw new Error('No tracks found in playlist');

      const initialMatches: TrackMatch[] = data.tracks.map((t: SpotifyTrack) => ({
        original: t,
        status: 'pending',
        candidates: [],
        isExpanded: false
      }));

      setMatches(initialMatches);
      setStep(2);
      setIsFetching(false);

      // Start resolving matches in background
      resolveMatches(initialMatches);
    } catch (err: any) {
      toast.error(err.message || 'An error occurred during fetch');
      setIsFetching(false);
    }
  };

  const resolveMatches = async (initialMatches: TrackMatch[]) => {
    const updated = [...initialMatches];

    for (let i = 0; i < updated.length; i++) {
      setMatches(prev => {
        const next = [...prev];
        if (next[i]) {
          next[i] = { ...next[i], status: 'resolving' };
        }
        return next;
      });

      try {
        const track = updated[i].original;
        const res = await fetch(`/api/tracks/search-candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: track.title, artist: track.artist, duration: track.duration }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.candidates && data.candidates.length > 0) {
            setMatches(prev => {
              const next = [...prev];
              if (next[i]) {
                next[i] = {
                  ...next[i],
                  status: 'resolved',
                  candidates: data.candidates,
                  selectedTrack: data.candidates[0]
                };
              }
              return next;
            });
            continue;
          }
        }
        
        // No candidates found
        setMatches(prev => {
          const next = [...prev];
          if (next[i]) {
            next[i] = { ...next[i], status: 'failed' };
          }
          return next;
        });

      } catch (err) {
        setMatches(prev => {
          const next = [...prev];
          if (next[i]) {
            next[i] = { ...next[i], status: 'failed' };
          }
          return next;
        });
      }
    }
  };

  const toggleExpand = (index: number) => {
    setMatches(prev => {
      const next = [...prev];
      if (next[index]) {
        next[index] = { ...next[index], isExpanded: !next[index].isExpanded };
      }
      return next;
    });
  };

  const selectCandidate = (matchIndex: number, candidate: Track) => {
    setMatches(prev => {
      const next = [...prev];
      if (next[matchIndex]) {
        next[matchIndex] = {
          ...next[matchIndex],
          selectedTrack: candidate,
          status: 'resolved',
          isExpanded: false
        };
      }
      return next;
    });
  };

  const handleSearchYouTube = async (matchIndex: number) => {
    const match = matches[matchIndex];
    const track = match.original;
    
    // Optimistic loading state
    setMatches(prev => {
      const next = [...prev];
      if (next[matchIndex]) {
        next[matchIndex] = { ...next[matchIndex], status: 'resolving' };
      }
      return next;
    });

    try {
      // 1. Resolve YouTube
      const res = await fetch(`/api/tracks/resolve-youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: track.title, artist: track.artist }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.track) {
          const ytTrack = data.track;
          toast.info('Found on YouTube! Attempting to cache...', { id: 'cache-toast' });
          
          // 2. Start caching
          const cacheRes = await fetch('/api/cache-track', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId: ytTrack.videoId,
              title: ytTrack.title,
              artist: ytTrack.artist,
            }),
          });
          
          if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            if (cacheData.status === 'ready' || cacheData.status === 'processing') {
              const cachedCandidate = {
                ...ytTrack,
                source: cacheData.audioUrl ? 'pagalworld_cached' : 'processing_cached',
                audioUrl: cacheData.audioUrl,
              };
              
              setMatches(prev => {
                const next = [...prev];
                if (next[matchIndex]) {
                  next[matchIndex] = {
                    ...next[matchIndex],
                    status: 'resolved',
                    selectedTrack: cachedCandidate,
                    isExpanded: false
                  };
                }
                return next;
              });
              toast.success('Successfully cached track!', { id: 'cache-toast' });
              return;
            }
          }
        }
      }
      throw new Error('Not found or failed to cache');
    } catch (e) {
      toast.error('Failed to cache. Falling back to Admin Request.', { id: 'cache-toast' });
      handleRequestAdmin(matchIndex);
    }
  };

  const handleRequestAdmin = (matchIndex: number) => {
    setMatches(prev => {
      const next = [...prev];
      if (next[matchIndex]) {
        next[matchIndex] = {
          ...next[matchIndex],
          status: 'admin_request',
          selectedTrack: undefined,
          isExpanded: false
        };
      }
      return next;
    });
  };

  const handleFinalizeImport = async () => {
    setStep(3);
    setIsImporting(true);

    const tracksToImport = matches
      .filter(m => m.status === 'resolved' && m.selectedTrack)
      .map(m => m.selectedTrack!);

    const requestsToAdmin = matches
      .filter(m => m.status === 'admin_request')
      .map(m => m.original);

    let finalTracksToImport = [...tracksToImport];

    try {
      // 1. Submit admin requests and get the track objects
      for (const req of requestsToAdmin) {
        const adminRes = await fetch('/api/tracks/request-admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
             title: req.title,
             artist: req.artist,
          }),
        });
        
        if (adminRes.ok) {
          const data = await adminRes.json();
          if (data.track) {
            finalTracksToImport.push(data.track);
          }
        }
      }

      // 2. Bulk import all resolved tracks + admin requests
      if (finalTracksToImport.length > 0) {
        const res = await fetch(`/api/playlists/${playlistId}/import-tracks-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: finalTracksToImport }),
        });
        if (!res.ok) throw new Error('Failed to import tracks');
      }

      setSuccessfulTracks(tracksToImport);
      setAdminRequestedTracks(requestsToAdmin);
      setStep(4);
      setIsImporting(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred during finalization');
      setIsImporting(false);
      setStep(2); // Go back to review
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <div className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import from Spotify</DialogTitle>
          <DialogDescription>
            {step === 1 && 'Enter a public Spotify Playlist URL to import its tracks.'}
            {step === 2 && 'Review matches. We automatically searched for candidates.'}
            {step === 3 && 'Finalizing import...'}
            {step === 4 && 'Import complete!'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col py-2">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Input 
                placeholder="https://open.spotify.com/playlist/..." 
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isFetching}
              />
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 overflow-y-auto space-y-3 hide-scrollbar pb-2">
              {matches.map((match, i) => (
                <div key={i} className="border border-white/10 bg-black/20 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 pr-4">
                      <p className="font-medium text-sm truncate">{match.original.title}</p>
                      <p className="text-xs text-muted-foreground truncate">{match.original.artist}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {match.status === 'pending' && <span className="text-xs text-muted-foreground">Waiting...</span>}
                      {match.status === 'resolving' && <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />}
                      
                      {match.status === 'resolved' && match.selectedTrack && (
                        <div className="flex items-center gap-2 bg-green-500/10 text-green-500 px-2 py-1 rounded text-xs border border-green-500/20">
                          <CheckCircle2 className="h-3 w-3" />
                          <span className="truncate max-w-[120px]" title={match.selectedTrack.title}>{match.selectedTrack.title}</span>
                          <button onClick={() => toggleExpand(i)} className="ml-1 hover:text-green-400">
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {match.status === 'failed' && (
                        <div className="flex items-center gap-2 bg-red-500/10 text-red-500 px-2 py-1 rounded text-xs border border-red-500/20">
                          <XCircle className="h-3 w-3" />
                          <span>Not Found</span>
                          <button onClick={() => toggleExpand(i)} className="ml-1 hover:text-red-400">
                            <Search className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {match.status === 'admin_request' && (
                        <div className="flex items-center gap-2 bg-yellow-500/10 text-yellow-500 px-2 py-1 rounded text-xs border border-yellow-500/20">
                          <span>Requested</span>
                          <button onClick={() => toggleExpand(i)} className="ml-1 hover:text-yellow-400">
                            <Edit2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {match.isExpanded && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Alternative Matches</p>
                      {match.candidates.map((c, idx) => (
                        <div key={idx} className={`flex items-center justify-between p-2 rounded ${match.selectedTrack?.videoId === c.videoId ? 'bg-brand-primary/20 border border-brand-primary/50' : 'bg-white/5 hover:bg-white/10 cursor-pointer'}`} onClick={() => selectCandidate(i, c)}>
                          <div className="flex items-center gap-3 min-w-0">
                            {c.thumbnails?.default ? (
                              <img src={c.thumbnails.default} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded bg-white/10 flex items-center justify-center shrink-0">
                                <PlayCircle className="h-4 w-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate">{c.title}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{c.artist} • {c.source}</p>
                            </div>
                          </div>
                          {match.selectedTrack?.videoId === c.videoId && <CheckCircle2 className="h-4 w-4 text-brand-primary shrink-0" />}
                        </div>
                      ))}
                      
                      {match.candidates.length === 0 && <p className="text-xs text-muted-foreground py-1">No local or JioSaavn matches found.</p>}

                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <Button size="sm" variant="ghost" className="flex-1 text-xs h-8 bg-white/5" onClick={() => handleSearchYouTube(i)}>
                          <PlaySquare className="h-3 w-3 mr-1" /> Use YouTube
                        </Button>
                        <Button size="sm" variant="ghost" className="flex-1 text-xs h-8 bg-white/5" onClick={() => handleRequestAdmin(i)}>
                          Request Admin
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
              <p className="text-sm text-muted-foreground animate-pulse">Saving tracks to playlist...</p>
            </div>
          )}

          {step === 4 && (
            <div className="py-4 space-y-4">
              <div className="flex items-center gap-2 text-green-500 mb-2">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold">Import Finished</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Successfully added {successfulTracks.length} tracks.
              </p>
              {adminRequestedTracks.length > 0 && (
                <p className="text-sm text-yellow-500">
                  {adminRequestedTracks.length} tracks were flagged for admin review.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={handleClose} disabled={isImporting || isFetching || step === 3}>
            {step === 4 ? 'Close' : 'Cancel'}
          </Button>
          
          {step === 1 && (
            <Button variant="brand" onClick={handleFetchTracks} disabled={!url || isFetching}>
              {isFetching ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Fetching...</> : 'Fetch Playlist'}
            </Button>
          )}

          {step === 2 && (
            <Button variant="brand" onClick={handleFinalizeImport} disabled={matches.some(m => m.status === 'resolving')}>
              Confirm & Import
            </Button>
          )}
        </DialogFooter>
      </div>
    </Dialog>
  );
}
