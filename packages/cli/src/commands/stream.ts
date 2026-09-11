import { Command } from 'commander';
import chalk from 'chalk';
import { apiClient } from '../lib/api.js';
import { PaymentDTO } from '../lib/types.js';

function formatPayment(payment: PaymentDTO): string {
  const time = new Date(payment.receivedAt).toLocaleTimeString();
  const amount = chalk.bold.green(`+${payment.amount}`);
  const asset = chalk.cyan(payment.asset);
  const from = chalk.gray(payment.fromAddress.slice(0, 12) + '...' + payment.fromAddress.slice(-4));
  const memo = payment.memo ? chalk.yellow(` [${payment.memo}]`) : '';

  return `${chalk.gray(time)} │ ${amount.padStart(15)} ${asset.padEnd(8)} │ ${from}${memo}`;
}

function printHeader(): void {
  console.log(chalk.bold.blue('\n🌊 Stellar Payment Stream\n'));
  console.log(chalk.gray('─'.repeat(80)));
  console.log(
    chalk.bold(
      'Time'.padEnd(12) +
      '│ ' +
      'Amount'.padEnd(15) +
      'Asset'.padEnd(10) +
      '│ From'.padEnd(25) +
      'Memo'
    )
  );
  console.log(chalk.gray('─'.repeat(80)));
}

export function registerStreamCommands(program: Command): void {
  const stream = program
    .command('stream')
    .description('Watch real-time payment streams');

  stream
    .command('watch')
    .description('Watch real-time payment feed')
    .option('-w, --wallet <walletId>', 'Filter by specific wallet ID')
    .option('-t, --token <token>', 'API authentication token')
    .option('--no-color', 'Disable colored output')
    .action(async (options: { wallet?: string; token?: string; color?: boolean }) => {
      try {
        if (options.token) {
          apiClient['apiKey'] = options.token;
        }

        printHeader();

        let paymentCount = 0;

        const abortController = new AbortController();

        // Handle graceful shutdown
        process.on('SIGINT', () => {
          console.log(chalk.yellow('\n\n⏹  Stream stopped.'));
          console.log(chalk.gray(`Total payments received: ${paymentCount}`));
          abortController.abort();
          process.exit(0);
        });

        console.log(chalk.gray('Connecting to payment stream...'));

        await apiClient.streamPayments(
          (payment: PaymentDTO) => {
            paymentCount++;
            console.log(formatPayment(payment));
          },
          abortController.signal
        );
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          console.log(chalk.yellow('\n⏹  Stream disconnected.'));
        } else {
          console.error(chalk.red(`\n❌ Error: ${(error as Error).message}`));
          process.exit(1);
        }
      }
    });

  stream
    .command('history')
    .description('Show recent payment history')
    .option('-w, --wallet <walletId>', 'Filter by specific wallet ID')
    .option('-l, --limit <number>', 'Number of payments to show', '20')
    .option('-t, --token <token>', 'API authentication token')
    .action(async (options: { wallet?: string; limit?: string; token?: string }) => {
      try {
        if (options.token) {
          apiClient['apiKey'] = options.token;
        }

        const limit = parseInt(options.limit || '20', 10);
        const payments = await apiClient.getPayments(options.wallet, limit);

        if (payments.length === 0) {
          console.log(chalk.yellow('📭 No payments found.'));
          return;
        }

        console.log(chalk.blue(`\n📜 Recent Payments (${payments.length})\n`));
        printHeader();

        for (const payment of payments) {
          console.log(formatPayment(payment));
        }

        console.log(chalk.gray('─'.repeat(80)));
        console.log('');
      } catch (error) {
        console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
