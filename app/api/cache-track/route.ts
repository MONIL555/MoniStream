import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import CachedTrack from '@/models/CachedTrack';
import { searchPagalWorld, scrapeSongPage, cacheSongAudio } from '@/lib/pagalworld';
import { searchPagalNew, scrapePagalNewSongPage, cachePagalNewSongAudio } from '@/lib/pagalnew';
import { searchSaavn } from '@/lib/jiosaavn';
import { compositeScore, titleScore } from '@/lib/scoring';

// ─── JioSaavn Verification ──────────────────────────────────
// Cross-references a scraped candidate against JioSaavn search results.
// JioSaavn provides accurate metadata (title, artist, duration in seconds),
// acting as "ground truth" to reject mismatched scrape results.
async function fetchSaavnReference(query: string) {
  try {
    const results = await searchSaavn(query, 10);
    return results;
  } catch (e) {
    console.warn('[Cache Track] JioSaavn verification search failed, proceeding without:', e);
    return [];
  }
}

function verifyCandidateAgainstSaavn(
  candidateTitle: string,
  candidateArtist: string,
  candidateDuration: number,
  saavnResults: any[]
): { verified: boolean; bestScore: number; matchedTitle?: string } {
  if (saavnResults.length === 0) {
    // JioSaavn unavailable — skip verification, rely on scoring alone
    return { verified: true, bestScore: 0 };
  }

  let bestScore = 0;
  let matchedTitle = '';

  for (const saavnTrack of saavnResults) {
    const score = compositeScore(
      saavnTrack.title, saavnTrack.artist, saavnTrack.duration || 0,
      candidateTitle, candidateArtist, candidateDuration
    );
    if (score > bestScore) {
      bestScore = score;
      matchedTitle = saavnTrack.title;
    }
  }

  return {
    verified: bestScore >= 0.40, // Lower threshold since scraped vs API metadata naturally differ
    bestScore,
    matchedTitle,
  };
}

