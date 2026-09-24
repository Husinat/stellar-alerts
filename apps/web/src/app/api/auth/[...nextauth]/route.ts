import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

type AuthUser = { accessToken?: string; id: string; name?: string | null; email?: string | null };

const nextAuthSecret = process.env.NEXTAUTH_SECRET || "development-fallback-secret-key-12345";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

async function validateMagicLink(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/verify?token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const data = await res.json();

    if (data.success && data.token && data.user) {
      return { id: data.user.id, name: data.user.email, email: data.user.email, accessToken: data.token } as AuthUser;
    }
  } catch (e) {
    console.error('API Verification error', e);
  }
  return null;
}

async function validateDIDSession(token: string): Promise<AuthUser | null> {
  try {
    // The DID verify endpoint mints a session JWT directly; prove it is valid
    // by loading the authenticated profile (#270).
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success || !data.user) return null;
    return {
      id: data.user.id,
      name: data.user.email,
      email: data.user.email,
      accessToken: token,
    } as AuthUser;
  } catch (e) {
    console.error('DID session validation error', e);
  }
  return null;
}

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Magic Link / Wallet DID',
      credentials: {
        token: { label: "Token", type: "text", placeholder: "Session Token" },
        mode: { label: "Mode", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) return null;
        if (credentials.mode === 'did') {
          return validateDIDSession(credentials.token);
        }
        return validateMagicLink(credentials.token);
      }
    })
  ],
  pages: {
    signIn: '/auth/signin',
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as AuthUser).accessToken;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.accessToken = token.accessToken;
        if (session.user) {
          session.user.id = token.id;
        }
      }
      return session;
    }
  },
  secret: nextAuthSecret,
});

export { handler as GET, handler as POST };