export type TaxExportFormat = 'cointracker' | 'koinly' | 'irs8949';
export type TaxTransactionType = 'receive' | 'buy' | 'sell' | 'send';

export interface TaxExportTransaction {
  date: Date | string;
  asset: string;
  quantity: number | string;
  usdValue: number | string;
  type: TaxTransactionType;
  txHash?: string;
  fromAddress?: string;
  memo?: string;
}

interface NormalizedTaxTransaction extends TaxExportTransaction {
  date: Date;
  quantity: number;
  usdValue: number;
}

interface TaxLot {
  asset: string;
  quantity: number;
  costBasis: number;
  acquiredAt: Date;
}

function normalizeQuantity(value: number | string): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toCsvRow(values: Array<string | number | null | undefined>): string {
  return values
    .map((value) => {
      const text = String(value ?? '').replace(/"/g, '""');
      if (/[",\n]/.test(text)) {
        return `"${text}"`;
      }
      return text;
    })
    .join(',');
}

function isDisposalType(type: TaxTransactionType): boolean {
  return type === 'sell' || type === 'send';
}

export class TaxReportGenerator {
  private normalizeTransactions(transactions: TaxExportTransaction[]): NormalizedTaxTransaction[] {
    return transactions
      .map((transaction) => ({
        ...transaction,
        date: new Date(transaction.date),
        quantity: normalizeQuantity(transaction.quantity),
        usdValue: normalizeQuantity(transaction.usdValue),
      }))
      .filter((transaction) => transaction.asset && Number.isFinite(transaction.quantity))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  private consumeFifoLots(assetLots: Map<string, TaxLot[]>, asset: string, amount: number): number {
    const lots = assetLots.get(asset) ?? [];
    let remaining = amount;
    let costBasis = 0;

    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0];
      const matched = Math.min(lot.quantity, remaining);
      const unitCost = lot.costBasis / lot.quantity;
      costBasis += matched * unitCost;
      remaining -= matched;
      lot.quantity -= matched;
      lot.costBasis -= matched * unitCost;

      if (lot.quantity <= 0) {
        lots.shift();
      }
    }

    if (amount > 0 && remaining > 0) {
      const shortage = amount - remaining;
      costBasis = costBasis * (amount / Math.max(shortage, 1));
    }

    assetLots.set(asset, lots);
    return costBasis;
  }

  private buildCoinTrackerRows(transactions: TaxExportTransaction[]) {
    const normalized = this.normalizeTransactions(transactions);
    const assetLots = new Map<string, TaxLot[]>();
    const rows: Array<Array<string | number>> = [];

    for (const transaction of normalized) {
      const asset = transaction.asset.trim();
      const isSale = isDisposalType(transaction.type);
      const signedQuantity = isSale ? -Math.abs(transaction.quantity) : Math.abs(transaction.quantity);

      if (!isSale) {
        const existing = assetLots.get(asset) ?? [];
        existing.push({
          asset,
          quantity: Math.abs(transaction.quantity),
          costBasis: transaction.usdValue,
          acquiredAt: transaction.date,
        });
        assetLots.set(asset, existing);

        rows.push([
          transaction.date.toISOString().slice(0, 10),
          asset,
          Math.abs(transaction.quantity),
          transaction.usdValue,
          transaction.usdValue,
          0,
          transaction.type,
          transaction.txHash ?? transaction.fromAddress ?? '',
        ]);
        continue;
      }

      const soldQuantity = Math.abs(transaction.quantity);
      let costBasis = 0;
      let remaining = soldQuantity;
      const lots = assetLots.get(asset) ?? [];

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const matched = Math.min(lot.quantity, remaining);
        const unitCost = lot.costBasis / lot.quantity;
        costBasis += matched * unitCost;
        remaining -= matched;
        lot.quantity -= matched;
        lot.costBasis -= matched * unitCost;

        if (lot.quantity <= 0) {
          lots.shift();
        }
      }

      assetLots.set(asset, lots);
      const realizedGainLoss = transaction.usdValue - costBasis;

      rows.push([
        transaction.date.toISOString().slice(0, 10),
        asset,
        -soldQuantity,
        transaction.usdValue,
        costBasis,
        realizedGainLoss,
        transaction.type,
        transaction.txHash ?? transaction.fromAddress ?? '',
      ]);
    }

    return rows;
  }

  generateCoinTrackerCsv(transactions: TaxExportTransaction[]): string {
    const header = ['Date', 'Asset', 'Quantity', 'USD Value', 'Cost Basis', 'Realized Gain/Loss', 'Type', 'Transaction Hash'];
    return [toCsvRow(header), ...this.buildCoinTrackerRows(transactions).map(toCsvRow)].join('\n');
  }

  generateKoinlyCsv(transactions: TaxExportTransaction[]): string {
    const rows = this.normalizeTransactions(transactions).map((transaction) => {
      const isSale = isDisposalType(transaction.type);
      const signedQuantity = isSale ? -Math.abs(transaction.quantity) : Math.abs(transaction.quantity);
      return [
        transaction.date.toISOString().slice(0, 10),
        transaction.asset,
        signedQuantity,
        transaction.usdValue,
        transaction.type,
        transaction.txHash ?? '',
      ];
    });

    return [
      toCsvRow(['Date', 'Asset', 'Quantity', 'USD Value', 'Type', 'Hash']),
      ...rows.map(toCsvRow),
    ].join('\n');
  }

  generateIrs8949Csv(transactions: TaxExportTransaction[]): string {
    const rows = this.normalizeTransactions(transactions)
      .filter((transaction) => isDisposalType(transaction.type))
      .map((transaction) => {
        const soldQuantity = Math.abs(transaction.quantity);
        const lots = new Map<string, TaxLot[]>();
        for (const prior of this.normalizeTransactions(transactions).filter((t) => t.date <= transaction.date && t.asset === transaction.asset && !isDisposalType(t.type))) {
          const existing = lots.get(prior.asset) ?? [];
          existing.push({
            asset: prior.asset,
            quantity: Math.abs(prior.quantity),
            costBasis: prior.usdValue,
            acquiredAt: prior.date,
          });
          lots.set(prior.asset, existing);
        }

        let costBasis = 0;
        let remaining = soldQuantity;
        const candidateLots = lots.get(transaction.asset) ?? [];

        while (remaining > 0 && candidateLots.length > 0) {
          const lot = candidateLots[0];
          const matched = Math.min(lot.quantity, remaining);
          const unitCost = lot.costBasis / lot.quantity;
          costBasis += matched * unitCost;
          remaining -= matched;
          lot.quantity -= matched;
          lot.costBasis -= matched * unitCost;

          if (lot.quantity <= 0) {
            candidateLots.shift();
          }
        }

        return [
          transaction.date.toISOString().slice(0, 10),
          transaction.date.toISOString().slice(0, 10),
          `${transaction.asset} ${transaction.type.toUpperCase()}`,
          transaction.usdValue,
          costBasis,
          transaction.usdValue - costBasis,
          transaction.txHash ?? '',
        ];
      });

    return [
      toCsvRow(['Date Acquired', 'Date Sold', 'Description', 'Proceeds', 'Cost Basis', 'Gain/Loss', 'Reference']),
      ...rows.map(toCsvRow),
    ].join('\n');
  }

  generateCsv(transactions: TaxExportTransaction[], format: TaxExportFormat = 'cointracker'): string {
    switch (format) {
      case 'koinly':
        return this.generateKoinlyCsv(transactions);
      case 'irs8949':
        return this.generateIrs8949Csv(transactions);
      case 'cointracker':
      default:
        return this.generateCoinTrackerCsv(transactions);
    }
  }
}

export function generateTaxExportCsv(
  transactions: TaxExportTransaction[],
  format: TaxExportFormat = 'cointracker',
): string {
  return new TaxReportGenerator().generateCsv(transactions, format);
}
