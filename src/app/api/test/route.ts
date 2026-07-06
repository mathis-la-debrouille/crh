import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const log: string[] = [];

  try {
    log.push("1: entered");

    const session = await getServerSession(authOptions);
    log.push(`2: session userId=${session?.userId ?? "none"}`);
    if (!session?.userId) return NextResponse.json({ log, error: "no session" });

    const rows = await prisma.$queryRaw<{ googleAccessToken: string; googleTokenExpiry: string }[]>`
      SELECT googleAccessToken, googleTokenExpiry FROM User WHERE id = ${session.userId} LIMIT 1
    `;
    log.push(`3: db ok, token length=${rows[0]?.googleAccessToken?.length ?? 0}, expiry=${rows[0]?.googleTokenExpiry}`);

    const token = rows[0]?.googleAccessToken;
    if (!token) return NextResponse.json({ log, error: "no token" });

    log.push("4: calling gmail API directly");
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&labelIds=INBOX",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    log.push(`5: gmail status=${res.status}`);

    if (res.status === 401) {
      log.push("6: token expired — need refresh");
      return NextResponse.json({ log, error: "token_expired", gmailResponse: data });
    }

    log.push("6: gmail ok");
    return NextResponse.json({ log, gmailResponse: data });
  } catch (err) {
    log.push(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ log, error: "exception" }, { status: 500 });
  }
}
