const TUNNEL_URL_PATTERN = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

export function extractTunnelUrl(text: string): string | null {
  return text.match(TUNNEL_URL_PATTERN)?.[0] ?? null;
}

export function upsertEnvVars(content: string, vars: Record<string, string>): string {
  const lines = content === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/);
  const remaining = new Map(Object.entries(vars));
  const updated = lines.map((line) => {
    const separator = line.indexOf('=');
    if (separator === -1) return line;
    const key = line.slice(0, separator);
    const value = remaining.get(key);
    if (value === undefined) return line;
    remaining.delete(key);
    return `${key}=${value}`;
  });
  for (const [key, value] of remaining) updated.push(`${key}=${value}`);
  return `${updated.join('\n')}\n`;
}
