import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/google";
import type { PaginatedEmails, EmailItem } from "@/types/api";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  console.log("[gmail] 1 - route entered");

  const session = await getServerSession(authOptions);
  console.log("[gmail] 2 - session:", session?.userId);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageToken = req.nextUrl.searchParams.get("pageToken") ?? undefined;

  try {
    console.log("[gmail] 3 - getting access token");
    const accessToken = await getValidAccessToken(session.userId);
    console.log("[gmail] 4 - got token, listing messages");

    const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    listUrl.searchParams.set("maxResults", String(PAGE_SIZE));
    listUrl.searchParams.set("labelIds", "INBOX");
    if (pageToken) listUrl.searchParams.set("pageToken", pageToken);

    const listRes = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listRes.ok) {
      const err = await listRes.json();
      throw new Error(err?.error?.message ?? `Gmail list failed: ${listRes.status}`);
    }

    const listData = await listRes.json();
    const messages: { id: string }[] = listData.messages ?? [];
    console.log(`[gmail] 5 - got ${messages.length} message IDs`);

    const emails: EmailItem[] = await Promise.all(
      messages.map(async (msg) => {
        const detailRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!detailRes.ok) return { id: msg.id, from: "", subject: "", date: "", snippet: "" };
        const detail = await detailRes.json();
        const headers: { name: string; value: string }[] = detail.payload?.headers ?? [];
        const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
        return {
          id: msg.id,
          from: get("from"),
          subject: get("subject"),
          date: get("date"),
          snippet: detail.snippet ?? "",
        };
      })
    );

    console.log(`[gmail] 6 - done, returning ${emails.length} emails`);
    const result: PaginatedEmails = { emails, nextPageToken: listData.nextPageToken ?? null };
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[gmail] ERROR:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
