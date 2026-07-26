// ============================================================
// MoniStream — YouTube Data API v3 Wrapper (Server-side only)
// ============================================================

const YT_API_KEY = process.env.YOUTUBE_API_KEY!;
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

// ─── Types ───────────────────────────────────────────────────

export interface YTSearchItem {
  videoId: string;
  type?: string;
  title: string;
  channelId: string;
  channelName: string;
  thumbnail: string;
  publishedAt: string;
}

export interface YTSearchResponse {
  items: YTSearchItem[];
  nextPageToken?: string;
  totalResults?: number;
}

export interface YTVideoDetails {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  description: string;
  thumbnail: string;
  thumbnails: {
    default?: string;
    medium?: string;
    high?: string;
    maxres?: string;
  };
  duration: number;
  durationText: string;
  publishedAt: string;
  tags: string[];
  viewCount: number;
  likeCount: number;
}

// ─── Search YouTube ──────────────────────────────────────────

export async function searchYouTube(
  query: string,
  maxResults = 20,
  pageToken?: string,
  type = 'video'
): Promise<YTSearchResponse> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: type === 'video' ? `${query} official audio` : query,
    type: type === 'all' ? 'video,playlist,channel' : type,
    ...(type === 'video' ? { videoCategoryId: '10', videoEmbeddable: 'true' } : {}),
    maxResults: String(maxResults),
    key: YT_API_KEY,
    ...(pageToken ? { pageToken } : {}),
  });

  const res = await fetch(`${YT_BASE}/search?${params}`, {
    next: { revalidate: 3600 }, // Cache 1 hour
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(
      `YouTube API error: ${res.status} - ${JSON.stringify(error)}`
    );
  }

  const data = await res.json();

  return {
    items: data.items
      ?.filter(
        (item: Record<string, Record<string, string>>) => item.id?.videoId || item.id?.playlistId || item.id?.channelId
      )
      .map((item: Record<string, Record<string, unknown>>) => ({
        videoId: (item.id as Record<string, string>).videoId || (item.id as Record<string, string>).playlistId || (item.id as Record<string, string>).channelId,
        type: (item.id as Record<string, string>).kind?.replace('youtube#', '') || 'video',
        title: cleanYouTubeTitle(decodeHTMLEntities(
          (item.snippet as Record<string, string>).title
        )),
        channelId: (item.snippet as Record<string, string>).channelId,
        channelName: cleanYouTubeArtist((item.snippet as Record<string, string>).channelTitle),
        thumbnail:
          ((item.snippet as Record<string, Record<string, Record<string, string>>>).thumbnails?.high
            ?.url) ||
          ((item.snippet as Record<string, Record<string, Record<string, string>>>).thumbnails
            ?.default?.url) ||
          '',
        publishedAt: (item.snippet as Record<string, string>).publishedAt,
      })) || [],
    nextPageToken: data.nextPageToken,
    totalResults: data.pageInfo?.totalResults,
  };
}

// ─── Get Related Videos ──────────────────────────────────────

export async function getRelatedVideos(
  videoId: string,
  maxResults = 20
): Promise<YTSearchResponse> {
  const params = new URLSearchParams({
    part: 'snippet',
    relatedToVideoId: videoId,
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    maxResults: String(maxResults),
    key: YT_API_KEY,
  });

  const res = await fetch(`${YT_BASE}/search?${params}`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`YouTube API error: ${res.status} - ${JSON.stringify(error)}`);
  }

  const data = await res.json();

  return {
    items: data.items
      ?.filter((item: any) => item.id?.videoId)
      .map((item: any) => ({
        videoId: item.id.videoId,
        title: cleanYouTubeTitle(decodeHTMLEntities(item.snippet.title)),
        channelId: item.snippet.channelId,
        channelName: cleanYouTubeArtist(item.snippet.channelTitle),
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '',
        publishedAt: item.snippet.publishedAt,
      })) || [],
  };
}

// ─── Get Video Details ───────────────────────────────────────

export async function getVideoDetails(
  videoIds: string[]
): Promise<YTVideoDetails[]> {
  if (videoIds.length === 0) return [];

  const params = new URLSearchParams({
    part: 'snippet,contentDetails,statistics',
    id: videoIds.join(','),
    key: YT_API_KEY,
  });

  const res = await fetch(`${YT_BASE}/videos?${params}`, {
    next: { revalidate: 86400 }, // Cache 24 hours
  });

  if (!res.ok) {
    throw new Error(`YouTube API error: ${res.status}`);
  }

  const data = await res.json();

  return (
    data.items?.map(
      (item: Record<string, Record<string, unknown>>) => {
        const snippet = item.snippet as Record<string, unknown>;
        const contentDetails = item.contentDetails as Record<string, string>;
        const statistics = item.statistics as Record<string, string>;
        const thumbnails = snippet.thumbnails as Record<
          string,
          Record<string, string>
        >;
        const duration = parseDuration(contentDetails.duration);

        return {
          videoId: item.id as unknown as string,
          title: cleanYouTubeTitle(decodeHTMLEntities(snippet.title as string)),
          channelId: snippet.channelId as string,
          channelTitle: cleanYouTubeArtist(snippet.channelTitle as string),
          description: snippet.description as string,
          thumbnail: thumbnails?.high?.url || thumbnails?.default?.url || '',
          thumbnails: {
            default: thumbnails?.default?.url,
            medium: thumbnails?.medium?.url,
            high: thumbnails?.high?.url,
            maxres: thumbnails?.maxres?.url,
          },
          duration,
          durationText: formatDurationText(duration),
          publishedAt: snippet.publishedAt as string,
          tags: (snippet.tags as string[]) || [],
          viewCount: parseInt(statistics.viewCount || '0', 10),
          likeCount: parseInt(statistics.likeCount || '0', 10),
        };
      }
    ) || []
  );
}

