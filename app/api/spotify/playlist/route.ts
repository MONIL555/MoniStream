import { NextRequest, NextResponse } from 'next/server';
const spotifyUrlInfo = require('spotify-url-info');

// Initialize with global fetch
const { getTracks } = spotifyUrlInfo(fetch);

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || !url.includes('spotify.com')) {
      return NextResponse.json({ error: 'Invalid Spotify URL' }, { status: 400 });
    }

    // Try to fetch tracks
    const tracks = await getTracks(url);
    
    if (!tracks || tracks.length === 0) {
      return NextResponse.json({ error: 'No tracks found or invalid playlist' }, { status: 404 });
    }

    // Map to a simpler format
    const formattedTracks = tracks.map((track: any) => ({
      title: track.name,
      artist: track.artist || 'Unknown Artist',
      id: track.uri,
      duration: track.duration ? Math.floor(track.duration / 1000) : 0,
    }));

    return NextResponse.json({ tracks: formattedTracks });
  } catch (error: any) {
    console.error('Spotify API Error:', error);
    return NextResponse.json({ error: 'Failed to fetch Spotify playlist. Is the playlist public?' }, { status: 500 });
  }
}
