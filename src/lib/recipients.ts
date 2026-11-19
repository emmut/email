// Tokenize recipient fields without treating commas in quoted names or comments
// as separators. Keep empty tokens so autocomplete can identify the active entry
// after a trailing comma. Providers remain responsible for address validation.
export function splitAddressList(raw: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let commentDepth = 0;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (escaped) {
      escaped = false;
    } else if (char === "\\" && (quoted || commentDepth > 0)) {
      escaped = true;
    } else if (commentDepth > 0) {
      if (char === "(") commentDepth++;
      else if (char === ")") commentDepth--;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted) {
      if (char === "(") commentDepth++;
      else if (char === ",") {
        entries.push(raw.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  entries.push(raw.slice(start).trim());
  return entries;
}

// Compare recipient identity independently of display names and address casing.
export function recipientEmail(raw: string): string {
  const angled = raw.match(/<([^>]*)>/);
  return (angled ? angled[1] : raw).trim().toLowerCase();
}
