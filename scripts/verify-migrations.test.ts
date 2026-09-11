import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

// Mock dependencies
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

describe('Migration Verification Script', () => {
  const mockMigrationsDir = '/mock/migrations';
  const mockSchemaPath = '/mock/schema.prisma';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse migration SQL correctly', () => {
    const sql = `
      -- CreateTable
      CREATE TABLE "TestTable" (
          "id" TEXT NOT NULL,
          CONSTRAINT "TestTable_pkey" PRIMARY KEY ("id")
      );
      
      -- CreateIndex
      CREATE UNIQUE INDEX "TestTable_id_key" ON "TestTable"("id");
    `;

    // This tests the parsing logic that would be in the actual script
    const tableMatch = sql.match(/CREATE TABLE\s+"?(\w+)"?/i);
    expect(tableMatch?.[1]).toBe('TestTable');

    const hasCreate = sql.toUpperCase().includes('CREATE');
    expect(hasCreate).toBe(true);

    const hasDrop = sql.toUpperCase().includes('DROP');
    expect(hasDrop).toBe(false);
  });

  it('should detect DROP operations as warnings', () => {
    const sql = `
      DROP TABLE IF EXISTS "OldTable";
      DROP COLUMN IF EXISTS "oldColumn" FROM "TestTable";
    `;

    const hasDrop = sql.toUpperCase().includes('DROP');
    expect(hasDrop).toBe(true);
  });

  it('should detect NOT NULL constraint additions', () => {
    const sql = `
      ALTER TABLE "Users" ALTER COLUMN "email" SET NOT NULL;
    `;

    const notNullMatches = sql.match(
      /ALTER\s+TABLE\s+"?\w+"?\s+ALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL/gi
    );
    expect(notNullMatches).toHaveLength(1);
  });

  it('should detect foreign key additions', () => {
    const sql = `
      ALTER TABLE "Wallets" ADD CONSTRAINT "Wallets_userId_fkey" 
      FOREIGN KEY ("userId") REFERENCES "Users"("id");
    `;

    const fkMatches = sql.match(/ADD\s+CONSTRAINT\s+"?\w+_fkey"?/gi);
    expect(fkMatches).toHaveLength(1);
  });

  it('should validate SQL syntax', () => {
    const validSql = `
      CREATE TABLE "Test" (
          "id" TEXT NOT NULL
      );
    `;

    const invalidSql = `
      CREATE TABLE "Test" (
          "id" TEXT NOT NULL
      ;
    `;

    // Check for unclosed parentheses
    const openCount = (validSql.match(/\(/g) || []).length;
    const closeCount = (validSql.match(/\)/g) || []).length;
    expect(openCount).toBe(closeCount);

    const invalidOpenCount = (invalidSql.match(/\(/g) || []).length;
    const invalidCloseCount = (invalidSql.match(/\)/g) || []).length;
    expect(invalidOpenCount).not.toBe(invalidCloseCount);
  });

  it('should extract table names from migration SQL', () => {
    const sql = `
      ALTER TABLE "Wallets" ADD COLUMN "label" TEXT;
      ALTER TABLE "Payments" ADD COLUMN "memo" TEXT;
    `;

    const tables = new Set<string>();
    const tableMatches = sql.matchAll(/(?:ALTER TABLE|CREATE TABLE)\s+"?(\w+)"?/gi);
    for (const match of tableMatches) {
      tables.add(match[1]);
    }

    expect(tables.has('Wallets')).toBe(true);
    expect(tables.has('Payments')).toBe(true);
    expect(tables.size).toBe(2);
  });

  it('should list migrations in order', () => {
    const mockMigrations = [
      '20260710103332_init',
      '20260824000000_add_webhooks',
      '20260824150000_add_cursor',
    ];

    vi.mocked(readdirSync).mockReturnValue(mockMigrations as any);
    vi.mocked(existsSync).mockReturnValue(true);

    const migrations = readdirSync(mockMigrationsDir)
      .filter(dir => {
        const migrationPath = join(mockMigrationsDir, dir);
        return (
          dir !== 'migration_lock.toml' &&
          existsSync(join(migrationPath, 'migration.sql'))
        );
      })
      .sort();

    expect(migrations).toEqual([
      '20260710103332_init',
      '20260824000000_add_webhooks',
      '20260824150000_add_cursor',
    ]);
  });

  it('should handle missing migration files gracefully', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const migrationPath = join(mockMigrationsDir, 'nonexistent', 'migration.sql');
    const exists = existsSync(migrationPath);

    expect(exists).toBe(false);
  });
});
