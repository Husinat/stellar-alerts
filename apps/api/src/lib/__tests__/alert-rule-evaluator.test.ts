import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AlertRuleRecord,
  NormalizedPaymentEvent,
  evaluateAlertRules,
  evaluateAndDispatch,
  matchesAlertRule,
  meetsMinimumAmount,
  ruleAppliesToAsset,
  ruleAppliesToWallet,
} from '../alert-rule-evaluator';

const baseRule = (overrides: Partial<AlertRuleRecord> = {}): AlertRuleRecord => ({
  id: 'rule-1',
  userId: 'user-1',
  walletId: null,
  assets: [],
  minAmount: null,
  conditions: null,
  isActive: true,
  ...overrides,
});

const baseEvent = (overrides: Partial<NormalizedPaymentEvent> = {}): NormalizedPaymentEvent => ({
  paymentId: 'pay-1',
  txHash: 'hash-1',
  walletId: 'wallet-1',
  userId: 'user-1',
  amount: '100',
  asset: 'XLM',
  assetIssuer: null,
  fromAddress: 'GABC...',
  memo: null,
  receivedAt: '2026-09-23T00:00:00.000Z',
  ...overrides,
});

describe('ruleAppliesToWallet', () => {
  it('matches any wallet when walletId is null', () => {
    expect(ruleAppliesToWallet(baseRule({ walletId: null }), 'wallet-1')).toBe(true);
    expect(ruleAppliesToWallet(baseRule({ walletId: null }), 'wallet-2')).toBe(true);
  });

  it('only matches the scoped wallet when walletId is set', () => {
    expect(ruleAppliesToWallet(baseRule({ walletId: 'wallet-1' }), 'wallet-1')).toBe(true);
    expect(ruleAppliesToWallet(baseRule({ walletId: 'wallet-1' }), 'wallet-2')).toBe(false);
  });
});

describe('ruleAppliesToAsset — multiple assets', () => {
  it('matches any asset when the allow-list is empty', () => {
    expect(ruleAppliesToAsset(baseRule({ assets: [] }), 'XLM')).toBe(true);
    expect(ruleAppliesToAsset(baseRule({ assets: [] }), 'USDC')).toBe(true);
  });

  it('matches only assets present in a multi-asset allow-list', () => {
    const rule = baseRule({ assets: ['USDC', 'XLM', 'yUSDC'] });
    expect(ruleAppliesToAsset(rule, 'XLM')).toBe(true);
    expect(ruleAppliesToAsset(rule, 'USDC')).toBe(true);
    expect(ruleAppliesToAsset(rule, 'BTC')).toBe(false);
  });
});

describe('meetsMinimumAmount — threshold boundaries', () => {
  it('has no minimum when minAmount is null', () => {
    expect(meetsMinimumAmount(baseRule({ minAmount: null }), 0)).toBe(true);
  });

  it('is inclusive at the exact boundary', () => {
    const rule = baseRule({ minAmount: 50 });
    expect(meetsMinimumAmount(rule, 50)).toBe(true);
    expect(meetsMinimumAmount(rule, '50')).toBe(true);
  });

  it('rejects amounts just below the boundary and accepts amounts just above it', () => {
    const rule = baseRule({ minAmount: 50 });
    expect(meetsMinimumAmount(rule, 49.999999)).toBe(false);
    expect(meetsMinimumAmount(rule, 50.000001)).toBe(true);
  });
});

describe('matchesAlertRule — inactive rules', () => {
  it('never matches an inactive rule, even if every other condition is satisfied', () => {
    const rule = baseRule({ isActive: false, assets: [], minAmount: null });
    expect(matchesAlertRule(rule, baseEvent())).toBe(false);
  });

  it('matches an active rule whose conditions are all satisfied', () => {
    const rule = baseRule({ isActive: true, assets: ['XLM'], minAmount: 10 });
    expect(matchesAlertRule(rule, baseEvent({ asset: 'XLM', amount: '100' }))).toBe(true);
  });

  it('evaluates the advanced FilterRuleGroup conditions when present', () => {
    const rule = baseRule({
      conditions: { operator: 'AND', rules: [{ field: 'fromAddress', operator: 'eq', value: 'GABC...' }] },
    });
    expect(matchesAlertRule(rule, baseEvent({ fromAddress: 'GABC...' }))).toBe(true);
    expect(matchesAlertRule(rule, baseEvent({ fromAddress: 'GXYZ...' }))).toBe(false);
  });
});

describe('evaluateAlertRules — multiple assets and rule grouping', () => {
  it('returns only the rules matching a specific asset out of several configured rules', () => {
    const rules = [
      baseRule({ id: 'usdc-rule', assets: ['USDC'] }),
      baseRule({ id: 'xlm-rule', assets: ['XLM'] }),
      baseRule({ id: 'any-asset-rule', assets: [] }),
      baseRule({ id: 'inactive-xlm-rule', assets: ['XLM'], isActive: false }),
    ];

    const matched = evaluateAlertRules(rules, baseEvent({ asset: 'XLM', amount: '10' }));

    expect(matched.map((r) => r.id)).toEqual(['xlm-rule', 'any-asset-rule']);
  });
});

describe('evaluateAndDispatch', () => {
  let deps: {
    findRules: ReturnType<typeof vi.fn>;
    hasDispatched: ReturnType<typeof vi.fn>;
    recordDispatch: ReturnType<typeof vi.fn>;
    enqueueAlert: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    deps = {
      findRules: vi.fn().mockResolvedValue([baseRule({ id: 'rule-1', assets: [], minAmount: null })]),
      hasDispatched: vi.fn().mockResolvedValue(false),
      recordDispatch: vi.fn().mockResolvedValue(undefined),
      enqueueAlert: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('enqueues one job and records the dispatch when a rule matches', async () => {
    const event = baseEvent();
    const result = await evaluateAndDispatch(event, deps);

    expect(result).toEqual({ matchedRuleIds: ['rule-1'], enqueued: true });
    expect(deps.recordDispatch).toHaveBeenCalledWith('pay-1', ['rule-1']);
    expect(deps.enqueueAlert).toHaveBeenCalledWith(event);
  });

  it('does not enqueue or record anything when no rule matches', async () => {
    deps.findRules.mockResolvedValue([baseRule({ assets: ['USDC'] })]);

    const result = await evaluateAndDispatch(baseEvent({ asset: 'XLM' }), deps);

    expect(result).toEqual({ matchedRuleIds: [], enqueued: false });
    expect(deps.hasDispatched).not.toHaveBeenCalled();
    expect(deps.recordDispatch).not.toHaveBeenCalled();
    expect(deps.enqueueAlert).not.toHaveBeenCalled();
  });

  it('skips dispatch for a duplicate event delivery already recorded for this payment', async () => {
    deps.hasDispatched.mockResolvedValue(true);

    const result = await evaluateAndDispatch(baseEvent(), deps);

    expect(result).toEqual({ matchedRuleIds: ['rule-1'], enqueued: false });
    expect(deps.recordDispatch).not.toHaveBeenCalled();
    expect(deps.enqueueAlert).not.toHaveBeenCalled();
  });

  it('only enqueues once across two evaluations of the same duplicate event', async () => {
    const event = baseEvent();

    await evaluateAndDispatch(event, deps);
    deps.hasDispatched.mockResolvedValue(true); // simulates the recordDispatch call taking effect

    const second = await evaluateAndDispatch(event, deps);

    expect(second.enqueued).toBe(false);
    expect(deps.enqueueAlert).toHaveBeenCalledTimes(1);
  });
});
