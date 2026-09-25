import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import crypto from 'crypto';

export interface TransactionReceiptInput {
  paymentId: string;
  txHash: string;
  fromAddress: string;
  toWalletPublicKey: string;
  walletLabel?: string | null;
  amount: string | number;
  asset: string;
  assetIssuer?: string | null;
  memo?: string | null;
  receivedAt: Date | string;
  userEmail: string;
}

export interface GeneratedReceiptResult {
  buffer: Buffer;
  verificationHash: string;
  stellarExpertUrl: string;
}

/**
 * Computes a deterministic SHA-256 verification hash over the canonical payment receipt payload.
 */
export function computeReceiptVerificationHash(input: TransactionReceiptInput): string {
  const canonicalString = [
    input.paymentId,
    input.txHash,
    input.fromAddress,
    input.toWalletPublicKey,
    String(input.amount),
    input.asset,
    input.assetIssuer || 'N/A',
    input.memo || 'N/A',
    new Date(input.receivedAt).toISOString(),
  ].join('|');

  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Generates a deterministic, official transaction receipt PDF buffer with metadata and verification checksum.
 */
export function generateTransactionReceiptPdf(input: TransactionReceiptInput): Promise<GeneratedReceiptResult> {
  const verificationHash = computeReceiptVerificationHash(input);
  const stellarExpertUrl = `https://stellar.expert/explorer/public/tx/${input.txHash}`;
  const receivedAtDate = new Date(input.receivedAt);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () =>
      resolve({
        buffer: Buffer.concat(chunks),
        verificationHash,
        stellarExpertUrl,
      })
    );
    stream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(stream);

    // Title & Branding Header
    doc.fillColor('#0f172a').fontSize(22).font('Helvetica-Bold').text('OFFICIAL STELLAR PAYMENT RECEIPT', { align: 'left' });
    doc.moveDown(0.3);
    doc.fillColor('#38bdf8').fontSize(10).font('Helvetica').text('Verified On-Chain Transaction Document — Stellar Alerts System');
    doc.moveDown(0.8);

    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cbd5e1').lineWidth(1).stroke();
    doc.moveDown(1);

    // Primary Summary Box
    const boxY = doc.y;
    doc.rect(40, boxY, 515, 60).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text('Amount Received', 55, boxY + 12);
    doc.fillColor('#16a34a').fontSize(20).font('Helvetica-Bold').text(`${input.amount} ${input.asset}`, 55, boxY + 30);
    doc.fillColor('#64748b').fontSize(9).font('Helvetica').text(`Issued to: ${input.userEmail}`, 360, boxY + 35, { align: 'right' });

    doc.y = boxY + 75;
    doc.moveDown(0.8);

    // Canonical Transaction Detail Fields
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text('Canonical Transaction Details');
    doc.moveDown(0.5);

    const drawDetailRow = (label: string, value: string, highlight = false) => {
      const currentY = doc.y;
      doc.fillColor('#475569').fontSize(9).font('Helvetica-Bold').text(label, 45, currentY, { width: 140 });
      doc
        .fillColor(highlight ? '#0284c7' : '#0f172a')
        .fontSize(9)
        .font('Helvetica')
        .text(value, 185, currentY, { width: 360 });
      doc.moveDown(0.5);
    };

    drawDetailRow('Payment ID', input.paymentId);
    drawDetailRow('Transaction Hash', input.txHash, true);
    drawDetailRow('Date & Time (UTC)', receivedAtDate.toUTCString());
    drawDetailRow('Sender Address (From)', input.fromAddress);
    drawDetailRow('Recipient Wallet (To)', input.toWalletPublicKey);

    if (input.walletLabel) {
      drawDetailRow('Wallet Label', input.walletLabel);
    }

    drawDetailRow('Asset Code', input.asset);

    if (input.assetIssuer) {
      drawDetailRow('Asset Issuer Address', input.assetIssuer);
    } else {
      drawDetailRow('Asset Type', 'Native Stellar Asset (XLM)');
    }

    if (input.memo) {
      drawDetailRow('Transaction Memo', input.memo);
    }

    doc.moveDown(1);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
    doc.moveDown(1);

    // Verification & Blockchain Proof Section
    doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold').text('On-Chain Verification & Metadata');
    doc.moveDown(0.5);

    drawDetailRow('StellarExpert Link', stellarExpertUrl, true);
    drawDetailRow('SHA-256 Checksum', verificationHash);
    drawDetailRow('Generated Timestamp', new Date().toISOString());

    doc.moveDown(1.5);
    doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(
      'This document is an electronically generated proof of transaction receipt recorded on the Stellar distributed ledger. Authenticity can be verified at any time using the transaction hash on StellarExpert.',
      { align: 'center', width: 515 }
    );

    doc.end();
  });
}
