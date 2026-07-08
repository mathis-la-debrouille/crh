import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalisePhone } from "@/lib/otp";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || session.user.email !== ADMIN_EMAIL) return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const numbers = await prisma.allowedNumber.findMany({ orderBy: { createdAt: "desc" } });
  const users = await prisma.user.findMany({
    select: { email: true, name: true, status: true, phoneVerified: true, whatsappNumber: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ allowedNumbers: numbers, users });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { phone, note, action } = await req.json().catch(() => ({}));

  if (action === "remove") {
    if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });
    await prisma.allowedNumber.delete({ where: { phone: normalisePhone(phone) } }).catch(() => { });
    return NextResponse.json({ ok: true });
  }

  if (!phone || typeof phone !== "string") {
    return NextResponse.json({ error: "phone required" }, { status: 400 });
  }

  const normalised = normalisePhone(phone);
  if (!/^\+\d{7,15}$/.test(normalised)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  const entry = await prisma.allowedNumber.upsert({
    where: { phone: normalised },
    update: { note: note ?? undefined },
    create: { phone: normalised, note: note ?? undefined },
  });

  return NextResponse.json({ ok: true, entry });
}
