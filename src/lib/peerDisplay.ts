/** Shared display helpers for peers, used by every peer list surface. */

/** "Naruto-Luffy" -> "NL", "Pixel 8" -> "P8", "Zed" -> "ZE". */
export function monogram(alias: string): string {
  const words = alias.split(/[\s\-_]+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
