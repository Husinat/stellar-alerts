import { FilterRuleGroup, PaymentContext, evaluateRuleGroup } from './rules-engine';

/**
 * A normalized payment event, independent of the Horizon/Soroban record
 * shape it originated from. Everything the evaluator needs to decide
 * whether a persisted AlertRule fires.
 */
export interface NormalizedPaymentEvent {
  paymentId: string;
  txHash: string;
  walletId: string;
  userId: string;
  amount: number | string;
  asset: string;
  assetIssuer?: string | null;
  fromAddress: string;
  memo?: string | null;
  receivedAt: string;
}

/**
 * The subset of the persisted AlertRule row the evaluator reasons about.
 * Kept as a plain interface (rather than importing the generated Prisma
 * type) so this module has no runtime dependency on the Prisma client and
 * stays trivially unit-testable.
 */
export interface AlertRuleRecord {
  id: string;
  userId: string;
  walletId: string | null;
  assets: string[];
  minAmount: number | string | null;
  conditions: FilterRuleGroup | null;
  isActive: boolean;
}

/** A rule with no walletId applies across all of the user's wallets. */
export function ruleAppliesToWallet(rule: AlertRuleRecord, walletId: string): boolean {
  return rule.walletId === null || rule.walletId === undefined || rule.walletId === walletId;
}

/** An empty (or absent) assets list means "match any asset". */
export function ruleAppliesToAsset(rule: AlertRuleRecord, asset: string): boolean {
  return !rule.assets || rule.assets.length === 0 || rule.assets.includes(asset);
}

/** A null/undefined minAmount means "no minimum threshold". Boundary is inclusive (>=). */
export function meetsMinimumAmount(rule: AlertRuleRecord, amount: number | string): boolean {
  if (rule.minAmount === null || rule.minAmount === undefined) return true;
  return Number(amount) >= Number(rule.minAmount);
}

/**
 * Evaluates a single AlertRule against a normalized payment event. Inactive
 * rules never match, regardless of their other conditions.
 */
export function matchesAlertRule(rule: AlertRuleRecord, event: NormalizedPaymentEvent): boolean {
  if (!rule.isActive) return false;
  if (!ruleAppliesToWallet(rule, event.walletId)) return false;
  if (!ruleAppliesToAsset(rule, event.asset)) return false;
  if (!meetsMinimumAmount(rule, event.amount)) return false;

  if (rule.conditions) {
    const context: PaymentContext = {
      amount: event.amount,
      asset: event.asset,
      fromAddress: event.fromAddress,
      memo: event.memo ?? null,
    };
    if (!evaluateRuleGroup(rule.conditions, context)) return false;
  }

  return true;
}

/** Returns the subset of `rules` that match `event`, preserving input order. */
export function evaluateAlertRules(
  rules: AlertRuleRecord[],
  event: NormalizedPaymentEvent,
): AlertRuleRecord[] {
  return rules.filter((rule) => matchesAlertRule(rule, event));
}

export interface AlertRuleEvaluationResult {
  /** IDs of every active rule that matched this event. */
  matchedRuleIds: string[];
  /** True if a notification job was newly enqueued for this event. */
  enqueued: boolean;
}

export interface AlertRuleEvaluatorDeps {
  /** Loads the candidate rules for the event's user (typically all of them; filtering happens here). */
  findRules: (userId: string) => Promise<AlertRuleRecord[]>;
  /** True if this paymentId already has a recorded dispatch (duplicate delivery guard). */
  hasDispatched: (paymentId: string) => Promise<boolean>;
  /** Persists the idempotency record for this paymentId and its matched rule IDs. */
  recordDispatch: (paymentId: string, matchedRuleIds: string[]) => Promise<void>;
  /** Enqueues exactly one notification job for the matched event. */
  enqueueAlert: (event: NormalizedPaymentEvent) => Promise<unknown>;
}

/**
 * Loads a user's persisted AlertRules, evaluates them against `event`, and
 * enqueues a single notification job if any rule matches — skipping
 * dispatch entirely when no rule matches, and skipping re-dispatch when
 * this exact payment was already processed (duplicate event delivery).
 */
export async function evaluateAndDispatch(
  event: NormalizedPaymentEvent,
  deps: AlertRuleEvaluatorDeps,
): Promise<AlertRuleEvaluationResult> {
  const rules = await deps.findRules(event.userId);
  const matched = evaluateAlertRules(rules, event);

  if (matched.length === 0) {
    return { matchedRuleIds: [], enqueued: false };
  }

  const matchedRuleIds = matched.map((rule) => rule.id);

  if (await deps.hasDispatched(event.paymentId)) {
    return { matchedRuleIds, enqueued: false };
  }

  await deps.recordDispatch(event.paymentId, matchedRuleIds);
  await deps.enqueueAlert(event);

  return { matchedRuleIds, enqueued: true };
}
