import { NextRequest, NextResponse } from 'next/server';
import { searchSaavn } from '@/lib/jiosaavn';

// Expanded filter: catches jukebox, non-stop, medley, remix, lofi, slowed etc.
const COMPILATION_RE = /top\s*\d+|best of|mashup|jukebox|compilation|full album|audio jukebox|collection|playlist|medley|non[\s-]?stop|all songs|hit songs|evergreen/i;

// Filter out remix/lofi/slowed/cover variants of the original song
const VARIANT_RE = /\b(remix|lofi|lo[\s-]?fi|slowed|reverb|8d|3d|bass\s*boost(?:ed)?|karaoke|instrumental|cover|unplugged|acoustic\s*version|nightcore|sped\s*up|chipmunk)\b/i;

function isCompilation(title: string): boolean {
  return COMPILATION_RE.test(title);
}

function isVariant(title: string): boolean {
  return VARIANT_RE.test(title);
}

// Strip trailing noise from artist/channel names: "(Official)", "- Topic", etc.
function cleanStr(str: string): string {
  return (str ?? '')
    .replace(/\s*[\-–|]\s*(Topic|VEVO|Official|Music).*$/i, '')
    .replace(/\s*[\(\[].+?[\)\]]/g, '')
    .trim();
}

function getTokens(title: string): Set<string> {
  let base = title.toLowerCase();
  // Remove content in brackets/parentheses
  base = base.replace(/\s*[\(\[].+?[\)\]]/g, '');
  // Remove known noise words
  base = base.replace(/\b(official|video|audio|lyrical|lyric|full|song|hd|4k|remix|mashup|mix|beat|lofi|slowed|reverb|instrumental|cover|karaoke|live|studio|feat|ft|featuring|version|edit|tiktok|viral|trend|bass|boosted|chill|vibes|music|bgm|trap|dj|8d|3d)\b/gi, '');
  // Split by non-alphanumeric and filter small words
  return new Set(base.split(/[^a-z0-9]+/).filter(t => t.length > 2));
}

/**
 * Extract related artist names from a primary artist string.
 * e.g. "Arijit Singh, Shreya Ghoshal" → ["Arijit Singh", "Shreya Ghoshal"]
 * e.g. "Vishal Mishra feat. Hansika P..." → ["Vishal Mishra", "Hansika P"]
 */
function extractArtists(artist: string): string[] {
  if (!artist) return [];
  return artist
    .split(/[,&]|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b/i)
    .map(a => cleanStr(a))
    .filter(a => a.length > 1);
}

/**
 * Build diverse search queries that go beyond just the primary artist.
 * This creates a radio-like mix with similar vibes from different artists.
 */
function buildDiverseQueries(cleanArtist: string, cleanTitle: string, allArtists: string[]): string[] {
  const queries: string[] = [];
  const primaryArtist = allArtists[0] || cleanArtist;

  // ── Strategy 1: Title + Artist (find the exact song context)
  if (cleanTitle && primaryArtist) {
    queries.push(`${cleanTitle} ${primaryArtist}`);
  }

  // ── Strategy 2: Primary artist top songs
  if (primaryArtist) {
    queries.push(primaryArtist);
    queries.push(`${primaryArtist} hits`);
  }

  // ── Strategy 3: Featured/secondary artists (different artist, same vibe)
  for (const secondaryArtist of allArtists.slice(1, 3)) {
    if (secondaryArtist && secondaryArtist !== primaryArtist) {
      queries.push(secondaryArtist);
      queries.push(`${secondaryArtist} hits`);
    }
  }

  // ── Strategy 4: Genre/mood keywords extracted from title
  const moodKeywords = extractMoodKeywords(cleanTitle);
  if (moodKeywords) {
    queries.push(`${moodKeywords} songs`);
    if (primaryArtist) {
      queries.push(`${primaryArtist} ${moodKeywords}`);
    }
  }

  // ── Strategy 5: Better Discovery (instead of arbitrary 'latest Hindi songs')
  if (primaryArtist) {
    queries.push(`${primaryArtist} new songs`);
  } else if (cleanTitle) {
    queries.push(cleanTitle);
  }

  return Array.from(new Set(queries)).filter(Boolean).slice(0, 4); // deduplicate and cap at 4 for speed
}

/**
 * Extract mood/genre hints from the song title.
 */
function extractMoodKeywords(title: string): string {
  const lower = (title || '').toLowerCase();
  const moods: string[] = [];

  if (/sad|dard|tanha|judaa|alvida|bewafa|broken|dil|rula|aashiqui|yaad/i.test(lower)) moods.push('sad');
  if (/love|ishq|pyaar|mohabbat|dil|romantic|tere|tumse|sanam/i.test(lower)) moods.push('romantic');
  if (/party|dance|nachle|badshah|honey|yo yo|groove|beat/i.test(lower)) moods.push('party');
  if (/chill|sukoon|rahat|soulful|unplugged|acoustic/i.test(lower)) moods.push('chill');
  if (/motivat|josh|winner|power|strong|udaan/i.test(lower)) moods.push('motivational');
  if (/remix|mix|dj|club/i.test(lower)) moods.push('club');
  if (/rap|hip hop|gangsta|hood|trap/i.test(lower)) moods.push('hip hop');

  return moods[0] || ''; // Return primary mood
}

