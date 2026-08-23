/**
 * The spend categories a principal can allow or block, and an agent tags a payment with.
 *
 * This is a CLOSED vocabulary shared by both apps on purpose. A category rule compares the
 * transaction's `category` string against the principal's list, so if the two sides can drift
 * — the agent sending something the parent's picker never offered — an allowlist silently
 * denies legitimate spending and a blocklist silently permits it. Adding a category means
 * adding it here, once.
 *
 * Chosen for the Nigerian household and small-business patterns Amana is built around
 * (docs/business/2026-05-03-business-plan.md §2): school runs, market trips, fuel, staff
 * errands, top-ups.
 */
export const SPEND_CATEGORIES = [
  { value: 'transport', label: 'Transport' },
  { value: 'food', label: 'Food & market' },
  { value: 'school', label: 'School' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'airtime_data', label: 'Airtime & data' },
  { value: 'health', label: 'Health & pharmacy' },
  { value: 'repairs', label: 'Repairs & maintenance' },
  { value: 'supplies', label: 'Business supplies' },
  { value: 'other', label: 'Other' },
] as const;

export type SpendCategory = (typeof SPEND_CATEGORIES)[number]['value'];

export const SPEND_CATEGORY_VALUES: readonly string[] = SPEND_CATEGORIES.map((c) => c.value);

/** Human label for a stored category value; falls back to the raw value for unknown ones. */
export function spendCategoryLabel(value: string | null | undefined): string {
  if (!value) return 'Uncategorised';
  return SPEND_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** Days of the week, 0 = Sunday, matching the time-window rule's `daysOfWeek`. */
export const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
] as const;
