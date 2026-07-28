import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyAccessToken } from '@/lib/auth';
import { apiLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';
import Playlist from '@/models/Playlist';
import CachedTrack from '@/models/CachedTrack';
import { searchSaavn } from '@/lib/jiosaavn';
import { formatDurationText } from '@/lib/youtube';
import { Track } from '@/types';

import { compositeScore } from '@/lib/scoring';

// ─── Main Handler ────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const jwtUser = verifyAccessToken(token);

    const body = await req.json();
    const { title, artist, duration = 0 } = body;

    if (!title || !artist) {
      return NextResponse.json({ error: 'Title and artist are required' }, { status: 400 });
    }

    const resolvedParams = await params;

    await connectDB();

    const playlist = await Playlist.findOne({
      _id: resolvedParams.id,
      $or: [{ userId: jwtUser.userId }, { collaborators: jwtUser.userId }]
    });
    
    if (!playlist) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    // ─── Multi-Strategy JioSaavn Search ──────────────────────

    const cleanTitle = title
      .replace(/\(.*?(Lyrical|Official|Video|Audio).*?\)/gi, '')
      .replace(/\[.*?(Lyrical|Official|Video|Audio).*?\]/gi, '').trim();
    const mainArtist = artist.split(',')[0].trim();
    
    // Try multiple search queries to maximize hits
    const searchQueries = [
      `${cleanTitle} ${mainArtist}`,   // Strategy 1: title + main artist
      cleanTitle,                       // Strategy 2: title only (catches different artist names)
    ];
    // Deduplicate queries
    const uniqueQueries = [...new Set(searchQueries.map((q: string) => q.trim().toLowerCase()))];

    let bestMatch: Track | null = null;
    let bestScore = 0;
    const MIN_SCORE = 0.55; // Minimum threshold to accept a match

    for (const query of uniqueQueries) {
      try {
        const results = await searchSaavn(query, 10);
        if (!results || results.length === 0) continue;

        for (const candidate of results) {
          const score = compositeScore(
            cleanTitle, artist, duration,
            candidate.title, candidate.artist, candidate.duration
          );

          console.log(`[Import] Query="${query}" | Candidate="${candidate.title}" by "${candidate.artist}" (${candidate.duration}s) | Score=${score.toFixed(3)}`);

          if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
          }
        }
      } catch (err) {
        console.error(`[Import] JioSaavn search failed for query "${query}":`, err);
      }
    }

    let resolvedTrack: any = null;

    if (bestMatch && bestScore >= MIN_SCORE) {
      // ─── JioSaavn match found ──────────────────────────────
      console.log(`[Import] ✓ JioSaavn match: "${bestMatch.title}" by "${bestMatch.artist}" | Score=${bestScore.toFixed(3)}`);
      resolvedTrack = bestMatch;
    } else {
      // ─── Fallback: cache via PagalWorld/PagalNew ───────────
      console.log(`[Import] ✗ No JioSaavn match (best score=${bestScore.toFixed(3)}). Falling back to cache.`);

      // Generate a deterministic videoId so re-imports don't create duplicates
      const deterministicId = `import_${Buffer.from(`${cleanTitle.toLowerCase()}_${mainArtist.toLowerCase()}`).toString('base64url').slice(0, 20)}`;

      // Check if already cached with this ID
      const existingCached = await CachedTrack.findOne({ videoId: deterministicId });
      
      if (existingCached && existingCached.status === 'ready') {
        // Already cached — reuse it
        console.log(`[Import] ♻ Reusing cached track: ${deterministicId}`);
        resolvedTrack = {
          videoId: deterministicId,
          title,
          artist,
          source: existingCached.source || 'pagalworld_cached',
          audioUrl: existingCached.audioUrl,
          thumbnails: existingCached.thumbnails?.default?.url ? {
            default: existingCached.thumbnails.default.url,
            high: existingCached.thumbnails.high?.url || existingCached.thumbnails.default.url,
          } : { default: '', high: '' },
          duration: existingCached.duration || duration,
          durationText: formatDurationText(existingCached.duration || duration),
          playCount: 0,
          likeCount: 0,
          channelId: 'import',
        };
      } else {
        // Not cached yet — trigger caching
        try {
          const cacheRes = await fetch(new URL('/api/prepare-audio', req.url).toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              videoId: deterministicId,
              title: cleanTitle,
              artist: mainArtist,
              duration,
              userId: jwtUser.userId,
            }),
          });

          if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            if (cacheData.status === 'ready' || cacheData.status === 'processing') {
              resolvedTrack = {
                videoId: deterministicId,
                title,
                artist,
                source: cacheData.audioUrl ? (cacheData.audioUrl.includes('pagalnew') ? 'pagalnew_cached' : 'pagalworld_cached') : 'pagalworld_cached',
                audioUrl: cacheData.audioUrl || '',
                thumbnails: { default: '', high: '' },
                duration,
                durationText: formatDurationText(duration),
                playCount: 0,
                likeCount: 0,
                channelId: 'import',
              };
            }
          }
        } catch (err) {
          console.error('[Import] Cache-track fallback failed:', err);
        }
      }
    }

    if (!resolvedTrack) {
      return NextResponse.json({ error: 'Track could not be resolved on JioSaavn or cached', title, artist }, { status: 404 });
    }

    // Add track to playlist if not already present (check by videoId)
    const trackExists = playlist.tracks.some((t: any) => t.videoId === resolvedTrack.videoId);
    if (!trackExists) {
      playlist.tracks.push(resolvedTrack);
      await playlist.save();
    }

    return NextResponse.json({ success: true, track: resolvedTrack, source: resolvedTrack.source || 'unknown' });
  } catch (error: any) {
    console.error('Import Track Error:', error);
    return NextResponse.json({ error: 'Failed to import track' }, { status: 500 });
  }
}
