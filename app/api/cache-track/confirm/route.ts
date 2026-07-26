import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import CachedTrack from '@/models/CachedTrack';

/**
 * POST /api/cache-track/confirm
 * 
 * Confirms a speculative cache record (flips status from 'speculative' → 'ready').
 * Called by the frontend after the user has listened for 30+ seconds,
 * proving they actually want this song cached.
 */
export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId' }, { status: 400 });
    }

    await connectDB();

    const track = await CachedTrack.findOne({ videoId });

    if (!track) {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }

    if (track.status === 'ready') {
      // Already confirmed (e.g., by a non-speculative request or double-confirm)
      return NextResponse.json({ status: 'ready', audioUrl: track.audioUrl });
    }

    if (track.status === 'speculative') {
      track.status = 'ready';
      await track.save();
      console.log(`[Cache Track] ✅ Confirmed speculative cache for "${track.title}" (${videoId})`);
      return NextResponse.json({ status: 'ready', audioUrl: track.audioUrl });
    }

    // Status is processing/failed/pending — can't confirm yet
    return NextResponse.json({ status: track.status });
  } catch (error) {
    console.error('Error in cache-track confirm API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
