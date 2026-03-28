const TOKEN_REGEX = /[\p{L}\p{N}]+/gu;

export function tokenizeForSequence(text: string): string[] {
  return text.toLowerCase().match(TOKEN_REGEX) ?? [];
}

export function tokenizeForIndex(text: string): string[] {
  const tokens = tokenizeForSequence(text);
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

export function normalizeLooseToken(token: string): string {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

export function normalizeSubject(subject: string): string {
  const tokens = tokenizeForIndex(subject);
  return tokens.join("-") || "unknown";
}
