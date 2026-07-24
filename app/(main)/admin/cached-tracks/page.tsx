'use client';

import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Shield, Music, CheckCircle2, XCircle, Clock, Trash2, Plus, Server, HardDrive, RefreshCw, Pencil } from 'lucide-react';
import useSWR from 'swr';
import Link from 'next/link';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function AdminCachedTracksPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | 'ready' | 'failed' | 'processing' | 'admin_request'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Manual Add State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTrack, setNewTrack] = useState({ videoId: '', title: '', artist: '', audioUrl: '', coverUrl: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: tracks, isLoading, error, mutate } = useSWR(
    user?.role === 'admin' ? `/api/admin/cached-tracks?status=${filter}&search=${encodeURIComponent(searchQuery)}` : null,
    fetcher
  );

  if (user?.role !== 'admin') {
    return (
      <div className="py-12 text-center animate-fade-in">
        <Shield className="h-16 w-16 text-destructive mx-auto mb-4 opacity-50" />
        <h3 className="text-2xl font-bold text-destructive">Unauthorized Access</h3>
        <p className="text-muted-foreground text-sm mt-2">You don't have permission to view this page.</p>
      </div>
    );
  }

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"? This will also remove the MP3 from storage.`)) return;

    try {
      const res = await fetch(`/api/admin/cached-tracks?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Track deleted successfully');
      mutate(); // Refresh the list
    } catch (err) {
      toast.error('Failed to delete track');
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTrack.videoId || !newTrack.title || !newTrack.artist || !newTrack.audioUrl) {
      toast.error('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/cached-tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTrack),
      });
      if (!res.ok) throw new Error('Failed to add track');

      toast.success('Track manually added to cache');
      setIsModalOpen(false);
      setNewTrack({ videoId: '', title: '', artist: '', audioUrl: '', coverUrl: '' });
      mutate(); // Refresh list
    } catch (err) {
      toast.error('Failed to add track');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready': return <span className="flex items-center gap-1 text-emerald-400 text-xs bg-emerald-400/10 px-2 py-1 rounded-full w-fit"><CheckCircle2 className="w-3 h-3" /> Ready</span>;
      case 'failed': return <span className="flex items-center gap-1 text-red-400 text-xs bg-red-400/10 px-2 py-1 rounded-full w-fit"><XCircle className="w-3 h-3" /> Failed</span>;
      case 'processing': return <span className="flex items-center gap-1 text-amber-400 text-xs bg-amber-400/10 px-2 py-1 rounded-full w-fit"><RefreshCw className="w-3 h-3 animate-spin" /> Processing</span>;
      case 'admin_request': return <span className="flex items-center gap-1 text-purple-400 text-xs bg-purple-400/10 px-2 py-1 rounded-full w-fit"><Plus className="w-3 h-3" /> Requested</span>;
      default: return <span className="text-muted-foreground text-xs">{status}</span>;
    }
  };

  return (
    <div className="py-6 px-4 md:px-8 flex flex-col gap-8 animate-fade-in pb-32 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {/* <div className="flex items-center gap-2 mb-1">
            <Link href="/admin" className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors">Admin</Link>
            <span className="text-muted-foreground text-xs">/</span>
            <h1 className="text-2xl font-bold text-foreground">Cached Tracks</h1>
          </div> */}
          <p className="text-sm text-muted-foreground">Manage downloaded songs from PagalWorld/PagalNew</p>
        </div>

        <div className="hidden">
          {/* We removed the generic Add button in favor of row-level Edit buttons */}
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col md:flex-row items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10">
        <div className="flex-1 w-full relative">
          <input
            type="text"
            placeholder="Search cached tracks by title or artist..."
            className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-brand-primary transition-colors"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {(['all', 'ready', 'failed', 'processing', 'admin_request'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold capitalize transition-colors whitespace-nowrap ${filter === f ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex flex-col items-center justify-center text-muted-foreground gap-4">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p>Loading tracks...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-400">Failed to load tracks.</div>
        ) : !tracks || tracks.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
            <Server className="w-12 h-12 opacity-20" />
            <p className="font-semibold">No tracks found</p>
            <p className="text-sm">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase text-muted-foreground bg-black/20">
                  <th className="px-4 py-3 font-semibold">Track Info</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {tracks.map((track: any) => {
                  const thumb = typeof track.thumbnails?.default === 'string'
                    ? track.thumbnails.default
                    : track.thumbnails?.default?.url || '';

                  return (
                    <tr key={track._id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md bg-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                            {thumb ? <img src={thumb} className="w-full h-full object-cover" alt="Track thumbnail" /> : <Music className="w-4 h-4 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 max-w-[250px]">
                            <p className="text-sm font-bold truncate text-foreground" title={track.title}>{track.title}</p>
                            <p className="text-xs text-muted-foreground truncate" title={track.artist}>{track.artist}</p>
                            <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate font-mono">ID: {track.videoId}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <HardDrive className="w-3 h-3" />
                          {track.source || 'pagalworld_cached'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(track.status)}
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {new Date(track.cachedAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                        {track.audioSize ? `${(track.audioSize / 1024 / 1024).toFixed(2)} MB` : '-'}
                        <br />
                        {track.audioBitrate ? `${track.audioBitrate} kbps` : ''}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              setNewTrack({
                                videoId: track.videoId,
                                title: track.title,
                                artist: track.artist,
                                audioUrl: '',
                                coverUrl: typeof track.thumbnails?.high === 'string' ? track.thumbnails.high : track.thumbnails?.high?.url || ''
                              });
                              setIsModalOpen(true);
                            }}
                            className="p-2 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-400/10 rounded-full transition-colors md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                            title="Edit Track"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(track._id, track.title)}
                            className="p-2 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-full transition-colors md:opacity-0 md:group-hover:opacity-100 focus:opacity-100"
                            title="Delete Track"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Add Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-background border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border flex justify-between items-center bg-white/5">
              <h2 className="font-bold text-lg">Fix Failed Cache Track</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-muted-foreground hover:text-white"><XCircle className="w-5 h-5" /></button>
            </div>

            <form onSubmit={handleManualAdd} className="p-4 flex flex-col gap-4">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-200 leading-relaxed">
                Provide a direct MP3 URL to manually fulfill this failed request. The title, artist, and video ID are already locked in.
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">YouTube Video ID</label>
                <input readOnly required value={newTrack.videoId} type="text" className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed outline-none" placeholder="e.g. dQw4w9WgXcQ" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Title</label>
                  <input readOnly required value={newTrack.title} type="text" className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed outline-none" placeholder="Song Title" />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Artist</label>
                  <input readOnly required value={newTrack.artist} type="text" className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-sm text-muted-foreground cursor-not-allowed outline-none" placeholder="Artist Name" />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Direct MP3 URL *</label>
                <input required value={newTrack.audioUrl} onChange={e => setNewTrack({ ...newTrack, audioUrl: e.target.value })} type="url" className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-brand-primary outline-none" placeholder="https://..." />
              </div>

              <div>
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1 block">Cover Image URL (Optional)</label>
                <input value={newTrack.coverUrl} onChange={e => setNewTrack({ ...newTrack, coverUrl: e.target.value })} type="url" className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-brand-primary outline-none" placeholder="https://..." />
              </div>

              <div className="mt-4 flex gap-3">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2 font-semibold text-sm rounded-full bg-white/5 hover:bg-white/10 transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 py-2 font-bold text-sm text-black rounded-full bg-brand-primary hover:bg-brand-primary/90 transition-colors disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save Track'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
