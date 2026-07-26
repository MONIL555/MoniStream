// ─── Levenshtein Distance ────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row DP for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

// Fuzzy match: exact OR Levenshtein ≤ 1 (only for words ≥ 4 chars to avoid noise)
function fuzzyWordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 1) {
    return levenshtein(a, b) <= 1;
  }
  return false;
}

// ─── Normalization ───────────────────────────────────────────
export function normalize(s: string): string {
  if (!s) return '';
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\(.*?(lyrical|official|video|audio|full song|hd|unplugged|reprise|acoustic|jhankar|remix).*?\)/gi, '')
    .replace(/\[.*?(lyrical|official|video|audio|full song|hd|unplugged|reprise|acoustic|jhankar|remix).*?\]/gi, '')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function getWords(s: string): string[] {
  return normalize(s).split(' ').filter((w: string) => w.length > 2);
}

// Also export a version that keeps short words (for exact-title comparison)
function getAllWords(s: string): string[] {
  return normalize(s).split(' ').filter((w: string) => w.length > 0);
}

// ─── Title Scoring ───────────────────────────────────────────
export function titleScore(query: string, candidate: string): number {
  const normQ = normalize(query);
  const normC = normalize(candidate);

  // Perfect match
  if (normQ === normC) return 1.0;

  // Candidate starts with query (strong signal)
  const startsWithBonus = normC.startsWith(normQ) ? 0.1 : 0;
  
  // Severe penalty for unwanted versions if not explicitly requested
  let versionPenalty = 0;
  const unwantedVersions = ['jhankar', 'remix', 'lofi', 'cover', 'live', 'mashup', 'unplugged', 'reprise', 'acoustic', 'slowed', 'reverb'];
  const qLower = query.toLowerCase();
  const cLower = candidate.toLowerCase();
  for (const v of unwantedVersions) {
    if (cLower.includes(v) && !qLower.includes(v)) {
      versionPenalty += 0.5; // Massive penalty for returning a Jhankar/Remix when not asked
    }
  }

  const qWords = getWords(query);
  const cWords = getWords(candidate);
  if (qWords.length === 0) return 0;

  // Strict word matching (exact + Levenshtein fuzzy for typos)
  let matched = 0;
  for (const qw of qWords) {
    if (cWords.some((cw: string) => fuzzyWordMatch(qw, cw))) {
      matched++;
    }
  }

  const overlap = matched / qWords.length;

  // Word-order bonus: check how many leading query words appear in sequence in candidate
  let orderBonus = 0;
  if (qWords.length >= 2 && cWords.length >= 2) {
    let seqMatched = 0;
    let cIdx = 0;
    for (const qw of qWords) {
      while (cIdx < cWords.length) {
        if (fuzzyWordMatch(qw, cWords[cIdx])) {
          seqMatched++;
          cIdx++;
          break;
        }
        cIdx++;
      }
    }
    if (seqMatched >= 2) {
      orderBonus = (seqMatched / qWords.length) * 0.1;
    }
  }

  // Penalise candidates with many extra words (likely a different song with same keyword)
  const extraPenalty = cWords.length > qWords.length * 2.5 ? 0.15 : 0;

  return Math.min(1.0, Math.max(0, overlap - extraPenalty - versionPenalty + startsWithBonus + orderBonus));
}

// ─── Artist Scoring ──────────────────────────────────────────
export function artistScore(queryArtist: string, candidateArtist: string): number {
  const qWords = getWords(queryArtist);
  const cWords = getWords(candidateArtist);
  if (qWords.length === 0 || cWords.length === 0) return 0.5;

  let matched = 0;
  for (const qw of qWords) {
    if (cWords.some((cw: string) => fuzzyWordMatch(qw, cw))) {
      matched++;
    }
  }
  return matched > 0 ? Math.min(1.0, matched / Math.min(qWords.length, 3)) : 0;
}

// ─── Duration Scoring ────────────────────────────────────────
export function durationScore(expected: number, actual: number): number {
  if (expected <= 0 || actual <= 0) return 0.5;
  const diff = Math.abs(expected - actual);
  const tolerance = expected * 0.20;
  if (diff <= 5) return 1.0;
  if (diff > tolerance) return 0.0;
  return 1.0 - (diff / tolerance);
}

// ─── Composite Score ─────────────────────────────────────────
export function compositeScore(
  queryTitle: string, queryArtist: string, expectedDuration: number,
  candidateTitle: string, candidateArtist: string, candidateDuration: number
): number {
  const ts = titleScore(queryTitle, candidateTitle);
  const as = artistScore(queryArtist, candidateArtist);
  const ds = durationScore(expectedDuration, candidateDuration);
  
  let score = (ts * 0.45) + (ds * 0.35) + (as * 0.20);
  
  // Heavily penalise if a specific artist was queried but the candidate artist doesn't match at all
  if (getWords(queryArtist).length > 0 && getWords(candidateArtist).length > 0 && as === 0) {
    score *= 0.6; // Cut score heavily to avoid caching random covers or wrong songs
  }
  
  return score;
}
