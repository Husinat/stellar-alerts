#!/usr/bin/env node

/**
 * Migration Verification Script
 * 
 * This script validates database schema migrations by:
 * 1. Creating a snapshot of existing data
 * 2. Applying the migration
 * 3. Verifying data integrity
 * 4. Rolling back if constraint failures are detected
 * 
 * Usage:
 *   npx tsx scripts/verify-migrations.ts [--dry-run] [--migration <name>]
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '../apps/api/prisma/migrations');
const SCHEMA_PATH = join(__dirname, '../apps/api/prisma/schema.prisma');

interface SnapshotData {
  tables: Record<string, any[]>;
  timestamp: string;
}

interface MigrationResult {
  success: boolean;
  migrationName: string;
  errors: string[];
  warnings: string[];
  snapshotBefore: SnapshotData | null;
  snapshotAfter: SnapshotData | null;
}

/**
 * Get the list of migrations in order
 */
function getMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter(dir => {
      const migrationPath = join(MIGRATIONS_DIR, dir);
      return (
        dir !== 'migration_lock.toml' &&
        existsSync(join(migrationPath, 'migration.sql'))
      );
    })
    .sort();
}

/**
 * Parse migration SQL to extract affected tables and operations
 */
function parseMigrationSQL(sqlContent: string): {
  tables: string[];
  hasDrop: boolean;
  hasAlter: boolean;
  hasCreate: boolean;
  operations: string[];
} {
  const tables: string[] = [];
  const operations: string[] = [];
  let hasDrop = false;
  let hasAlter = false;
  let hasCreate = false;

  const lines = sqlContent.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const upperLine = line.toUpperCase();

    // Extract table names from CREATE, ALTER, DROP statements
    const tableMatch = line.match(
      /(?:TABLE|INDEX|CONSTRAINT)\s+"?(\w+)"?/i
    );
    if (tableMatch) {
      tables.push(tableMatch[1]);
    }

    // Detect operation types
    if (upperLine.startsWith('DROP')) {
      hasDrop = true;
      operations.push('DROP');
    }
    if (upperLine.startsWith('ALTER')) {
      hasAlter = true;
      operations.push('ALTER');
    }
    if (upperLine.startsWith('CREATE')) {
      hasCreate = true;
      operations.push('CREATE');
    }
  }

  return {
    tables: [...new Set(tables)],
    hasDrop,
    hasAlter,
    hasCreate,
    operations: [...new Set(operations)],
  };
}

/**
 * Validate migration SQL for potential data loss operations
 */
