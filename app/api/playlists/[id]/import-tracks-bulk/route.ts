import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import { verifyAccessToken } from '@/lib/auth';
import Playlist from '@/models/Playlist';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('access_token')?.value || req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const jwtUser = verifyAccessToken(token);

    const body = await req.json();
    const { tracks } = body;

    if (!Array.isArray(tracks)) {
      return NextResponse.json({ error: 'Tracks array is required' }, { status: 400 });
    }

    const resolvedParams = await params;

    await connectDB();

    const playlist = await Playlist.findOne({
      _id: resolvedParams.id,
      $or: [{ userId: jwtUser.userId }, { collaborators: jwtUser.userId }]
    });
    
    if (!playlist) {
      return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });
    }

    let addedCount = 0;

    for (const track of tracks) {
      // Check if track already exists by videoId
      const exists = playlist.tracks.some((t: any) => t.videoId === track.videoId);
      if (!exists) {
        playlist.tracks.push(track);
        addedCount++;
      }
    }

    await playlist.save();

    return NextResponse.json({ success: true, addedCount });
  } catch (error: any) {
    console.error('Import Tracks Bulk Error:', error);
    return NextResponse.json({ error: 'Failed to import tracks bulk' }, { status: 500 });
  }
}
