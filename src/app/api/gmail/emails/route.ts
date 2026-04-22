import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGmailClient } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import type { EmailItem } from "@/types/api";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.googleConnected) {
    return NextResponse.json(
      { error: "Google account not connected" },
      { status: 403 }
    );
  }

  try {
    const gmail = await getGmailClient(session.userId);

    const listRes = await gmail.users.messages.list({
      userId: "me",
      maxResults: 20,
      labelIds: ["INBOX"],
    });

    const messages = listRes.data.messages ?? [];

    const emails: EmailItem[] = await Promise.all(
      messages.map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });

        const headers = detail.data.payload?.headers ?? [];
        const get = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
            ?.value ?? "";

        return {
          id: msg.id!,
          from: get("From"),
          subject: get("Subject"),
          date: get("Date"),
          snippet: detail.data.snippet ?? "",
        };
      })
    );

    return NextResponse.json(emails);
  } catch (error) {
    console.error("Gmail API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch emails" },
      { status: 500 }
    );
  }
}
