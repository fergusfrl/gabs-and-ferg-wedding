export function parsePhotoIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/photo\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function photoPath(id: string): string {
  return `/photo/${encodeURIComponent(id)}`;
}
