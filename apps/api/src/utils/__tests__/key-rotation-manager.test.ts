import { describe, it, expect, beforeEach } from 'vitest';
import { KeyRotationManager } from '../key-rotation-manager';

describe('KeyRotationManager', () => {
  let manager: KeyRotationManager;

  beforeEach(() => {
    manager = new KeyRotationManager();
  });

  it('generates only a primary signature when no rotation has occurred', () => {
    manager.setKeyState('wh_1', { activeSecret: 'secret-a' });
    const result = manager.sign('payload', 'wh_1');
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeUndefined();
  });

  it('generates a secondary signature with the same nonce within the 48h grace period', () => {
    manager.setKeyState('wh_2', { activeSecret: 'old-secret' });
    manager.rotateKey('wh_2', 'new-secret');
    const result = manager.sign('payload', 'wh_2');
    expect(result.primary).toBeDefined();
    expect(result.secondary).toBeDefined();
    expect(result.secondary!.nonce).toBe(result.primary.nonce);
  });

  it('retires the previous key after the grace period and no longer emits a secondary signature', () => {
    const expiredAt = new Date(Date.now() - KeyRotationManager.GRACE_PERIOD_MS - 1000);
    manager.setKeyState('wh_3', {
      activeSecret: 'new-secret',
      previousSecret: 'old-secret',
      previousActivatedAt: expiredAt,
    });

    const result = manager.sign('payload', 'wh_3');
    expect(result.secondary).toBeUndefined();

    const state = manager.getKeyState('wh_3');
    expect(state.previousSecret).toBeNull();
    expect(state.previousActivatedAt).toBeNull();
  });
});
