import type { DenialReason, TimeWindowRuleConfig, TxnIntent } from '../types';

export function evaluateTimeWindow(
  cfg: TimeWindowRuleConfig,
  intent: TxnIntent,
): DenialReason | null {
  const hour = intent.confirmedAt.getUTCHours();
  const day = intent.confirmedAt.getUTCDay();

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
