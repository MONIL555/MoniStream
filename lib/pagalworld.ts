import { parse } from 'node-html-parser';

export interface PagalWorldSearchResult {
  title: string;
  url: string; // The URL to the song detail page
  coverUrl: string;
  slug: string;
}

export interface PagalWorldSongDetails {
  title: string;
  album: string;
  singers: string;
  releaseDate: string;
  coverUrl: string;
  downloadUrl128: string | null;
  downloadUrl320: string | null;
}

const BASE_URL = 'https://pagalworld.is';

/**
 * Search PagalWorld for a given query (e.g., "Song Name Artist")
 */
export async function searchPagalWorld(query: string): Promise<PagalWorldSearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/search/?s=${encodedQuery}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      console.error(`PagalWorld search failed with status ${response.status}`);
      return [];
    }

    const html = await response.text();
    const root = parse(html);
    const results: PagalWorldSearchResult[] = [];

    const songCards = root.querySelectorAll('.song-card');
    
    for (const card of songCards) {
      const linkEl = card.querySelector('a');
      const imgEl = card.querySelector('.image-thumb');
      const titleEl = card.querySelector('.nw');

      if (linkEl && imgEl && titleEl) {
        const url = linkEl.getAttribute('href') || '';
        // PagalWorld uses lazy loading, actual image URL is in data-src
        let coverUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '';
        const title = titleEl.text.trim();
        
        // Extract slug from URL (e.g. https://pagalworld.is/song/tera-ban-jaunga-mp3-download/ -> tera-ban-jaunga-mp3-download)
        const slugMatch = url.match(/\/song\/([^\/]+)\/?$/);
        const slug = slugMatch ? slugMatch[1] : '';

        // If coverUrl starts with /, prepend BASE_URL
        if (coverUrl.startsWith('/')) {
            coverUrl = BASE_URL + coverUrl;
        }

        if (url && title && slug) {
          results.push({ title, url, coverUrl, slug });
        }
      }
    }

    return results;
  } catch (error) {
    console.error('Error in searchPagalWorld:', error);
    return [];
  }
}

/**
 * Scrape a PagalWorld song page for metadata and MP3 download URLs
 */
export async function scrapeSongPage(songUrl: string): Promise<PagalWorldSongDetails | null> {
  try {
    const response = await fetch(songUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      console.error(`PagalWorld song page fetch failed with status ${response.status}`);
      return null;
    }

    const html = await response.text();
    const root = parse(html);

    // Extract title (usually in .b.bk.xl class)
    const titleEl = root.querySelector('.xl.b.bk');
    let title = titleEl ? titleEl.text.trim() : '';
    
    // If we can't find title that way, try h1
    if (!title) {
        const h1 = root.querySelector('h1.heading');
        if (h1) {
            title = h1.text.replace(/Song Download/i, '').trim();
        }
    }

    // Extract cover image
    const imgEl = root.querySelector('.imgs');
    let coverUrl = imgEl ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '') : '';
    if (coverUrl.startsWith('/')) {
        coverUrl = BASE_URL + coverUrl;
    }

    // Extract metadata from table
    let album = '';
    let singers = '';
    let releaseDate = '';

    const trs = root.querySelectorAll('tr.tr');
    for (const tr of trs) {
      const tdLabel = tr.querySelector('.td');
      if (!tdLabel) continue;
      
      const labelText = tdLabel.text.trim().toLowerCase();
      const tdValue = tr.querySelectorAll('td')[1];
      
      if (!tdValue) continue;
      
      if (labelText.includes('album')) {
        album = tdValue.text.trim();
      } else if (labelText.includes('singer')) {
        singers = tdValue.text.trim();
      } else if (labelText.includes('release on')) {
        releaseDate = tdValue.text.trim();
      }
    }

    // Extract download links
    let downloadUrl128 = null;
    let downloadUrl320 = null;

    const downloadBtns = root.querySelectorAll('a.dbutton');
    for (const btn of downloadBtns) {
      const titleAttr = btn.getAttribute('title') || '';
      const dataYear = btn.getAttribute('data-year');
      const dataMonth = btn.getAttribute('data-month');
      const dataFile = btn.getAttribute('data-file');

      let finalHref = '';
      if (dataYear && dataMonth && dataFile) {
        finalHref = encodeURI(`${BASE_URL}/wp-content/uploads/${dataYear}/${dataMonth}/${dataFile}`);
      } else {
        const href = btn.getAttribute('href') || '';
        if (!href) continue;
        finalHref = encodeURI(href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`);
      }

      if (titleAttr.includes('128')) {
        downloadUrl128 = finalHref;
      } else if (titleAttr.includes('320')) {
        downloadUrl320 = finalHref;
      }
    }

    return {
      title,
      album,
      singers,
      releaseDate,
      coverUrl,
      downloadUrl128,
      downloadUrl320,
    };
  } catch (error) {
    console.error('Error in scrapeSongPage:', error);
    return null;
  }
}

import { storageAdmin } from '@/lib/firebase-admin';

/**
 * Download MP3 and upload to Firebase Storage
 */
export async function cacheSongAudio(
  songDetails: PagalWorldSongDetails,
  videoId: string
): Promise<{ url: string; size: number; bitrate: number; format: string }> {
  // Prefer 320kbps, fallback to 128kbps
  const downloadUrl = songDetails.downloadUrl320 || songDetails.downloadUrl128;
  const bitrate = songDetails.downloadUrl320 ? 320 : 128;
  
  if (!downloadUrl) {
    throw new Error('No download URL found on PagalWorld');
  }

  // We will no longer upload to Firebase Storage to bypass costs.
  // Instead, we try to fetch just the headers to get the file size.
  // If Cloudflare blocks HEAD requests, we gracefully fallback to size 0.
  let size = 0;
  try {
    const response = await fetch(downloadUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (response.ok) {
      const contentLength = response.headers.get('content-length');
      size = contentLength ? parseInt(contentLength, 10) : 0;
    }
  } catch (e) {
    console.warn(`[PagalWorld] HEAD request failed, falling back to size 0 for ${downloadUrl}`);
  }
  // Use the raw downloadUrl directly to bypass proxy issues
  // The browser will stream the audio natively without CORS issues
  return {
    url: downloadUrl,
    size,
    bitrate,
    format: 'mp3',
  };
}

