import { parse } from 'node-html-parser';
import { storageAdmin } from './firebase-admin';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'https://pagalnew.com';

export interface PagalNewSearchResult {
  title: string;
  url: string;
  slug: string;
}

export interface PagalNewSongDetails {
  title: string;
  album: string;
  singers: string;
  releaseDate: string;
  coverUrl: string;
  downloadUrl128: string | null;
  downloadUrl320: string | null;
}

/**
 * Searches PagalNew for a query
 */
export async function searchPagalNew(query: string): Promise<PagalNewSearchResult[]> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const results: PagalNewSearchResult[] = [];

    // Fetch up to 3 pages to handle pagination
    for (let page = 1; page <= 3; page++) {
      const searchUrl = `${BASE_URL}/search.php?find=${encodedQuery}${page > 1 ? `&page_album=${page}` : ''}`;
      
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (!response.ok) {
        console.error(`PagalNew search failed: ${response.status} ${response.statusText}`);
        break; // Stop on error
      }

      const html = await response.text();
      const root = parse(html);
      let pageHasResults = false;

      const anchorTags = root.querySelectorAll('a');
      for (const a of anchorTags) {
        const href = a.getAttribute('href');
        if (href && href.includes('/songs/') && href.endsWith('.html')) {
          pageHasResults = true;
          const fullUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          const slug = href.split('/').pop()?.replace('.html', '') || '';
          
          const text = a.text.trim();
          
          if (!results.find(r => r.url === fullUrl)) {
            results.push({
              title: text.split('\n')[0].trim(),
              url: fullUrl,
              slug
            });
          }
        }
      }
      
      // If no valid song links on this page, assume we've reached the end
      if (!pageHasResults) break;
    }

    return results;
  } catch (error) {
    console.error('Error searching PagalNew:', error);
    return [];
  }
}

/**
 * Scrapes the download page for song details
 */
export async function scrapePagalNewSongPage(url: string): Promise<PagalNewSongDetails | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.error(`PagalNew page scrape failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const html = await response.text();
    const root = parse(html);

    // Extract title
    const titleEl = root.querySelector('h1');
    const title = titleEl ? titleEl.text.trim() : 'Unknown Title';

    // Extract metadata
    // Often in <b> tags
    let album = '';
    let singers = '';
    let releaseDate = '';

    const bTags = root.querySelectorAll('b');
    for (const b of bTags) {
      const bText = b.text.trim();
      if (bText.includes('Album:')) {
        const nextSibling = b.nextSibling;
        if (nextSibling && nextSibling.nodeType === 3) {
          album = nextSibling.text.trim();
        }
      } else if (bText.includes('Singer(s):') || bText.includes('Singer:')) {
        const nextSibling = b.nextSibling;
        if (nextSibling && nextSibling.nodeType === 3) {
          singers = nextSibling.text.trim();
        }
      }
    }

    // Extract cover
    const coverEl = root.querySelector('.img-thumbnail');
    let coverUrl = coverEl?.getAttribute('src') || '';
    if (coverUrl && !coverUrl.startsWith('http')) {
      coverUrl = `${BASE_URL}${coverUrl.startsWith('/') ? '' : '/'}${coverUrl}`;
    }

    // Extract download links
    let downloadUrl128 = null;
    let downloadUrl320 = null;
    
    const downloadBtns = root.querySelectorAll('a');
    for (const btn of downloadBtns) {
      const text = btn.text.toLowerCase();
      const href = btn.getAttribute('href');
      if (href) {
        const absoluteHref = href.startsWith('http') ? href : `${BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`;
        if (text.includes('128 kbps') || href.includes('128-downloads')) {
          downloadUrl128 = absoluteHref;
        } else if (text.includes('320 kbps') || href.includes('320-downloads')) {
          downloadUrl320 = absoluteHref;
        }
      }
    }

    // Resolve the actual MP3 direct URLs via 301 redirects
    if (downloadUrl128) downloadUrl128 = await resolveRedirect(downloadUrl128);
    if (downloadUrl320) downloadUrl320 = await resolveRedirect(downloadUrl320);

    return {
      title,
      album,
      singers,
      releaseDate,
      coverUrl,
      downloadUrl128,
      downloadUrl320
    };
  } catch (error) {
    console.error('Error scraping PagalNew page:', error);
    return null;
  }
}

async function resolveRedirect(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return location;
    } else if (res.status === 200) {
      return url; // It wasn't a redirect, it's the direct link
    }
  } catch (e) {
    console.error('Failed to resolve redirect:', e);
  }
  return url;
}

/**
 * Downloads the MP3 from PagalNew and uploads it to Firebase Storage.
 */
export async function cachePagalNewSongAudio(songDetails: PagalNewSongDetails, videoId: string) {
  let downloadUrl = songDetails.downloadUrl320 || songDetails.downloadUrl128;
  
  if (!downloadUrl) {
    throw new Error('No download URL found on PagalNew page');
  }

  // We will no longer upload to Firebase Storage to bypass costs.
  // Instead, we try to fetch just the headers to get the file size.
  // If Cloudflare blocks HEAD requests, we gracefully fallback to size 0.
  let sizeBytes = 0;
  try {
    const response = await fetch(downloadUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://pagalnew.com/'
      },
    });

    if (response.ok) {
      const contentLength = response.headers.get('content-length');
      sizeBytes = contentLength ? parseInt(contentLength, 10) : 0;
    }
  } catch (e) {
    console.warn(`[PagalNew] HEAD request failed, falling back to size 0 for ${downloadUrl}`);
  }
  
  // Return the raw MP3 URL to bypass proxy issues
  const bitrateStr = downloadUrl.includes('320') ? 320 : 128;

  return {
    url: downloadUrl,
    format: 'mp3',
    size: sizeBytes,
    bitrate: bitrateStr,
  };
}
