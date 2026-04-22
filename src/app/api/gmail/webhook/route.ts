import { NextRequest, NextResponse } from "next/server";

// Gmail push notification handler (Phase 1+)
// For now, just acknowledge the notification
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("Gmail push notification received:", body);
    // TODO Phase 1: decode the Pub/Sub message and trigger email processing
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
