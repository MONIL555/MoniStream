// ============================================================
// MoniStream — Utility Functions
// ============================================================

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// ─── className Merger (shadcn pattern) ───────────────────────

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── Safe URI Decode ─────────────────────────────────────────

export function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return str;
  }
}

// ─── Duration Formatting ─────────────────────────────────────

/** Format seconds into "3:45" or "1:02:15" */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Format total duration for playlists: "2 hr 15 min" */
export function formatTotalDuration(seconds: number): string {
  if (!seconds) return '0 min';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hrs > 0 && mins > 0) return `${hrs} hr ${mins} min`;
  if (hrs > 0) return `${hrs} hr`;
  return `${mins} min`;
}

// ─── Avatar Color Generator ─────────────────────────────────

const AVATAR_COLORS = [
  '#1DB954', '#1ED760', '#E91429', '#F59B23',
  '#509BF5', '#AF2896', '#E13300', '#148A08',
  '#503750', '#8C67AB', '#BA5D07', '#056952',
  '#0D73EC', '#E8115B', '#8400E7', '#1E3264',
  '#E61E32', '#27856A', '#5179A1', '#A0C3D2',
];

export function generateAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Initials from Name ──────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ─── Truncate Text ───────────────────────────────────────────

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '…';
}

// ─── Pluralize ───────────────────────────────────────────────

export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  return count === 1 ? singular : (plural || `${singular}s`);
}

// ─── Relative Time ───────────────────────────────────────────

export function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHrs < 24) return `${diffHrs} ${pluralize(diffHrs, 'hour')} ago`;
  if (diffDays < 7) return `${diffDays} ${pluralize(diffDays, 'day')} ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} ${pluralize(weeks, 'week')} ago`;
  }
  
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

// ─── Debounce ────────────────────────────────────────────────

export function debounce<T extends (...args: Parameters<T>) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

// ─── Fisher-Yates Shuffle ────────────────────────────────────

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ─── Color Extraction (simple dominant color) ────────────────

export function extractDominantColor(imageUrl: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve('#1DB954');
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('#1DB954');
        return;
      }
      ctx.drawImage(img, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      resolve(`rgb(${r}, ${g}, ${b})`);
    };
    img.onerror = () => resolve('#1DB954');
    img.src = imageUrl;
  });
}
