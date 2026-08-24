import { SPEND_CATEGORIES, WEEKDAYS } from '@amana/types';
import { formatNaira } from './format-money';

/**
 * Describe a published rule the way the parent who set it would say it.
 *
 * The sub-wallet screen used to print `JSON.stringify(config)`, so a parent checking what their
 * child is allowed to spend read `{"maxKobo":"20000000","windowKind":"daily"}`. That is the
 * engine's storage shape leaking into the one screen whose entire job is to answer "what did I
 * agree to?" — and a control the owner cannot read is not a control they can trust.
 *
 * Anything unrecognised falls back to the raw JSON rather than throwing or rendering blank: a
 * rule kind this build does not know about is still a rule that is being enforced, and hiding it
 * would understate what the agent is bound by.
 */
export function summariseRule(kind: string, config: unknown): string {
  const c = (config ?? {}) as Record<string, unknown>;
  try {
    switch (kind) {
      case 'limit': {
        const max = formatNaira(String(c.maxKobo ?? '0'));
        return c.windowKind === 'monthly' ? `${max} per month` : `${max} per day`;
      }
      case 'category': {
        const names = asArray(c.categories).map(labelForCategory);
        if (names.length === 0)
          return c.mode === 'allowlist' ? 'Nothing allowed' : 'Nothing blocked';
        return c.mode === 'blocklist'
          ? `Cannot spend on ${joinWords(names)}`
          : `Only ${joinWords(names)}`;
      }
      case 'time_window': {
        const from = hour12(Number(c.startHour));
        const to = hour12(Number(c.endHour));
        const days = describeDays(asArray(c.daysOfWeek).map(Number));
        return `${from} to ${to}, ${days}`;
      }
      case 'allowlist': {
        const accounts = asArray(c.accounts).length;
        const names = asArray(c.nameSubstrings).length;
        const parts: string[] = [];
        if (accounts) parts.push(`${accounts} approved ${accounts === 1 ? 'account' : 'accounts'}`);
        if (names) parts.push(`${names} approved ${names === 1 ? 'name' : 'names'}`);
        return parts.length ? `Only ${joinWords(parts)}` : 'Only approved vendors';
      }
      case 'anomaly_threshold':
        return `Hold anything scoring above ${String(c.maxScore ?? '')}`;
      default:
        return JSON.stringify(config);
    }
  } catch {
    return JSON.stringify(config);
  }
}

/** The rule kind, as a heading a person would recognise. */
export function ruleKindLabel(kind: string): string {
  switch (kind) {
    case 'limit':
      return 'Spending limit';
    case 'category':
      return 'Categories';
    case 'time_window':
      return 'Allowed hours';
    case 'allowlist':
      return 'Approved vendors';
    case 'anomaly_threshold':
      return 'Unusual activity';
    default:
      return kind;
  }
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function labelForCategory(value: unknown): string {
  const found = SPEND_CATEGORIES.find((c) => c.value === value);
  return found ? found.label.toLowerCase() : String(value);
}

/** "a, b and c" — the way it would be spoken, not "a, b, c". */
function joinWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function hour12(h: number): string {
  if (!Number.isFinite(h)) return '?';
  const hour = ((h % 24) + 24) % 24;
  if (hour === 0) return 'midnight';
  if (hour === 12) return 'noon';
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

/**
 * Name the common shapes rather than listing seven abbreviations. "Mon, Tue, Wed, Thu, Fri" is
 * accurate and unreadable; "weekdays" is what the parent chose.
 */
function describeDays(days: number[]): string {
  const set = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (set.size === 0) return 'no days';
  if (set.size === 7) return 'every day';
  const weekdays = [1, 2, 3, 4, 5];
  const weekend = [0, 6];
  if (set.size === 5 && weekdays.every((d) => set.has(d))) return 'weekdays';
  if (set.size === 2 && weekend.every((d) => set.has(d))) return 'weekends';
  return WEEKDAYS.filter((d) => set.has(d.value))
    .map((d) => d.label)
    .join(', ');
}
