import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerWalletCommands } from './wallet.js';

// Mock the API client
vi.mock('../lib/api.js', () => ({
  apiClient: {
    addWallet: vi.fn(),
    getWallets: vi.fn(),
    deleteWallet: vi.fn(),
    getPayments: vi.fn(),
    streamPayments: vi.fn(),
  },
}));

describe('Wallet Commands', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerWalletCommands(program);
  });

  it('should have wallet command group', () => {
    const walletCmd = program.commands.find(cmd => cmd.name() === 'wallet');
    expect(walletCmd).toBeDefined();
    expect(walletCmd!.description()).toBe('Manage watched Stellar wallets');
  });

  it('should have add subcommand with required publicKey argument', () => {
    const walletCmd = program.commands.find(cmd => cmd.name() === 'wallet');
    const addCmd = walletCmd!.commands.find(cmd => cmd.name() === 'add');

    expect(addCmd).toBeDefined();
    expect(addCmd!.description()).toBe('Add a new wallet to watch');

    // Check that publicKey is a required argument
    const args = addCmd!._args;
    expect(args).toHaveLength(1);
    expect(args[0].required).toBe(true);
    expect(args[0].name()).toBe('publicKey');
  });

  it('should have list subcommand', () => {
    const walletCmd = program.commands.find(cmd => cmd.name() === 'wallet');
    const listCmd = walletCmd!.commands.find(cmd => cmd.name() === 'list');

    expect(listCmd).toBeDefined();
    expect(listCmd!.description()).toBe('List all watched wallets');
  });

  it('should have remove subcommand with alias rm', () => {
    const walletCmd = program.commands.find(cmd => cmd.name() === 'wallet');
    const removeCmd = walletCmd!.commands.find(cmd => cmd.name() === 'remove');

    expect(removeCmd).toBeDefined();
    expect(removeCmd!.description()).toBe('Remove a watched wallet');
    expect(removeCmd!._aliases).toContain('rm');
  });

  it('should have label option for add command', () => {
    const walletCmd = program.commands.find(cmd => cmd.name() === 'wallet');
    const addCmd = walletCmd!.commands.find(cmd => cmd.name() === 'add');

    const options = addCmd!.options;
    const labelOption = options.find((o: any) => o.short === '-l');
    expect(labelOption).toBeDefined();
  });

  it('should have token option for add command', () => {
    const walletCmd = program.commands.find(cmd => cmd.name() === 'wallet');
    const addCmd = walletCmd!.commands.find(cmd => cmd.name() === 'add');

    const options = addCmd!.options;
    const tokenOption = options.find((o: any) => o.short === '-t');
    expect(tokenOption).toBeDefined();
  });
});
