import type { QuietHours } from '@amana/types';

function fmt12(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 < 12 ? 'AM' : 'PM';
  const h12 = ((h24 + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function quietWindowSummary(qh: QuietHours | null): string {
  if (!qh || !qh.enabled) return 'Off';
  return `On · ${fmt12(qh.startMinute)} – ${fmt12(qh.endMinute)}`;
}
