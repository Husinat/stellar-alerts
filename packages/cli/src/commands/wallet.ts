import { Command } from 'commander';
import chalk from 'chalk';
import { apiClient } from '../lib/api.js';

export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command('wallet')
    .description('Manage watched Stellar wallets');

  wallet
    .command('add')
    .description('Add a new wallet to watch')
    .argument('<publicKey>', 'Stellar public key (starts with G, 56 chars)')
    .option('-l, --label <label>', 'Optional label for the wallet')
    .option('-t, --token <token>', 'API authentication token')
    .action(async (publicKey: string, options: { label?: string; token?: string }) => {
      try {
        if (options.token) {
          apiClient['apiKey'] = options.token;
        }

        console.log(chalk.blue('🔄 Adding wallet...'));
        const wallet = await apiClient.addWallet(publicKey, options.label);

        console.log(chalk.green('✅ Wallet added successfully!'));
        console.log(`   ID: ${chalk.cyan(wallet.id)}`);
        console.log(`   Public Key: ${chalk.cyan(wallet.publicKey)}`);
        if (wallet.label) {
          console.log(`   Label: ${chalk.cyan(wallet.label)}`);
        }
        console.log(`   Created: ${chalk.gray(new Date(wallet.createdAt).toISOString())}`);
      } catch (error) {
        console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  wallet
    .command('list')
    .description('List all watched wallets')
    .option('-t, --token <token>', 'API authentication token')
    .action(async (options: { token?: string }) => {
      try {
        if (options.token) {
          apiClient['apiKey'] = options.token;
        }

        const wallets = await apiClient.getWallets();

        if (wallets.length === 0) {
          console.log(chalk.yellow('📭 No wallets found. Add one with: stellar-alerts-cli wallet add <publicKey>'));
          return;
        }

        console.log(chalk.blue(`\n📋 Watched Wallets (${wallets.length})\n`));
        console.log(chalk.gray('─'.repeat(80)));
        console.log(
          chalk.bold(
            'ID'.padEnd(28) +
            'Public Key'.padEnd(60) +
            'Label'.padEnd(20) +
            'Created'
          )
        );
        console.log(chalk.gray('─'.repeat(80)));

        for (const w of wallets) {
          console.log(
            `${chalk.cyan(w.id.padEnd(28))}` +
            `${w.publicKey.padEnd(60)}` +
            `${(w.label || '-').padEnd(20)}` +
            `${chalk.gray(new Date(w.createdAt).toLocaleDateString())}`
          );
        }

        console.log(chalk.gray('─'.repeat(80)));
        console.log('');
      } catch (error) {
        console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });

  wallet
    .command('remove')
    .alias('rm')
    .description('Remove a watched wallet')
    .argument('<id>', 'Wallet ID to remove')
    .option('-t, --token <token>', 'API authentication token')
    .action(async (id: string, options: { token?: string }) => {
      try {
        if (options.token) {
          apiClient['apiKey'] = options.token;
        }

        console.log(chalk.blue('🔄 Removing wallet...'));
        await apiClient.deleteWallet(id);
        console.log(chalk.green(`✅ Wallet ${chalk.cyan(id)} removed successfully!`));
      } catch (error) {
        console.error(chalk.red(`❌ Error: ${(error as Error).message}`));
        process.exit(1);
      }
    });
}
