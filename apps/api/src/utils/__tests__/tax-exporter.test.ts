import { describe, expect, it } from 'vitest';
import { TaxReportGenerator, generateTaxExportCsv } from '../tax-exporter';

describe('TaxReportGenerator', () => {
  it('builds CoinTracker-compatible CSV rows with FIFO cost basis', () => {
    const csv = generateTaxExportCsv(
      [
        {
          date: '2024-01-02T00:00:00Z',
          asset: 'XLM',
          quantity: 100,
          usdValue: 150,
          type: 'receive',
          txHash: 'tx-receive-1',
        },
        {
          date: '2024-02-02T00:00:00Z',
          asset: 'XLM',
          quantity: 60,
          usdValue: 90,
          type: 'sell',
          txHash: 'tx-sell-1',
        },
      ],
      'cointracker',
    );

    expect(csv).toContain('Date,Asset,Quantity,USD Value,Cost Basis,Realized Gain/Loss');
    expect(csv).toContain('2024-02-02');
    expect(csv).toContain('-60');
  });

  it('supports the IRS 8949 schema with FIFO acquisition data', () => {
    const generator = new TaxReportGenerator();
    const csv = generator.generateIrs8949Csv([
      {
        date: '2024-01-01T00:00:00Z',
        asset: 'USDC',
        quantity: 40,
        usdValue: 40,
        type: 'receive',
        txHash: 'tx-usdc-1',
      },
      {
        date: '2024-02-01T00:00:00Z',
        asset: 'USDC',
        quantity: 20,
        usdValue: 22,
        type: 'sell',
        txHash: 'tx-usdc-2',
      },
    ]);

    expect(csv).toContain('Date Acquired');
    expect(csv).toContain('Date Sold');
    expect(csv).toContain('Description');
  });
});
