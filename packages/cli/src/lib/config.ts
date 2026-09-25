import { cliEnvSchema, CliEnv, validateProcessEnv, printStartupDiagnostics } from '@stellar-alerts/shared';

let cachedCliConfig: CliEnv | null = null;

export function getCliConfig(): CliEnv {
  if (!cachedCliConfig) {
    cachedCliConfig = validateProcessEnv(cliEnvSchema, process.env, 'cli', {
      isProduction: false,
    });
  }
  return cachedCliConfig;
}

export function printCliDiagnostics(): string {
  return printStartupDiagnostics('cli', getCliConfig());
}
