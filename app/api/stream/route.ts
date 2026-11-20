import { NextRequest, NextResponse } from 'next/server';
import { getSaavnTrackDetails } from '@/lib/jiosaavn';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id') || searchParams.get('videoId');

    if (!id) {
      return NextResponse.json({ error: 'Missing track id or videoId parameter' }, { status: 400 });
    }

    const cleanId = id.replace(/^saavn_/, '');
    const track = await getSaavnTrackDetails(cleanId);

    if (track && track.streamUrl) {
      return NextResponse.json(
        { streamUrl: track.streamUrl, source: 'jiosaavn' },
        { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' } }
      );
    }

    // Check CachedTrack collection
    try {
      const connectDB = (await import('@/lib/mongodb')).default;
      await connectDB();
      const CachedTrack = (await import('@/models/CachedTrack')).default;
      const cached = await CachedTrack.findOne({ videoId: id, status: 'ready' }).lean();
      if (cached && cached.audioUrl) {
        return NextResponse.json(
          { streamUrl: cached.audioUrl, source: 'pagalworld_cached' },
          { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' } }
        );
      }
    } catch (e) {
      console.warn('Error checking CachedTrack:', e);
    }

    return NextResponse.json({ error: 'Stream not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Stream API Error:', error);
    return NextResponse.json(
      { error: 'An error occurred while fetching the stream URL.' },
      { status: 500 }
    );
  }
}
