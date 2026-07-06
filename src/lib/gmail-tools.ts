export interface DraftResult {
  id: string;
  threadId?: string;
}

export async function draftEmail(
  accessToken: string,
  {
    to,
    subject,
    body,
    replyToMessageId,
  }: {
    to: string;
    subject: string;
    body: string;
    replyToMessageId?: string;
  }
): Promise<DraftResult> {
  let threadId: string | undefined;
  let inReplyTo: string | undefined;
  let references: string | undefined;

  if (replyToMessageId) {
    const origRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${replyToMessageId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (origRes.ok) {
      const orig = await origRes.json();
      threadId = orig.threadId;
      const headers: { name: string; value: string }[] = orig.payload?.headers ?? [];
      const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
      const msgId = get("message-id");
      const refs = get("references");
      if (msgId) {
        inReplyTo = msgId;
        references = refs ? `${refs} ${msgId}` : msgId;
      }
    }
  }

  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", body);

  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
  const message: Record<string, unknown> = { raw };
  if (threadId) message.threadId = threadId;

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("[gmail] draft error:", JSON.stringify(err));
    throw new Error(err?.error?.message ?? `Draft creation failed: ${res.status}`);
  }

  const data = await res.json();
  return { id: data.id, threadId: data.message?.threadId };
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface EmailFull extends EmailSummary {
  to: string;
  body: string;
}

export async function searchEmails(
  accessToken: string,
  query: string,
  maxResults = 5
): Promise<EmailSummary[]> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(maxResults, 10)));

  const listRes = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!listRes.ok) {
    const err = await listRes.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gmail search failed: ${listRes.status}`);
  }

  const listData = await listRes.json();
  const messages: { id: string }[] = listData.messages ?? [];

  const results = await Promise.all(
    messages.map(async (msg) => {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) return null;
      const detail = await res.json();
      const headers: { name: string; value: string }[] = detail.payload?.headers ?? [];
      const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
      return {
        id: msg.id,
        from: get("from"),
        subject: get("subject"),
        date: get("date"),
        snippet: detail.snippet ?? "",
      };
    })
  );

  return results.filter((r): r is EmailSummary => r !== null);
}

function extractBody(payload: Record<string, unknown>): string {
  const body = payload.body as { data?: string } | undefined;
  if (body?.data) {
    return Buffer.from(body.data, "base64url").toString("utf-8");
  }
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (parts) {
    for (const part of parts) {
      if ((part.mimeType as string) === "text/plain") {
        const text = extractBody(part);
        if (text) return text;
      }
    }
    for (const part of parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }
  return "";
}

export async function readEmail(accessToken: string, emailId: string): Promise<EmailFull> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${emailId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gmail read failed: ${res.status}`);
  }

  const data = await res.json();
  const headers: { name: string; value: string }[] = data.payload?.headers ?? [];
  const get = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";

  return {
    id: emailId,
    from: get("from"),
    to: get("to"),
    subject: get("subject"),
    date: get("date"),
    snippet: data.snippet ?? "",
    body: extractBody(data.payload ?? {}).slice(0, 8000),
  };
}
