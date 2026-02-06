export type FuzzyHit<T> = { item: T; score: number };

export function fuzzyScore(query: string, text: string): number {
  // Simple subsequence scoring: higher is better, -1 if no match
  // Bonus for contiguous matches and early matches.
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;

  let qi = 0;
  let score = 0;
  let streak = 0;
  let firstMatch = -1;

  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (firstMatch === -1) firstMatch = i;
      qi++;
      streak++;
      score += 10 + streak * 5; // contiguous bonus
    } else {
      streak = 0;
      score -= 1;
    }
  }
  if (qi < q.length) return -1;
  // Prefer earlier matches:
  score += Math.max(0, 50 - (firstMatch === -1 ? 50 : firstMatch));
  return score;
}

export function fuzzyFind<T>(
  query: string,
  items: T[],
  toText: (t: T) => string,
  limit = 20,
): FuzzyHit<T>[] {
  const hits: FuzzyHit<T>[] = [];
  for (const it of items) {
    const s = fuzzyScore(query, toText(it));
    if (s >= 0) hits.push({ item: it, score: s });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
