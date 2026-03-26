export function tokenizeForIndex(text: string): string[] {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    deduped.push(token);
  }

  return deduped;
}

export function normalizeSubject(subject: string): string {
  const tokens = tokenizeForIndex(subject);
  return tokens.join("-") || "unknown";
}
