import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    user: {
      id?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    id?: string;
  }
}

/**
 * Merged shape of the NextAuth session plus our own JWT-backed fields that the
 * app reads directly (e.g. `session.accessToken` for the Authorization header).
 */
export type AppSession = DefaultSession & {
  accessToken?: string;
};