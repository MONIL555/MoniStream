import { NextRequest, NextResponse } from 'next/server';
import { searchYouTube } from '@/lib/youtube';
import { Track } from '@/types';
import { apiLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const { title, artist } = await req.json();

    if (!title || !artist) {
      return NextResponse.json({ error: 'Title and artist are required' }, { status: 400 });
    }

    const cleanTitle = title
      .replace(/\(.*?(Lyrical|Official|Video|Audio).*?\)/gi, '')
      .replace(/\[.*?(Lyrical|Official|Video|Audio).*?\]/gi, '').trim();
    const mainArtist = artist.split(',')[0].trim();
    
    const query = `${cleanTitle} ${mainArtist}`.trim();
    
    const searchRes = await searchYouTube(query, 1);
    
    if (!searchRes.items || searchRes.items.length === 0) {
      return NextResponse.json({ error: 'Not found on YouTube' }, { status: 404 });
    }
    
    const ytItem = searchRes.items[0];
    
    const resolvedTrack: Track = {
      videoId: ytItem.videoId,
      title: ytItem.title,
      artist: mainArtist,
      source: 'youtube',
      channelId: ytItem.channelId,
      channelTitle: ytItem.channelName,
      thumbnails: {
        default: ytItem.thumbnail,
        high: ytItem.thumbnail,
      },
      duration: 0,
      durationText: '',
      playCount: 0,
      likeCount: 0,
    };
    
    return NextResponse.json({ success: true, track: resolvedTrack });
  } catch (error: any) {
    console.error('Resolve YouTube Error:', error);
    return NextResponse.json({ error: 'Failed to resolve YouTube track' }, { status: 500 });
  }
}
