import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyAccessToken } from '@/lib/auth';
import { apiLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';
import CachedTrack from '@/models/CachedTrack';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const jwtUser = verifyAccessToken(token);

    const { title, artist } = await req.json();

    if (!title || !artist) {
      return NextResponse.json({ error: 'Title and artist are required' }, { status: 400 });
    }

    await connectDB();

    const videoId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const newTrack = new CachedTrack({
      videoId,
      title,
      artist,
      cachedBy: jwtUser.userId,
      status: 'admin_request',
      source: 'admin_manual',
    });

    await newTrack.save();

    // Return a track object suitable for adding to a playlist
    const trackObj = {
      videoId,
      title,
      artist,
      source: 'admin_manual',
      thumbnails: { default: '', high: '' },
      duration: 0,
      durationText: '',
      playCount: 0,
      likeCount: 0,
    };

    return NextResponse.json({ success: true, track: trackObj });
  } catch (error: any) {
    console.error('Request Admin Error:', error);
    return NextResponse.json({ error: 'Failed to request admin' }, { status: 500 });
  }
}
