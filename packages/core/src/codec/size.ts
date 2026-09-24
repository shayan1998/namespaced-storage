/** Approximate stored size. Browsers count UTF-16 code units against the quota. */
export function approximateBytes(raw: string): number {
  return raw.length * 2;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
