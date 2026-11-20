// ============================================================
// MoniStream — JioSaavn Direct API Integration
// ============================================================
// Calls JioSaavn's internal API directly with CryptoJS DES-ECB
// decryption. 100% self-contained, no external wrapper dependency.
// ============================================================

import CryptoJS from 'crypto-js';
import { Track } from '@/types';
import { formatDurationText } from './youtube';

const SAAVN_BASE = 'https://www.jiosaavn.com/api.php';
const DES_KEY_STRING = '38346591';

const SAAVN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Utility: Decrypt JioSaavn's encrypted media URL ─────────
export function decryptMediaUrl(encryptedUrl: string): string {
  if (!encryptedUrl) return '';
  try {
    const key = CryptoJS.enc.Utf8.parse(DES_KEY_STRING);
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encryptedUrl.trim()) } as any,
      key,
      {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
      }
    );
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result || '';
  } catch (err) {
    console.error('[JioSaavn] Decryption error:', err);
    return '';
  }
}

// ── Utility: Get stream URL in highest available quality ────
function getStreamUrl(song: any): string {
  if (song.encrypted_media_url) {
    const decrypted = decryptMediaUrl(song.encrypted_media_url);
    if (decrypted) {
      // Upgrade to 320kbps if available, else 160kbps
      if (song['320kbps'] === 'true' || song['320kbps'] === true) {
        return decrypted.replace('_96.mp4', '_320.mp4');
      }
      return decrypted.replace('_96.mp4', '_160.mp4');
    }
  }
  // Fallback to media preview URL (available on all JioSaavn songs)
  return song.media_preview_url || '';
}

// ── Utility: Decode HTML entities from JioSaavn responses ───
function decodeHTMLEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

// ── Utility: High quality album art ─────────────────────────
function getHighQualityImage(url: string): string {
  if (!url) return '';
  return url.replace(/150x150|50x50/, '500x500');
}

function getDefaultImage(url: string): string {
  if (!url) return '';
  return url.replace(/500x500|50x50/, '150x150');
}

// ── Map JioSaavn internal song to Track ─────────────────────
function mapSaavnSong(song: any): Track {
  const title = decodeHTMLEntities(song.song || song.title || '');
  const artist = decodeHTMLEntities(song.primary_artists || song.singers || song.music || 'Unknown Artist');
  const album = decodeHTMLEntities(song.album || '');
  const duration = parseInt(song.duration || '0', 10);
  const image = song.image || '';

  return {
    videoId: `saavn_${song.id}`,
    saavnId: song.id,
    source: 'jiosaavn',
    streamUrl: getStreamUrl(song),
    title,
    artist,
    channelId: song.albumid || 'unknown',
    channelTitle: artist,
    albumName: album,
    thumbnails: {
      default: getDefaultImage(image),
      high: getHighQualityImage(image),
    },
    duration,
    durationText: formatDurationText(duration),
    playCount: parseInt(song.play_count || '0', 10),
    likeCount: 0,
  };
}

// ── Search Songs ────────────────────────────────────────────
export async function searchSaavn(query: string, limit = 20): Promise<Track[]> {
  try {
    const params = new URLSearchParams({
      __call: 'search.getResults',
      _format: 'json',
      _marker: '0',
      cc: 'in',
      includeMetaTags: '0',
      p: '1',
      q: query,
      n: String(Math.min(limit, 30)),
    });

    const res = await fetch(`${SAAVN_BASE}?${params.toString()}`, {
      headers: SAAVN_HEADERS,
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      throw new Error(`JioSaavn API error: ${res.status}`);
    }

    const json = await res.json();
    const results = json?.results;

    if (!Array.isArray(results) || results.length === 0) {
      return [];
    }

    return results.slice(0, limit).map(mapSaavnSong);
  } catch (error) {
    console.error('[JioSaavn] Search error:', error);
    return [];
  }
}

// ── Get Song Details by ID ──────────────────────────────────
export async function getSaavnTrackDetails(saavnId: string): Promise<Track | null> {
  try {
    const cleanId = saavnId.replace(/^saavn_/, '');
    const params = new URLSearchParams({
      __call: 'song.getDetails',
      _format: 'json',
      _marker: '0',
      cc: 'in',
      pids: cleanId,
    });

    const res = await fetch(`${SAAVN_BASE}?${params.toString()}`, {
      headers: SAAVN_HEADERS,
      next: { revalidate: 86400 },
    });

    if (!res.ok) {
      throw new Error(`JioSaavn API error: ${res.status}`);
    }

    const json = await res.json();

    // Response format: { [id]: { ...songData } }
    const song = json[cleanId] || Object.values(json)[0];

    if (!song || !song.id) {
      return null;
    }

    return mapSaavnSong(song);
  } catch (error) {
    console.error('[JioSaavn] Song details error:', error);
    return null;
  }
}
