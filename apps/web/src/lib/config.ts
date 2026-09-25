import { webEnvSchema, WebEnv, validateProcessEnv, printStartupDiagnostics } from '@stellar-alerts/shared';

let cachedWebConfig: WebEnv | null = null;

export function getWebConfig(): WebEnv {
  if (!cachedWebConfig) {
    cachedWebConfig = validateProcessEnv(
      webEnvSchema,
      {
        NODE_ENV: process.env.NODE_ENV,
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
      },
      'web',
      { isProduction: process.env.NODE_ENV === 'production' },
    );
  }
  return cachedWebConfig;
}

export function printWebDiagnostics(): string {
  return printStartupDiagnostics('web', getWebConfig());
}
