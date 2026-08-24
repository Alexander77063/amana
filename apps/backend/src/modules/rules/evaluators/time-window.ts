import { hourInTz, weekdayInTz } from '../../../lib/tz';
import type { DenialReason, TimeWindowRuleConfig, TxnIntent } from '../types';

export function evaluateTimeWindow(
  cfg: TimeWindowRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  // Evaluated on the household's wall clock, not UTC. A parent who blocks spending before 6am
  // means 6am where they live; under UTC every window silently landed an hour late, because
  // Nigeria is UTC+1. Quiet hours and the inflow-fee month already work in Africa/Lagos — this
  // makes the rule engine agree with them.
  const hour = hourInTz(intent.confirmedAt);
  const day = weekdayInTz(intent.confirmedAt);

  if (!cfg.daysOfWeek.includes(day)) {
    return {
      code: 'OUTSIDE_TIME_WINDOW',
      nowHour: hour,
      allowedStart: cfg.startHour,
      allowedEnd: cfg.endHour,
    };
  }

  const wraps = cfg.startHour > cfg.endHour;
  const inWindow = wraps
    ? hour >= cfg.startHour || hour < cfg.endHour
    : hour >= cfg.startHour && hour < cfg.endHour;

  if (!inWindow) {
    return {
      code: 'OUTSIDE_TIME_WINDOW',
      nowHour: hour,
      allowedStart: cfg.startHour,
      allowedEnd: cfg.endHour,
    };
  }
  return null;
}
