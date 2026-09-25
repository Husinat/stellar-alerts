import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentAdapter } from './payment.adapter';

function mockFetchOnce(payments: unknown[] = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, payments }),
  });
}

describe('PaymentAdapter.getPayments', () => {
  let adapter: PaymentAdapter;

  beforeEach(() => {
    adapter = new PaymentAdapter({ baseUrl: 'http://test', getAuthHeaders: () => ({}) });
  });

  it('requests /payments with no query string when called with nothing', async () => {
    const fetchMock = mockFetchOnce();
    vi.stubGlobal('fetch', fetchMock);

    await adapter.getPayments();

    expect(fetchMock).toHaveBeenCalledWith('http://test/payments', expect.anything());
  });

  it('stays backward compatible: a bare walletId string still works', async () => {
    const fetchMock = mockFetchOnce();
    vi.stubGlobal('fetch', fetchMock);

    await adapter.getPayments('wallet-9');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test/payments?walletId=wallet-9',
      expect.anything(),
    );
  });

  it('serializes asset, memo, date range, and sort filters as query params', async () => {
    const fetchMock = mockFetchOnce();
    vi.stubGlobal('fetch', fetchMock);

    await adapter.getPayments({
      walletId: 'wallet-9',
      asset: 'USDC',
      memo: 'invoice-42',
      dateFrom: '2026-01-01T00:00:00.000Z',
      dateTo: '2026-01-31T00:00:00.000Z',
      sortBy: 'amount',
      sortOrder: 'asc',
    });

    const [url] = fetchMock.mock.calls[0];
    const params = new URLSearchParams(new URL(url).search);
    expect(params.get('walletId')).toBe('wallet-9');
    expect(params.get('asset')).toBe('USDC');
    expect(params.get('memo')).toBe('invoice-42');
    expect(params.get('dateFrom')).toBe('2026-01-01T00:00:00.000Z');
    expect(params.get('dateTo')).toBe('2026-01-31T00:00:00.000Z');
    expect(params.get('sortBy')).toBe('amount');
    expect(params.get('sortOrder')).toBe('asc');
  });
});
