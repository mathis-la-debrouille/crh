import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          access_type: "offline",
          prompt: "consent",
          scope: [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.labels",
            "https://www.googleapis.com/auth/calendar.readonly",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return false;

      // Upsert user and store Google tokens in DB
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          image: user.image,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token ?? undefined,
          googleTokenExpiry: account.expires_at
            ? new Date(account.expires_at * 1000)
            : undefined,
          googleConnected: true,
        },
        create: {
          email: user.email,
          name: user.name,
          image: user.image,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token,
          googleTokenExpiry: account.expires_at
            ? new Date(account.expires_at * 1000)
            : undefined,
          googleConnected: true,
        },
      });

      return true;
    },

    async jwt({ token, account, user }) {
      // On first sign-in, account and user are present — look up the DB id by email
      if (account && user?.email) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;

        // Fetch the cuid-based DB id (token.sub is Google's user id, not ours)
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true },
        });
        token.dbUserId = dbUser?.id;
      }
      return token;
    },

    async session({ session, token }) {
      // Use the DB id (cuid), not the Google sub
      session.userId = token.dbUserId as string;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  session: {
    strategy: "jwt",
  },
};