/**
 * Fisher-Yates shuffle for array randomization
 */
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const videoId = searchParams.get('videoId');
    const artist  = searchParams.get('artist');
    const title   = searchParams.get('title') || '';
    const skipVideoIdsRaw = searchParams.get('skipVideoIds') || '';

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    const cleanArtist = cleanStr(artist ?? '');
    const cleanTitle = cleanStr(title);
    const allArtists = extractArtists(artist ?? '');

    // Parse skip list (already-played tracks to exclude)
    const skipIds = new Set<string>(
      skipVideoIdsRaw ? skipVideoIdsRaw.split(',').filter(Boolean) : []
    );

    // ── DIVERSIFIED MIX ALGORITHM ───────────────────────────────
    const queries = buildDiverseQueries(cleanArtist, cleanTitle, allArtists);

    console.log(`[Autoplay] Queries for "${cleanTitle}" by "${cleanArtist}":`, queries);

    const settled = await Promise.allSettled(
      queries.map(q => searchSaavn(q, 20))
    );

    const buckets: any[][] = settled.map(r =>
      r.status === 'fulfilled' ? (r.value ?? []) : []
    );

    const seenIds = new Set<string>([videoId, ...skipIds]);
    const seenTitlesTokens: Set<string>[] = [getTokens(title)];
    const artistCounts = new Map<string, number>();
    const mixTracks: any[] = [];
    const maxLen = Math.max(...buckets.map(b => b.length), 0);

    // Primary artist name (normalized) for cap calculation
    const primaryArtistLower = cleanArtist.toLowerCase();

    // Round-robin pick from each bucket for diversity
    for (let i = 0; i < maxLen; i++) {
      for (const bucket of buckets) {
        const item = bucket[i];
        if (!item) continue;

        if (seenIds.has(item.videoId)) continue;
        if (isCompilation(item.title)) continue;
        if (isVariant(item.title)) continue;

        // Normalize artist name for counting
        const itemArtistLower = (item.artist || item.channelTitle || '').toLowerCase();

        // Primary artist capped at 10 tracks, secondary artists capped at 4 tracks
        const currentCount = artistCounts.get(itemArtistLower) || 0;
        const isPrimary = primaryArtistLower && (itemArtistLower.includes(primaryArtistLower) || primaryArtistLower.includes(itemArtistLower));
        const limit = isPrimary ? 10 : 4;
        
        if (currentCount >= limit) continue;

        const tokens = getTokens(item.title);
        if (tokens.size === 0) continue;

        // Dedup: Jaccard similarity check
        let isDuplicate = false;
        for (const seenTokens of seenTitlesTokens) {
          let intersection = 0;
          for (const t of tokens) {
            if (seenTokens.has(t)) intersection++;
          }
          const union = new Set([...tokens, ...seenTokens]).size;
          const similarity = intersection / union;

          if (similarity >= 0.3) {
            isDuplicate = true;
            break;
          }
        }

        if (isDuplicate) continue;

        seenIds.add(item.videoId);
        seenTitlesTokens.push(tokens);
        if (itemArtistLower) {
          artistCounts.set(itemArtistLower, currentCount + 1);
        }
        mixTracks.push(item);
      }
    }

    if (mixTracks.length === 0) {
      // Fallback: return whatever we have without strict filtering
      console.warn(`[Autoplay] No tracks after filtering, trying relaxed mode...`);
      const allTracks = buckets.flat().filter(t => t && !seenIds.has(t.videoId) && !isCompilation(t.title));
      const uniqueById = new Map<string, any>();
      for (const t of allTracks) {
        if (!uniqueById.has(t.videoId)) {
          uniqueById.set(t.videoId, t);
        }
      }
      const fallbackTracks = Array.from(uniqueById.values()).slice(0, 15);

      if (fallbackTracks.length === 0) {
        // Broad safety fallback: fetch top Hindi hits so music never stops
        try {
          const emergencyTracks = await searchSaavn('Top Hindi Songs', 10);
          const validEmergency = emergencyTracks.filter(t => t && !seenIds.has(t.videoId));
          if (validEmergency.length > 0) {
            return NextResponse.json({
              playlist: shuffleArray(validEmergency),
              track: validEmergency[0],
            });
          }
        } catch { /* ignore */ }

        return NextResponse.json({ error: 'No similar tracks found' }, { status: 404 });
      }

      return NextResponse.json({
        playlist: shuffleArray(fallbackTracks),
        track: fallbackTracks[0],
      });
    }

    // Shuffle the mix for a radio-like feel (not always same order)
    const shuffledMix = shuffleArray(mixTracks);

    // Return up to 15 tracks for good uninterrupted play without excessive payload
    const playlist = shuffledMix.slice(0, 15);

    console.log(`[Autoplay] Built mix: ${playlist.length} tracks from ${artistCounts.size} artists`);

    const response = NextResponse.json({
      playlist,
      track: playlist[0],
    });
    response.headers.set('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return response;

  } catch (error: any) {
    console.error('Autoplay GET Error:', error);
    return NextResponse.json({ error: 'Failed to fetch autoplay track' }, { status: 500 });
  }
}
