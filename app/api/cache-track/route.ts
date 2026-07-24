import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import CachedTrack from '@/models/CachedTrack';
import { searchPagalWorld, scrapeSongPage, cacheSongAudio } from '@/lib/pagalworld';
import { searchPagalNew, scrapePagalNewSongPage, cachePagalNewSongAudio } from '@/lib/pagalnew';

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
    const { videoId, title, artist, userId } = await req.json();

    if (!videoId || !title || !artist) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await connectDB();

    // 1. Deduplication check: is it already cached or processing?
    let cachedTrack = await CachedTrack.findOne({ videoId });
    if (cachedTrack) {
      if (cachedTrack.status === 'ready' || cachedTrack.status === 'processing') {
        return NextResponse.json({ 
          status: cachedTrack.status, 
          audioUrl: cachedTrack.audioUrl 
        });
      }
      // If status is 'failed', we will retry the caching process.
      // Update status to processing
      cachedTrack.status = 'processing';
      await cachedTrack.save();
    } else {
      // Create a pending record
      cachedTrack = new CachedTrack({
        videoId,
        title,
        artist,
        cachedBy: userId || 'anonymous',
        status: 'processing'
      });
      await cachedTrack.save();
    }



    // 2. Search PagalWorld
    // We clean the title to get better search results (remove "Lyrical Video", "Official Video", etc)
    const baseTitleMatch = title.match(/^([^-|]+)/);
    let baseTitle = baseTitleMatch ? baseTitleMatch[1].trim() : title;
    baseTitle = baseTitle.replace(/\(.*?\)|\[.*?\]|Lyrical|Official|Video|Audio|Full Song|HD/gi, '').trim();

    const cleanTitle = title
      .replace(/\(.*?\)|\[.*?\]|Lyrical|Official|Video|Audio|Full Song|HD/gi, '')
      .replace(/- Topic/i, '').trim();
    let cleanArtist = artist.replace(/- Topic/i, '').replace(/VEVO/i, '').trim();
    
    const query = `${cleanTitle} ${cleanArtist}`.trim();
    
    console.log(`[Cache Track] Searching PagalWorld for: ${query}`);
    let searchResults = await searchPagalWorld(query);
    
    if (searchResults.length === 0) {
      console.log(`[Cache Track] Not found on PagalWorld with full query, trying cleanTitle: ${cleanTitle}`);
      searchResults = await searchPagalWorld(cleanTitle);
    }
    
    if (searchResults.length === 0 && baseTitle !== cleanTitle) {
      console.log(`[Cache Track] Not found on PagalWorld with cleanTitle, trying baseTitle: ${baseTitle}`);
      searchResults = await searchPagalWorld(baseTitle);
    }
    
    // Check up to 3 PagalWorld results to avoid ringtones
    let bestAudioInfo = null;
    let bestSongDetails = null;
    let bestMatch = null;
    let fallbackToNew = false;

    if (searchResults.length > 0) {
      const match = searchResults[0];
      const details = await scrapeSongPage(match.url);
      if (details) {
        try {
          const info = await cacheSongAudio(details, videoId);
          bestAudioInfo = info;
          bestSongDetails = details;
          bestMatch = match;
        } catch (e) {
          console.error(`PagalWorld scrape failed for ${match.url}`, e);
        }
      }
    }

    if (bestAudioInfo && bestAudioInfo.size > 1500000) {
      cachedTrack.status = 'ready';
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
      return NextResponse.json({ status: 'ready', audioUrl: cachedTrack.audioUrl, message: 'Song cached via PagalWorld' });
    } else {
      fallbackToNew = true;
    }

    if (fallbackToNew || searchResults.length === 0) {
      console.log(`[Cache Track] Not found on PagalWorld (or ringtone), trying PagalNew for: ${query}`);
      let finalPagalNewResults = await searchPagalNew(query);
      
      if (finalPagalNewResults.length === 0) {
        finalPagalNewResults = await searchPagalNew(cleanTitle);
      }
      if (finalPagalNewResults.length === 0 && baseTitle !== cleanTitle) {
        finalPagalNewResults = await searchPagalNew(baseTitle);
      }
      
      if (finalPagalNewResults.length === 0) {
        await CachedTrack.deleteOne({ _id: cachedTrack._id });
        return NextResponse.json({ error: 'Song not found on PagalWorld or PagalNew' }, { status: 404 });
      }
      
      // Check the first PagalNew result
      let bestPNewInfo = null;
      let bestPNewDetails = null;
      let bestPNewMatch = null;

      if (finalPagalNewResults.length > 0) {
        const match = finalPagalNewResults[0];
        const details = await scrapePagalNewSongPage(match.url);
        if (details) {
          try {
            const info = await cachePagalNewSongAudio(details, videoId);
            bestPNewInfo = info;
            bestPNewDetails = details;
            bestPNewMatch = match;
          } catch (e) {}
        }
      }
      
      if (!bestPNewInfo || bestPNewInfo.size <= 1500000) {
        await CachedTrack.deleteOne({ _id: cachedTrack._id });
        return NextResponse.json({ error: 'Failed to scrape PagalNew song details or file too small' }, { status: 500 });
      }
      
      cachedTrack.status = 'ready';
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
      return NextResponse.json({ status: 'ready', audioUrl: cachedTrack.audioUrl, message: 'Song cached via PagalNew' });
    }
  } catch (error) { 
    console.error('Error in cache-track API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
