// Photos are always taken in New Zealand Standard Time (UTC+12, no daylight
// saving), regardless of what the viewer's browser timezone is.
const NZST_OFFSET_MINUTES = 11 * 60;

export function formatPhotoTime(createDate: string): string {
  const date = new Date(createDate);
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const nzMinutes = ((utcMinutes + NZST_OFFSET_MINUTES) % (24 * 60) + 24 * 60) % (24 * 60);
  const hours24 = Math.floor(nzMinutes / 60);
  const minutes = nzMinutes % 60;
  const period = hours24 >= 12 ? 'pm' : 'am';
  const hours = hours24 % 12 || 12;
  return `${hours}.${minutes.toString().padStart(2, '0')}${period}`;
}