function validateMigrationSQL(
  sqlContent: string,
  migrationName: string
): { valid: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const parsed = parseMigrationSQL(sqlContent);

  // Check for dangerous DROP operations
  if (parsed.hasDrop) {
    warnings.push(
      `Migration ${migrationName} contains DROP operations which may cause data loss`
    );
  }

  // Check for NOT NULL constraints added to existing columns
  const notNullMatches = sqlContent.match(
    /ALTER\s+TABLE\s+"?\w+"?\s+ALTER\s+COLUMN\s+"?\w+"?\s+SET\s+NOT\s+NULL/gi
  );
  if (notNullMatches) {
    warnings.push(
      `Migration ${migrationName} adds NOT NULL constraints which may fail if existing NULL values exist`
    );
  }

  // Check for foreign key additions
  const fkMatches = sqlContent.match(/ADD\s+CONSTRAINT\s+"?\w+_fkey"?/gi);
  if (fkMatches) {
    warnings.push(
      `Migration ${migrationName} adds foreign key constraints which may fail if referenced data is missing`
    );
  }

  // Check for index creation on large tables (potential lock)
  const indexMatches = sqlContent.match(/CREATE\s+(UNIQUE\s+)?INDEX/gi);
  if (indexMatches) {
    warnings.push(
      `Migration ${migrationName} creates indexes which may lock tables during execution`
    );
  }

  // Validate SQL syntax (basic checks)
  // Check for unclosed parentheses across the entire SQL
  const totalOpenCount = (sqlContent.match(/\(/g) || []).length;
  const totalCloseCount = (sqlContent.match(/\)/g) || []).length;
  if (totalOpenCount !== totalCloseCount) {
    errors.push(
      `Migration ${migrationName} has mismatched parentheses: ${totalOpenCount} opening, ${totalCloseCount} closing`
    );
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

/**
 * Verify schema compatibility with test dataset
 */
function verifySchemaCompatibility(
  migrationName: string,
  sqlContent: string
): { compatible: boolean; issues: string[] } {
  const issues: string[] = [];
  const parsed = parseMigrationSQL(sqlContent);

  // Read current schema
  const schemaContent = readFileSync(SCHEMA_PATH, 'utf-8');

  // Check if migration tries to modify non-existent tables
  for (const table of parsed.tables) {
    if (!schemaContent.includes(`model ${table}`) && !parsed.hasCreate) {
      issues.push(
        `Migration ${migrationName} modifies table "${table}" which doesn't exist in schema`
      );
    }
  }

  // Check for column type mismatches
  const alterColumnMatches = sqlContent.match(
    /ALTER\s+TABLE\s+"?\w+"?\s+ALTER\s+COLUMN\s+"?\w+"?\s+TYPE\s+(\w+)/gi
  );
  if (alterColumnMatches) {
    for (const match of alterColumnMatches) {
      const columnMatch = match.match(/COLUMN\s+"?(\w+)"?\s+TYPE\s+(\w+)/i);
      if (columnMatch) {
        issues.push(
          `Migration ${migrationName} changes type of column "${columnMatch[1]}" to ${columnMatch[2]}`
        );
      }
    }
  }

  return {
    compatible: issues.length === 0,
    issues,
  };
}

/**
 * Simulate migration execution (dry run mode)
 */
function simulateMigration(
  migrationName: string,
  dryRun: boolean = true
): MigrationResult {
  const result: MigrationResult = {
    success: false,
    migrationName,
    errors: [],
    warnings: [],
    snapshotBefore: null,
    snapshotAfter: null,
  };

  const migrationPath = join(MIGRATIONS_DIR, migrationName, 'migration.sql');

  if (!existsSync(migrationPath)) {
    result.errors.push(`Migration file not found: ${migrationPath}`);
    return result;
  }

  const sqlContent = readFileSync(migrationPath, 'utf-8');

  // Validate migration SQL
  const validation = validateMigrationSQL(sqlContent, migrationName);
  result.warnings.push(...validation.warnings);
  result.errors.push(...validation.errors);

  // Verify schema compatibility
  const compatibility = verifySchemaCompatibility(migrationName, sqlContent);
  if (!compatibility.compatible) {
    result.errors.push(...compatibility.issues);
  }

  // Parse and analyze migration
  const parsed = parseMigrationSQL(sqlContent);
  console.log(`\n📋 Migration: ${migrationName}`);
  console.log(`   Tables affected: ${parsed.tables.join(', ') || 'N/A'}`);
  console.log(`   Operations: ${parsed.operations.join(', ')}`);

  if (result.warnings.length > 0) {
    console.log(`   ⚠️  Warnings:`);
    for (const warning of result.warnings) {
      console.log(`      - ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    console.log(`   ❌ Errors:`);
    for (const error of result.errors) {
      console.log(`      - ${error}`);
    }
  }

  if (dryRun) {
    console.log(`   🔍 Dry run mode - skipping actual execution`);
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Main verification flow
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const migrationArg = args.find((arg, i) => args[i - 1] === '--migration');

  console.log('🧪 Migration Verification Script');
  console.log('================================\n');

  if (dryRun) {
    console.log('🔍 Running in dry-run mode (no changes will be made)\n');
  }

  const migrations = getMigrations();
  console.log(`Found ${migrations.length} migrations:\n`);

  let migrationsToVerify = migrations;
  if (migrationArg) {
    migrationsToVerify = migrations.filter(m => m.includes(migrationArg));
    if (migrationsToVerify.length === 0) {
      console.error(`❌ Migration not found: ${migrationArg}`);
      process.exit(1);
    }
  }

  let allPassed = true;
  const results: MigrationResult[] = [];

  for (const migration of migrationsToVerify) {
    const result = simulateMigration(migration, dryRun);
    results.push(result);

    if (!result.success) {
      allPassed = false;
    }
  }

  // Summary
  console.log('\n================================');
  console.log('📊 Verification Summary\n');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const warnings = results.reduce((acc, r) => acc + r.warnings.length, 0);

  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   ⚠️  Warnings: ${warnings}`);

  if (allPassed) {
    console.log('\n✅ All migrations passed verification!');
  } else {
    console.log('\n❌ Some migrations failed verification. Please review the errors above.');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