// ─── Get Channel Details ─────────────────────────────────────

export async function getChannelDetails(channelId: string) {
  const params = new URLSearchParams({
    part: 'snippet,statistics,brandingSettings',
    id: channelId,
    key: YT_API_KEY,
  });

  const res = await fetch(`${YT_BASE}/channels?${params}`, {
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    throw new Error(`YouTube API error: ${res.status}`);
  }

  const data = await res.json();
  const channel = data.items?.[0];

  if (!channel) return null;

  return {
    channelId: channel.id,
    name: channel.snippet.title,
    description: channel.snippet.description,
    thumbnailUrl:
      channel.snippet.thumbnails?.high?.url ||
      channel.snippet.thumbnails?.default?.url,
    bannerUrl:
      channel.brandingSettings?.image?.bannerExternalUrl || null,
    subscriberCount: parseInt(
      channel.statistics.subscriberCount || '0',
      10
    ),
    videoCount: parseInt(channel.statistics.videoCount || '0', 10),
  };
}

// ─── Get Channel Playlists (Albums) ──────────────────────────

export async function getChannelPlaylists(
  channelId: string,
  maxResults = 20
) {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    channelId,
    maxResults: String(maxResults),
    key: YT_API_KEY,
  });

  const res = await fetch(`${YT_BASE}/playlists?${params}`, {
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    throw new Error(`YouTube API error: ${res.status}`);
  }

  return res.json();
}

// ─── Utility: Parse ISO 8601 Duration ────────────────────────

export function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2] || 0) * 60 +
    Number(match[3] || 0)
  );
}

// ─── Utility: Format Duration as "3:45" ─────────────────────

export function formatDurationText(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ─── Utility: Decode HTML Entities ───────────────────────────

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

export function cleanYouTubeArtist(name: string): string {
  return name.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim();
}

export function cleanYouTubeTitle(title: string): string {
  return title
    .replace(/\(.*?(official|lyrical|video|audio|full song).*?\)/gi, '')
    .replace(/\[.*?(official|lyrical|video|audio|full song).*?\]/gi, '')
    .trim();
}

// ─── Get Playlist Details ──────────────────────────────────────

export async function getPlaylistDetails(playlistId: string) {
  const params = new URLSearchParams({
    part: 'snippet',
    id: playlistId,
    key: YT_API_KEY,
  });

  const res = await fetch(`${YT_BASE}/playlists?${params}`, {
    next: { revalidate: 86400 },
  });

  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);

  const data = await res.json();
  const playlist = data.items?.[0];
  
  if (!playlist) return null;

  return {
    id: playlist.id,
    title: playlist.snippet.title,
    description: playlist.snippet.description,
    channelId: playlist.snippet.channelId,
    channelTitle: playlist.snippet.channelTitle,
    thumbnailUrl: playlist.snippet.thumbnails?.high?.url || playlist.snippet.thumbnails?.default?.url,
    publishedAt: playlist.snippet.publishedAt,
  };
}

// ─── Get Playlist Items ────────────────────────────────────────

export async function getPlaylistItems(playlistId: string, maxResults = 50) {
  const params = new URLSearchParams({
    part: 'snippet,contentDetails',
    playlistId,
    maxResults: String(maxResults),
    key: YT_API_KEY,
  });

  const res = await fetch(`${YT_BASE}/playlistItems?${params}`, {
    next: { revalidate: 86400 },
  });

  if (!res.ok) throw new Error(`YouTube API error: ${res.status}`);

  const data = await res.json();
  
  return data.items
    ?.filter((item: any) => item.contentDetails?.videoId)
    .map((item: any) => ({
      videoId: item.contentDetails.videoId,
      title: cleanYouTubeTitle(decodeHTMLEntities(item.snippet.title)),
      channelId: item.snippet.videoOwnerChannelId,
      channelTitle: cleanYouTubeArtist(item.snippet.videoOwnerChannelTitle || ''),
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
      position: item.snippet.position,
      publishedAt: item.contentDetails.videoPublishedAt,
    })) || [];
}
