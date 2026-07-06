import "next-auth";

declare module "next-auth" {
  interface Session {
    userId: string;
    userStatus: string; // "active" | "pending" | "suspended"
    isAdmin: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    dbUserId?: string;
    status?: string;
  }
}
