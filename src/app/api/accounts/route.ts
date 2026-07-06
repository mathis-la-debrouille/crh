import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const EDITABLE = ["label", "displayName", "signature", "language", "styleNotes", "workContext", "inboxWatchEnabled", "isPrimary"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accounts = await prisma.emailAccount.findMany({
    where: { userId: session.userId },
    select: {
      id: true, email: true, label: true, isPrimary: true, connected: true,
      displayName: true, signature: true, language: true, styleNotes: true,
      workContext: true, inboxWatchEnabled: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(accounts);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const account = await prisma.emailAccount.findFirst({
    where: { id: body.id, userId: session.userId },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  for (const field of EDITABLE) {
    if (field in body) data[field] = body[field];
  }

  // Validate label
  if (data.label !== undefined) {
    const label = data.label as string;
    if (!/^[a-z0-9-]{2,20}$/.test(label)) {
      return NextResponse.json({ error: "Label must be 2–20 chars, lowercase letters, digits, hyphens" }, { status: 400 });
    }
    const conflict = await prisma.emailAccount.findFirst({
      where: { userId: session.userId, label, id: { not: body.id } },
    });
    if (conflict) return NextResponse.json({ error: "Label already in use" }, { status: 409 });
  }

  // Setting isPrimary=true clears it on all other accounts (in a transaction)
  if (data.isPrimary === true) {
    await prisma.$transaction([
      prisma.emailAccount.updateMany({
        where: { userId: session.userId, id: { not: body.id } },
        data: { isPrimary: false },
      }),
      prisma.emailAccount.update({ where: { id: body.id }, data }),
    ]);
  } else {
    await prisma.emailAccount.update({ where: { id: body.id }, data });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const account = await prisma.emailAccount.findFirst({
    where: { id, userId: session.userId },
  });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (account.isPrimary) {
    return NextResponse.json({ error: "Make another account primary first" }, { status: 400 });
  }

  // Soft disconnect + token revocation
  await prisma.emailAccount.update({
    where: { id },
    data: { connected: false, accessToken: null, refreshToken: null, tokenExpiry: null },
  });

  if (account.accessToken) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${account.accessToken}`, { method: "POST" })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
