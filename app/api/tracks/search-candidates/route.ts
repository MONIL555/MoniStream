import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyAccessToken } from '@/lib/auth';
import { apiLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';
import CachedTrack from '@/models/CachedTrack';
import { searchSaavn } from '@/lib/jiosaavn';
import { Track } from '@/types';
import { formatDurationText } from '@/lib/youtube';

/** Normalize a string for comparison: lowercase, strip parens/brackets, trim */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/lyrical|official|video|audio|full song|hd|unplugged|reprise|remix|lofi|mash\s*up|acoustic/gi, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Get individual meaningful words from a string */
function getWords(s: string): string[] {
  return normalize(s).split(' ').filter((w: string) => w.length > 1);
}

/** Score how well two titles match (0-1). */
function titleScore(query: string, candidate: string): number {
  const qWords = getWords(query);
  const cWords = getWords(candidate);
  if (qWords.length === 0) return 0;

  if (normalize(query) === normalize(candidate)) return 1.0;

  let matched = 0;
  for (const qw of qWords) {
    if (cWords.some((cw: string) => cw === qw || cw.includes(qw) || qw.includes(cw))) {
      matched++;
    }
  }
  const overlap = matched / qWords.length;
  const extraPenalty = cWords.length > qWords.length * 2 ? 0.15 : 0;
  return Math.max(0, overlap - extraPenalty);
}

/** Score how well artists match (0-1). */
function artistScore(queryArtist: string, candidateArtist: string): number {
  const qWords = getWords(queryArtist);
  const cWords = getWords(candidateArtist);
  if (qWords.length === 0) return 0.5; 

  let matched = 0;
  for (const qw of qWords) {
    if (qw.length > 2 && cWords.some((cw: string) => cw === qw || cw.includes(qw) || qw.includes(cw))) {
      matched++;
    }
  }
  return matched > 0 ? Math.min(1.0, matched / Math.min(qWords.length, 3)) : 0;
}

/** Score duration proximity (0-1). */
function durationScore(expected: number, actual: number): number {
  if (expected <= 0 || actual <= 0) return 0.5;
  const diff = Math.abs(expected - actual);
  const tolerance = expected * 0.20;
  if (diff <= 5) return 1.0;
  if (diff > tolerance) return 0.0;
  return 1.0 - (diff / tolerance);
}

/** Composite score with weighted factors */
function compositeScore(
  queryTitle: string, queryArtist: string, expectedDuration: number,
  candidateTitle: string, candidateArtist: string, candidateDuration: number
): number {
  const ts = titleScore(queryTitle, candidateTitle);
  const as = artistScore(queryArtist, candidateArtist);
  const ds = durationScore(expectedDuration, candidateDuration);
  return (ts * 0.45) + (ds * 0.35) + (as * 0.20);
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    verifyAccessToken(token);

    const { title, artist, duration = 0 } = await req.json();

    if (!title || !artist) {
      return NextResponse.json({ error: 'Title and artist are required' }, { status: 400 });
    }

    await connectDB();

    const cleanTitle = title.replace(/\(.*?\)|\[.*?\]|Lyrical|Official|Video|Audio/gi, '').trim();
    const mainArtist = artist.split(',')[0].trim();
    
    const searchQueries = [
      `${cleanTitle} ${mainArtist}`,
      cleanTitle,
    ];
    const uniqueQueries = [...new Set(searchQueries.map((q: string) => q.trim().toLowerCase()))];

    let candidates: Array<Track & { matchScore: number }> = [];
    const seenIds = new Set<string>();

    // 1. Search JioSaavn
    for (const query of uniqueQueries) {
      try {
        const results = await searchSaavn(query, 5);
        if (!results || results.length === 0) continue;

        for (const candidate of results) {
          if (seenIds.has(candidate.videoId)) continue;
          
          const score = compositeScore(
            cleanTitle, artist, duration,
            candidate.title, candidate.artist, candidate.duration
          );

          candidates.push({ ...candidate, matchScore: score });
          seenIds.add(candidate.videoId);
        }
      } catch (err) {
        console.error(`[SearchCandidates] JioSaavn search failed for query "${query}":`, err);
      }
    }

    // 2. Search Cached DB
    try {
      // Find tracks with exact text match
      const cachedResults = await CachedTrack.find(
        { $text: { $search: `"${cleanTitle}" "${mainArtist}"` } },
        { score: { $meta: "textScore" } }
      ).sort({ score: { $meta: "textScore" } }).limit(5);

      for (const cached of cachedResults) {
        if (seenIds.has(cached.videoId)) continue;

        const score = compositeScore(
          cleanTitle, artist, duration,
          cached.title, cached.artist, cached.duration || 0
        );

        candidates.push({
          videoId: cached.videoId,
          title: cached.title,
          artist: cached.artist,
          source: cached.source || 'pagalworld_cached',
          audioUrl: cached.audioUrl || '',
          thumbnails: cached.thumbnails?.default?.url ? {
            default: cached.thumbnails.default.url,
            high: cached.thumbnails.high?.url || cached.thumbnails.default.url,
          } : { default: '', high: '' },
          duration: cached.duration || 0,
          durationText: formatDurationText(cached.duration || 0),
          playCount: cached.playCount || 0,
          likeCount: 0,
          channelId: cached.channelId || 'import',
          channelTitle: cached.channelTitle || '',
          matchScore: score
        });
        seenIds.add(cached.videoId);
      }
    } catch (err) {
       console.error(`[SearchCandidates] Cache search failed:`, err);
    }

    // Sort all candidates by match score
    candidates.sort((a, b) => b.matchScore - a.matchScore);

    return NextResponse.json({ success: true, candidates });
  } catch (error: any) {
    console.error('Search Candidates Error:', error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
