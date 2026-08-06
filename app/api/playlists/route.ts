import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyAccessToken } from '@/lib/auth';
import { apiLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';
import Playlist from '@/models/Playlist';

export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    let jwtUser;
    try {
      jwtUser = verifyAccessToken(token);
    } catch {
      return NextResponse.json({ error: 'Token expired or invalid' }, { status: 401 });
    }

    await connectDB();
    
    // Handle admin string ID differently to prevent Mongoose CastError
    const query = jwtUser.userId === 'admin' 
      ? { userId: null } // Admins shouldn't have normal playlists, or we can use a special ID. For now return empty or allow creation.
      : { userId: jwtUser.userId };

    const playlists = await Playlist.find(query).sort({ createdAt: -1 }).lean();

    const res = NextResponse.json(playlists);
    res.headers.set('Cache-Control', 'private, s-maxage=60, stale-while-revalidate=120');
    return res;
  } catch (error: any) {
    console.error('Playlists GET Error:', error);
    return NextResponse.json({ error: 'Failed to get playlists' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await checkRateLimit(apiLimiter, ip);

    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    let jwtUser;
    try {
      jwtUser = verifyAccessToken(token);
    } catch {
      return NextResponse.json({ error: 'Token expired or invalid' }, { status: 401 });
    }

    const body = await req.json();
    const { name } = body;

    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    await connectDB();

    const playlist = await Playlist.create({
      userId: jwtUser.userId,
      name,
      tracks: [],
    });

    return NextResponse.json(playlist);
  } catch (error: any) {
    console.error('Playlists POST Error:', error);
    return NextResponse.json({ error: 'Failed to create playlist' }, { status: 500 });
  }
}
