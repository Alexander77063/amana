import { evaluateAllowlist } from './evaluators/allowlist';
import { evaluateAnomalyThreshold } from './evaluators/anomaly-threshold';
import { evaluateCategory } from './evaluators/category';
import { evaluateLimit } from './evaluators/limit';
import { evaluateTimeWindow } from './evaluators/time-window';
import type { Decision, DenialReason, Rule, RuleEvaluationContext, RuleSet, TxnIntent } from './types';

function evalRule(
  rule: Rule,
  intent: TxnIntent,
  ctx: RuleEvaluationContext,
): DenialReason | null {
  switch (rule.kind) {
    case 'limit':
      return evaluateLimit(rule.config, intent, ctx.ledger);
    case 'category':
      return evaluateCategory(rule.config, intent);
    case 'time_window':
      return evaluateTimeWindow(rule.config, intent);
    case 'allowlist':
      return evaluateAllowlist(rule.config, intent);
    case 'anomaly_threshold':
      return evaluateAnomalyThreshold(rule.config, ctx.anomalyScore);
  }
}

export function evaluate(
  intent: TxnIntent,
  ruleSet: RuleSet,
  ctx: RuleEvaluationContext,
): Decision {
  const sorted = [...ruleSet.rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );
  const reasons: DenialReason[] = [];
  for (const rule of sorted) {
    const r = evalRule(rule, intent, ctx);
    if (r !== null) reasons.push(r);
  }
  if (reasons.length === 0) return { kind: 'allow' };
  // biome-ignore lint/style/noNonNullAssertion: reasons.length > 0 guarantees [0] exists
  return { kind: 'require_bump', firstFailedReason: reasons[0]!, allReasons: reasons };
}
