import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerStreamCommands } from './stream.js';

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

describe('Stream Commands', () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerStreamCommands(program);
  });

  it('should have stream command group', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    expect(streamCmd).toBeDefined();
    expect(streamCmd!.description()).toBe('Watch real-time payment streams');
  });

  it('should have watch subcommand', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    const watchCmd = streamCmd!.commands.find(cmd => cmd.name() === 'watch');

    expect(watchCmd).toBeDefined();
    expect(watchCmd!.description()).toBe('Watch real-time payment feed');
  });

  it('should have history subcommand', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    const historyCmd = streamCmd!.commands.find(cmd => cmd.name() === 'history');

    expect(historyCmd).toBeDefined();
    expect(historyCmd!.description()).toBe('Show recent payment history');
  });

  it('should have wallet filter option for watch command', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    const watchCmd = streamCmd!.commands.find(cmd => cmd.name() === 'watch');

    const options = watchCmd!.options;
    const walletOption = options.find((o: any) => o.short === '-w');
    expect(walletOption).toBeDefined();
  });

  it('should have token option for watch command', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    const watchCmd = streamCmd!.commands.find(cmd => cmd.name() === 'watch');

    const options = watchCmd!.options;
    const tokenOption = options.find((o: any) => o.short === '-t');
    expect(tokenOption).toBeDefined();
  });

  it('should have limit option for history command', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    const historyCmd = streamCmd!.commands.find(cmd => cmd.name() === 'history');

    const options = historyCmd!.options;
    const limitOption = options.find((o: any) => o.short === '-l');
    expect(limitOption).toBeDefined();
  });

  it('should have default limit value for history command', () => {
    const streamCmd = program.commands.find(cmd => cmd.name() === 'stream');
    const historyCmd = streamCmd!.commands.find(cmd => cmd.name() === 'history');

    const options = historyCmd!.options;
    const limitOption = options.find((o: any) => o.short === '-l');
    expect(limitOption?.defaultValue).toBe('20');
  });
});
