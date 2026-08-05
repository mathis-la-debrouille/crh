import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendWhatsApp(to: string, body: string) {
  return client.messages.create({
    from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
    to: `whatsapp:${to}`,
    body,
  });
}

export { client as twilioClient };

// Best-effort WhatsApp "typing…" indicator (Twilio Public Beta). Never throws,
// never blocks the caller — callers fire this without awaiting it.
export async function sendTypingIndicator(messageSid: string): Promise<void> {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) return;

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch("https://messaging.twilio.com/v3/Indicators/Typing.json", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: "WHATSAPP", messageId: messageSid }),
    });
    if (!res.ok) {
      console.warn(`[twilio] typing indicator failed: ${res.status}`);
    }
  } catch (err) {
    console.warn("[twilio] typing indicator error:", err instanceof Error ? err.message : err);
  }
}