// Minimum composite score for accepting a candidate
const MIN_SCORE_THRESHOLD = 0.55;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const videoId = url.searchParams.get('videoId');
    if (!videoId) return NextResponse.json({ status: 'not_found' }, { status: 400 });
    
    await connectDB();
    const cachedTrack = await CachedTrack.findOne({ videoId, status: 'ready' }).lean();
    if (cachedTrack) {
      return NextResponse.json({ status: 'ready', track: cachedTrack }, {
        headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
      });
    }
    return NextResponse.json({ status: 'not_found' }, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { videoId, title, artist, duration = 0, userId, speculative = false } = await req.json();

    if (!videoId || !title || !artist) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await connectDB();

    // 1. Deduplication check: is it already cached, processing, or speculatively prepared?
    let cachedTrack = await CachedTrack.findOne({ videoId });
    if (cachedTrack) {
      if (cachedTrack.status === 'ready') {
        return NextResponse.json({ 
          status: 'ready', 
          audioUrl: cachedTrack.audioUrl 
        });
      }
      if (cachedTrack.status === 'speculative') {
        // Already speculatively cached — return the prepared data without re-doing work
        return NextResponse.json({
          status: 'speculative',
          audioUrl: cachedTrack.audioUrl,
        });
      }
      if (cachedTrack.status === 'processing') {
        return NextResponse.json({ status: 'processing' });
      }
      // If status is 'failed' or 'pending', we retry
      cachedTrack.status = 'processing';
      await cachedTrack.save();
    } else {
      cachedTrack = new CachedTrack({
        videoId,
        title,
        artist,
        cachedBy: userId || 'anonymous',
        status: 'processing'
      });
      await cachedTrack.save();
    }

    // The final status will be 'speculative' if this is a speculative request, otherwise 'ready'
    const successStatus = speculative ? 'speculative' : 'ready';

    // 2. Clean the title for searching
    const baseTitleMatch = title.match(/^([^-|]+)/);
    let baseTitle = baseTitleMatch ? baseTitleMatch[1].trim() : title;
    baseTitle = baseTitle.replace(/\(.*?(Lyrical|Official|Video|Audio|Full Song|HD|Jhankar|Remix).*?\)/gi, '')
                         .replace(/\[.*?(Lyrical|Official|Video|Audio|Full Song|HD|Jhankar|Remix).*?\]/gi, '').trim();

    const cleanTitle = title
      .replace(/\(.*?(Lyrical|Official|Video|Audio|Full Song|HD|Jhankar|Remix).*?\)/gi, '')
      .replace(/\[.*?(Lyrical|Official|Video|Audio|Full Song|HD|Jhankar|Remix).*?\]/gi, '')
      .replace(/- Topic/i, '').trim();
    let cleanArtist = artist.replace(/- Topic/i, '').replace(/VEVO/i, '').trim();
    
    const query = `${cleanTitle} ${cleanArtist}`.trim();
    
    let smartQuery = '';
    const genericRegex = /lyrical|official|video|audio|full song|hd|jhankar|remix|dance songs/i;
    const titleParts = title.split(/[-|]/).map((p: string) => p.trim()).filter((p: string) => p && !genericRegex.test(p));
    
    if (titleParts.length > 1) {
       // Take the second valid part (which could be movie name or artists)
       const queryPart = titleParts[1].split(',')[0].replace(/\(.*?\)|\[.*?\]/g, '').replace(/feat\.?/i, '').trim(); 
       if (queryPart) smartQuery = `${baseTitle} ${queryPart}`.trim();
    }
    
    // Create a combined context for scoring in case the provided artist is just a label (e.g. 'Tips Official')
    const combinedArtistContext = artist + ' ' + titleParts.slice(1).join(' ');

    // 3. Fetch JioSaavn reference results in parallel with the first PagalWorld search
    console.log(`[Cache Track] Searching PagalWorld + JioSaavn for: ${query}`);
    const [searchResults_initial, saavnReference] = await Promise.all([
      searchPagalWorld(query),
      fetchSaavnReference(`${baseTitle} ${combinedArtistContext}`.trim()),
    ]);

    if (saavnReference.length > 0) {
      console.log(`[Cache Track] JioSaavn reference: ${saavnReference.length} results (top: "${saavnReference[0].title}" by ${saavnReference[0].artist}, ${saavnReference[0].duration}s)`);
    } else {
      console.log(`[Cache Track] No JioSaavn reference available — proceeding with scoring only`);
    }
    
    let searchResults = searchResults_initial;
    
    if (searchResults.length === 0 && smartQuery && smartQuery !== query) {
      console.log(`[Cache Track] Not found on PagalWorld with full query, trying smartQuery: ${smartQuery}`);
      searchResults = await searchPagalWorld(smartQuery);
    }
    
    if (searchResults.length === 0 && cleanTitle !== smartQuery) {
      console.log(`[Cache Track] Not found with smartQuery, trying cleanTitle: ${cleanTitle}`);
      searchResults = await searchPagalWorld(cleanTitle);
    }
    
    if (searchResults.length === 0 && baseTitle !== cleanTitle) {
      console.log(`[Cache Track] Not found on PagalWorld with cleanTitle, trying baseTitle: ${baseTitle}`);
      searchResults = await searchPagalWorld(baseTitle);
    }
    
    const ultraCleanTitle = baseTitle.replace(/\(.*?\)|\[.*?\]/g, '').trim();
    if (searchResults.length === 0 && ultraCleanTitle !== baseTitle) {
      console.log(`[Cache Track] Not found on PagalWorld with baseTitle, trying ultraCleanTitle: ${ultraCleanTitle}`);
      searchResults = await searchPagalWorld(ultraCleanTitle);
    }
    
    // Check up to 8 PagalWorld results
    let bestAudioInfo = null;
    let bestSongDetails = null;
    let bestMatch = null;
    let fallbackToNew = false;
    let highestScore = 0;

    if (searchResults.length > 0) {
      for (const match of searchResults.slice(0, 8)) {
        if (titleScore(baseTitle, match.title) < 0.3) continue;
        
        const details = await scrapeSongPage(match.url);
        if (details) {
          try {
            const info = await cacheSongAudio(details, videoId);
            if (info) {
              const estimatedDuration = info.size > 0 ? info.size / (info.bitrate * 125) : duration;
              const score = compositeScore(
                baseTitle, combinedArtistContext, duration,
                details.title, details.singers || '', estimatedDuration
              );
              console.log(`[Cache Track] PagalWorld candidate "${details.title}" score: ${score.toFixed(3)}`);
              
              // JioSaavn verification
              const verification = verifyCandidateAgainstSaavn(
                details.title, details.singers || '', estimatedDuration, saavnReference
              );
              console.log(`[Cache Track] JioSaavn verification: verified=${verification.verified}, score=${verification.bestScore.toFixed(3)}, matched="${verification.matchedTitle || 'N/A'}"`);

              if (!verification.verified) {
                console.log(`[Cache Track] ❌ Rejected "${details.title}" — failed JioSaavn verification`);
                continue;
              }
              
              if (score > highestScore && score > MIN_SCORE_THRESHOLD) {
                highestScore = score;
                bestAudioInfo = info;
                bestSongDetails = details;
                bestMatch = match;
              }
            }
          } catch (e) {
            console.error(`PagalWorld scrape failed for ${match.url}`, e);
          }
        }
      }
    }

    if (bestAudioInfo) {
      cachedTrack.status = successStatus;
      cachedTrack.audioUrl = bestAudioInfo.url;
      cachedTrack.audioFormat = bestAudioInfo.format;
      cachedTrack.audioBitrate = bestAudioInfo.bitrate;
      cachedTrack.audioSize = bestAudioInfo.size;
      cachedTrack.albumName = bestSongDetails!.album;
      cachedTrack.pagalworldSlug = bestMatch!.slug;
      cachedTrack.source = 'pagalworld_cached';
      
      if (bestSongDetails!.coverUrl) {
        cachedTrack.thumbnails = {
          default: { url: bestSongDetails!.coverUrl, width: 150, height: 150 },
          high: { url: bestSongDetails!.coverUrl, width: 500, height: 500 }
        };
      }
      
      await cachedTrack.save();
      return NextResponse.json({ status: successStatus, audioUrl: cachedTrack.audioUrl, message: 'Song cached via PagalWorld' });
    } else {
      fallbackToNew = true;
    }

    if (fallbackToNew || searchResults.length === 0) {
      console.log(`[Cache Track] Not found on PagalWorld (or rejected), trying PagalNew for: ${query}`);
      let finalPagalNewResults = await searchPagalNew(query);
      
      if (finalPagalNewResults.length === 0 && smartQuery && smartQuery !== query) {
        finalPagalNewResults = await searchPagalNew(smartQuery);
      }
      if (finalPagalNewResults.length === 0 && cleanTitle !== smartQuery) {
        finalPagalNewResults = await searchPagalNew(cleanTitle);
      }
      if (finalPagalNewResults.length === 0 && baseTitle !== cleanTitle) {
        finalPagalNewResults = await searchPagalNew(baseTitle);
      }
      if (finalPagalNewResults.length === 0 && ultraCleanTitle !== baseTitle) {
        finalPagalNewResults = await searchPagalNew(ultraCleanTitle);
      }
      
      if (finalPagalNewResults.length === 0) {
        cachedTrack.status = 'failed';
        await cachedTrack.save();
        return NextResponse.json({ error: 'Song not found on PagalWorld or PagalNew' }, { status: 404 });
      }
      
      // Check up to 8 PagalNew results
      let bestPNewInfo = null;
      let bestPNewDetails = null;
      let bestPNewMatch = null;
      let highestPNewScore = 0;

      if (finalPagalNewResults.length > 0) {
        for (const match of finalPagalNewResults.slice(0, 8)) {
          if (titleScore(baseTitle, match.title) < 0.3) continue;
          
          const details = await scrapePagalNewSongPage(match.url);
          if (details) {
            try {
              const info = await cachePagalNewSongAudio(details, videoId);
              if (info) {
                // If HEAD request was blocked by Cloudflare, info.size will be 0.
                // In that case, we fall back to the YouTube video duration.
                const estimatedDuration = info.size > 0 ? info.size / (info.bitrate * 125) : duration;
                
                const score = compositeScore(
                  baseTitle, combinedArtistContext, duration,
                  details.title, details.singers || '', estimatedDuration
                );
                console.log(`[Cache Track] PagalNew candidate "${details.title}" score: ${score.toFixed(3)}`);
                
                // JioSaavn verification
                const verification = verifyCandidateAgainstSaavn(
                  details.title, details.singers || '', estimatedDuration, saavnReference
                );
                console.log(`[Cache Track] JioSaavn verification: verified=${verification.verified}, score=${verification.bestScore.toFixed(3)}, matched="${verification.matchedTitle || 'N/A'}"`);

                if (!verification.verified) {
                  console.log(`[Cache Track] ❌ Rejected "${details.title}" — failed JioSaavn verification`);
                  continue;
                }
                
                if (score > highestPNewScore && score > MIN_SCORE_THRESHOLD) {
                  highestPNewScore = score;
                  bestPNewInfo = info;
                  bestPNewDetails = details;
                  bestPNewMatch = match;
                }
              }
            } catch (e) {
              console.error(`PagalNew scrape failed for ${match.url}`, e);
            }
          }
        }
      }
      
      if (!bestPNewInfo) {
        cachedTrack.status = 'failed';
        await cachedTrack.save();
        return NextResponse.json({ error: 'Failed to find a matching PagalNew song or file too small' }, { status: 500 });
      }
      
      cachedTrack.status = successStatus;
      cachedTrack.audioUrl = bestPNewInfo.url;
      cachedTrack.audioFormat = bestPNewInfo.format;
      cachedTrack.audioBitrate = bestPNewInfo.bitrate;
      cachedTrack.audioSize = bestPNewInfo.size;
      cachedTrack.albumName = bestPNewDetails!.album;
      cachedTrack.source = 'pagalnew_cached';
      cachedTrack.pagalworldSlug = bestPNewMatch!.slug;
      
      if (bestPNewDetails!.coverUrl) {
        cachedTrack.thumbnails = {
          default: { url: bestPNewDetails!.coverUrl, width: 150, height: 150 },
          high: { url: bestPNewDetails!.coverUrl, width: 500, height: 500 }
        };
      }
      
      await cachedTrack.save();
      return NextResponse.json({ status: successStatus, audioUrl: cachedTrack.audioUrl, message: 'Song cached via PagalNew' });
    }
  } catch (error) { 
    console.error('Error in cache-track API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
