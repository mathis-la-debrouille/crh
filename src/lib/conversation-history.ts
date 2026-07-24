export interface HistoryMessage {
  direction: string; // "inbound" | "outbound"
  body: string;
  timestamp: Date | string;
}

export interface ApiChatMessage {
  role: "user" | "assistant";
  content: string;
}

function stampFor(timestamp: Date | string, tz: string): string {
  return new Date(timestamp).toLocaleString("fr-FR", {
    timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// Builds the alternating-role message array sent to Claude: every history line is
// timestamp-prefixed (so the agent can tell "described in the past" from "now"),
// consecutive same-role messages are merged with each keeping its own prefix on its
// own line, and the current inbound message is appended unprefixed (its time = "now").
export function buildStampedMessages(
  history: HistoryMessage[],
  currentBody: string,
  tz: string,
): ApiChatMessage[] {
  const messages: ApiChatMessage[] = [];

  for (const msg of history) {
    const role: "user" | "assistant" = msg.direction === "inbound" ? "user" : "assistant";
    const stamped = `[${stampFor(msg.timestamp, tz)}] ${msg.body}`;
    const last = messages[messages.length - 1];
    if (last?.role === role) {
      last.content += `\n${stamped}`;
    } else {
      messages.push({ role, content: stamped });
    }
  }

  const last = messages[messages.length - 1];
  if (last?.role === "user") {
    last.content += `\n${currentBody}`;
  } else {
    messages.push({ role: "user", content: currentBody });
  }

  return messages;
}
