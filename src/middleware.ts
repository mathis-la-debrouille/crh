import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const { pathname } = req.nextUrl;

    // Block suspended accounts everywhere
    if (token?.status === "suspended") {
      return NextResponse.redirect(new URL("/signup?error=suspended", req.url));
    }

    // Admin routes: only ADMIN_EMAIL
    if (pathname.startsWith("/admin")) {
      const adminEmail = process.env.ADMIN_EMAIL ?? "mathis.laurent.3m@gmail.com";
      if (token?.email !== adminEmail) {
        return NextResponse.redirect(new URL("/dashboard", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*", "/metrics/:path*", "/admin/:path*"],
};
