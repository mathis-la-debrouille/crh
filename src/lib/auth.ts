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

      console.log(`[signup] signIn: email=${user.email} provider=${account.provider}`);

      // Check if this user already has an active account (existing users / re-auth)
      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, status: true },
      });

      console.log(`[signup] signIn: existing=${existing?.status ?? "none"}`);

      let phone: string | undefined;
      let status: "active" | "pending" = "pending";

      if (existing?.status === "active") {
        // Existing active user — just refresh tokens, no checks needed
        status = "active";
        console.log(`[signup] signIn: existing active user — refreshing tokens email=${user.email}`);
      } else if (existing?.status === "pending") {
        // Check for valid OTP session cookie
        const cookieStore = await cookies();
        const signupToken = cookieStore.get("vayt-signup-token")?.value;
        console.log(`[signup] signIn: pending user — cookie present=${!!signupToken}`);
        if (signupToken) {
          const otp = await prisma.otpCode.findUnique({
            where: { sessionToken: signupToken },
          });
          if (otp && otp.used && otp.expiresAt > new Date()) {
            phone = otp.phone;
            status = "active";
            console.log(`[signup] signIn: pending→active via OTP phone=${phone}`);
            // Consume the session token so it can't be reused
            await prisma.otpCode.update({ where: { id: otp.id }, data: { expiresAt: new Date() } });
          } else {
            console.warn(`[signup] signIn: OTP invalid or expired — otp.used=${otp?.used} expiresAt=${otp?.expiresAt}`);
          }
        }
        if (status !== "active") {
          console.warn(`[signup] signIn: denied — no valid OTP cookie email=${user.email}`);
          return "/signup?error=phone_required";
        }
      } else {
        // New user — must have a valid OTP cookie from the sign-up flow
        const cookieStore = await cookies();
        const signupToken = cookieStore.get("vayt-signup-token")?.value;
        console.log(`[signup] signIn: new user — cookie present=${!!signupToken} email=${user.email}`);
        if (!signupToken) {
          console.warn(`[signup] signIn: denied — no signup cookie for new user email=${user.email}`);
          return "/signup?error=phone_required";
        }

        const otp = await prisma.otpCode.findUnique({ where: { sessionToken: signupToken } });
        if (!otp || !otp.used || otp.expiresAt <= new Date()) {
          console.warn(`[signup] signIn: denied — expired/invalid OTP email=${user.email} otp=${!!otp}`);
          return "/signup?error=phone_expired";
        }

        phone = otp.phone;
        status = "active";
        console.log(`[signup] signIn: new user activated phone=${phone} email=${user.email}`);
        // Consume
        await prisma.otpCode.update({ where: { id: otp.id }, data: { expiresAt: new Date() } });
      }

      // Upsert user with status and phone
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          image: user.image,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token ?? undefined,
          googleTokenExpiry: account.expires_at ? new Date(account.expires_at * 1000) : undefined,
          googleConnected: true,
          ...(status === "active" ? { status: "active" } : {}),
          ...(phone ? { whatsappNumber: phone, phoneVerified: true } : {}),
        },
        create: {
          email: user.email,
          name: user.name,
          image: user.image,
          googleAccessToken: account.access_token,
          googleRefreshToken: account.refresh_token,
          googleTokenExpiry: account.expires_at ? new Date(account.expires_at * 1000) : undefined,
          googleConnected: true,
          status,
          whatsappNumber: phone,
          phoneVerified: !!phone,
        },
      });

      console.log(`[signup] signIn: upsert done — email=${user.email} status=${status}`);

      // Upsert primary EmailAccount so token is always current
      const dbUser2 = await prisma.user.findUnique({ where: { email: user.email }, select: { id: true } });
      if (dbUser2 && account.access_token) {
        const tokenExpiry = account.expires_at ? new Date(account.expires_at * 1000) : null;
        await prisma.emailAccount.upsert({
          where: { userId_email: { userId: dbUser2.id, email: user.email } },
          update: {
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? undefined,
            tokenExpiry,
            connected: true,
            isPrimary: true,
          },
          create: {
            userId: dbUser2.id,
            email: user.email,
            label: "principal",
            isPrimary: true,
            provider: "google",
            connected: true,
            accessToken: account.access_token,
            refreshToken: account.refresh_token ?? null,
            tokenExpiry,
          },
        });
      }

      return true;
    },

    async jwt({ token, account, user }) {
      if (account && user?.email) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;

        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true, status: true },
        });
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
