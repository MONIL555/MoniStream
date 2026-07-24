import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyAccessToken } from '@/lib/auth';
import { apiLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';
import Playlist from '@/models/Playlist';
import CachedTrack from '@/models/CachedTrack';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const jwtUser = verifyAccessToken(token);

    const resolvedParams = await params;

    await connectDB();

    const playlist = await Playlist.findOne({
      _id: resolvedParams.id,
      $or: [{ userId: jwtUser.userId }, { collaborators: jwtUser.userId }]
    }).lean();
    
    if (!playlist) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    // Enrich tracks with dynamic data from CachedTrack
    const cachedTrackIds = playlist.tracks
      .filter((t: any) => t.source === 'admin_manual' || t.source?.includes('_cached'))
      .map((t: any) => t.videoId);

    if (cachedTrackIds.length > 0) {
      const cachedData = await CachedTrack.find({ videoId: { $in: cachedTrackIds } }).lean();
      const cacheMap = new Map(cachedData.map((c: any) => [c.videoId, c]));

      playlist.tracks = playlist.tracks.map((t: any) => {
        const cacheInfo = cacheMap.get(t.videoId);
        if (cacheInfo) {
          // If the admin manually uploaded/resolved it, it will have status 'ready'
          if (cacheInfo.status === 'ready' && t.source === 'admin_manual') {
            return {
              ...t,
              source: cacheInfo.source || 'admin_manual_resolved',
              audioUrl: cacheInfo.audioUrl,
              // Remove the 'req_' prefix check issue if any by marking it resolved
            };
          }
        }
        return t;
      });
    }

    return NextResponse.json(playlist);
  } catch (error: any) {
    console.error('Playlist GET Error:', error);
    return NextResponse.json({ error: 'Failed to get playlist' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const jwtUser = verifyAccessToken(token);

    const body = await req.json();
    const { track, action } = body;

    if (!track || !track.videoId) return NextResponse.json({ error: 'Valid track is required' }, { status: 400 });

    const resolvedParams = await params;

    await connectDB();

    const playlist = await Playlist.findOne({
      _id: resolvedParams.id,
      $or: [{ userId: jwtUser.userId }, { collaborators: jwtUser.userId }]
    });
    
    if (!playlist) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    if (action === 'remove') {
      playlist.tracks = playlist.tracks.filter((t: any) => t.videoId !== track.videoId);
      await playlist.save();
      return NextResponse.json(playlist);
    }

    // Add track to playlist if it's not already there
    const trackExists = playlist.tracks.some((t: any) => t.videoId === track.videoId);
    if (!trackExists) {
      playlist.tracks.push(track);
      await playlist.save();
    }

    return NextResponse.json(playlist);
  } catch (error: any) {
    console.error('Playlist PUT Error:', error);
    return NextResponse.json({ error: 'Failed to update playlist' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const jwtUser = verifyAccessToken(token);

    const resolvedParams = await params;

    await connectDB();

    const result = await Playlist.deleteOne({ _id: resolvedParams.id, userId: jwtUser.userId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Playlist not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Playlist DELETE Error:', error);
    return NextResponse.json({ error: 'Failed to delete playlist' }, { status: 500 });
  }
}
