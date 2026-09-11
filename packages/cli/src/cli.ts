#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerWalletCommands } from './commands/wallet.js';
import { registerStreamCommands } from './commands/stream.js';

const program = new Command();

program
  .name('stellar-alerts-cli')
  .description('CLI tool for managing Stellar Alerts wallets and streams')
  .version('1.0.0')
  .option('-u, --api-url <url>', 'API base URL', process.env.STELLAR_ALERTS_API_URL || 'http://localhost:3001');

// Register command groups
registerWalletCommands(program);
registerStreamCommands(program);

// Health check command
program
  .command('health')
  .description('Check API health status')
  .action(async () => {
    try {
      const response = await fetch(`${program.opts().apiUrl}/health`);
      if (response.ok) {
        const data = await response.json();
        console.log(chalk.green(`✅ API is healthy: ${JSON.stringify(data)}`));
      } else {
        console.log(chalk.red(`❌ API returned status: ${response.status}`));
        process.exit(1);
      }
    } catch (error) {
      console.log(chalk.red(`❌ API is not reachable: ${(error as Error).message}`));
      process.exit(1);
    }
  });

// Error handling
program.on('command:*', (operands) => {
  console.error(chalk.red(`❌ Unknown command: ${operands[0]}`));
  console.log('Run --help to see available commands');
  process.exit(1);
});

program.parse(process.argv);
