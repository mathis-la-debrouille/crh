import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "mathis.laurent.3m@gmail.com";

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
            "https://www.googleapis.com/auth/gmail.compose",
            "https://www.googleapis.com/auth/calendar",
          ].join(" "),
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return false;

      const email = user.email;
      const tokenExpiry = account.expires_at ? new Date(account.expires_at * 1000) : null;

      console.log(`[auth] signIn: email=${email}`);

      // ── 1. Primary account: existing active user ─────────────────────────────
      const primaryUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, status: true },
      });

      if (primaryUser?.status === "active") {
        console.log(`[auth] signIn: active primary user id=${primaryUser.id}`);
        await prisma.user.update({
          where: { id: primaryUser.id },
          data: {
            name: user.name,
            image: user.image,
            googleAccessToken: account.access_token,
            googleRefreshToken: account.refresh_token ?? undefined,
            googleTokenExpiry: tokenExpiry,
            googleConnected: true,
          },
        });
        await prisma.emailAccount.upsert({
          where: { userId_email: { userId: primaryUser.id, email } },
          update: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? undefined,
            tokenExpiry,
            connected: true,
          },
          create: {
            userId: primaryUser.id,
            email,
            label: "principal",
            isPrimary: true,
            provider: "google",
            connected: true,
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? null,
            tokenExpiry,
          },
        });
        return true;
      }

      // ── 2. Secondary email: already linked to an active user ─────────────────
      const linkedAccount = await prisma.emailAccount.findFirst({
        where: { email },
        include: { user: { select: { id: true, status: true } } },
      });

      if (linkedAccount?.user?.status === "active") {
        console.log(`[auth] signIn: secondary email for user id=${linkedAccount.user.id}`);
        await prisma.emailAccount.update({
          where: { id: linkedAccount.id },
          data: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? linkedAccount.refreshToken,
            tokenExpiry,
            connected: true,
          },
        });
        return true;
      }

      // ── 3. Pending primary user → check OTP cookie ───────────────────────────
      if (primaryUser?.status === "pending") {
        const cookieStore = await cookies();
        const signupToken = cookieStore.get("vayt-signup-token")?.value;
        console.log(`[auth] signIn: pending user — cookie=${!!signupToken}`);
        if (!signupToken) return "/signup?error=phone_required";

        const otp = await prisma.otpCode.findUnique({ where: { sessionToken: signupToken } });
        if (!otp || !otp.used || otp.expiresAt <= new Date()) {
          console.warn(`[auth] signIn: invalid OTP`);
          return "/signup?error=phone_expired";
        }
        await prisma.otpCode.update({ where: { id: otp.id }, data: { expiresAt: new Date() } });

        await prisma.user.update({
          where: { id: primaryUser.id },
          data: {
            name: user.name,
            image: user.image,
            googleAccessToken: account.access_token,
            googleRefreshToken: account.refresh_token ?? undefined,
            googleTokenExpiry: tokenExpiry,
            googleConnected: true,
            status: "active",
            whatsappNumber: otp.phone,
            phoneVerified: true,
          },
        });
        await prisma.emailAccount.upsert({
          where: { userId_email: { userId: primaryUser.id, email } },
          update: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? undefined,
            tokenExpiry,
            connected: true,
          },
          create: {
            userId: primaryUser.id,
            email,
            label: "principal",
            isPrimary: true,
            provider: "google",
            connected: true,
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? null,
            tokenExpiry,
          },
        });
        console.log(`[auth] signIn: pending→active phone=${otp.phone}`);
        return true;
      }

      // ── 4. Brand new user → check OTP cookie ────────────────────────────────
      const cookieStore = await cookies();
      const signupToken = cookieStore.get("vayt-signup-token")?.value;
      console.log(`[auth] signIn: new user — cookie=${!!signupToken} email=${email}`);
      if (!signupToken) return "/signup?error=phone_required";

      const otp = await prisma.otpCode.findUnique({ where: { sessionToken: signupToken } });
      if (!otp || !otp.used || otp.expiresAt <= new Date()) {
        console.warn(`[auth] signIn: invalid OTP for new user`);
        return "/signup?error=phone_expired";
      }
      await prisma.otpCode.update({ where: { id: otp.id }, data: { expiresAt: new Date() } });

      const newUser = await prisma.user.upsert({
        where: { email },
        update: {
          name: user.name,
          image: user.image,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token ?? undefined,
          googleTokenExpiry: tokenExpiry,
          googleConnected: true,
          status: "active",
          whatsappNumber: otp.phone,
          phoneVerified: true,
        },
        create: {
          email,
          name: user.name,
          image: user.image,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token,
          googleTokenExpiry: tokenExpiry,
          googleConnected: true,
          status: "active",
          whatsappNumber: otp.phone,
          phoneVerified: true,
        },
      });

      await prisma.emailAccount.upsert({
        where: { userId_email: { userId: newUser.id, email } },
        update: {
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? undefined,
          tokenExpiry,
          connected: true,
          isPrimary: true,
        },
        create: {
          userId: newUser.id,
          email,
          label: "principal",
          isPrimary: true,
          provider: "google",
          connected: true,
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? null,
          tokenExpiry,
        },
      });

      console.log(`[auth] signIn: new user created id=${newUser.id} phone=${otp.phone}`);
      return true;
    },

    async jwt({ token, account, user }) {
      if (account && user?.email) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;

        // Try primary email first, then secondary linked account
        let dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, status: true },
        });

        if (!dbUser) {
          const linked = await prisma.emailAccount.findFirst({
            where: { email: user.email },
            include: { user: { select: { id: true, status: true } } },
          });
          dbUser = linked?.user ?? null;
        }

        token.dbUserId = dbUser?.id;
        token.status = dbUser?.status ?? "pending";
      }
      return token;
    },

    async session({ session, token }) {
      session.userId = token.dbUserId as string;
      session.userStatus = token.status as string;
      session.isAdmin = (token.email ?? "") === ADMIN_EMAIL;
      return session;
    },
  },
  pages: {
    signIn: "/signup",
    error: "/signup",
  },
  session: {
    strategy: "jwt",
  },
};

export { ADMIN_EMAIL };
