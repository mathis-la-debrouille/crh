import { describe, it, expect, vi } from "vitest";

// classifyOne is pure — stub prisma so the module resolves without a DB
vi.mock("../src/lib/prisma", () => ({ prisma: {} }));
vi.mock("better-sqlite3", () => ({ default: vi.fn() }));

import { classifyOne } from "../src/lib/email-triage";
import type { EmailSummary } from "../src/lib/gmail-tools";

function make(overrides: Partial<EmailSummary> & { from: string; subject: string }): EmailSummary {
  return {
    id: "msg-1",
    from: overrides.from,
    subject: overrides.subject,
    date: "Mon, 7 Jul 2026 09:00:00 +0200",
    snippet: overrides.snippet ?? "",
    labelIds: overrides.labelIds ?? [],
    listUnsubscribe: overrides.listUnsubscribe ?? false,
    precedenceBulk: overrides.precedenceBulk ?? false,
  };
}

const NO_CONTACTS = new Set<string>();

describe("classifyOne", () => {
  it("noreply@twitch.tv without transactional words → notification/low", () => {
    const e = make({ from: "Twitch <noreply@twitch.tv>", subject: "Inoxtag est en live", snippet: "rejoin le stream" });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("notification");
    expect(r.priority).toBe("low");
  });

  it("Medium digest with listUnsubscribe=true → newsletter/low", () => {
    const e = make({ from: "Medium Daily Digest <noreply@medium.com>", subject: "Your daily reads", listUnsubscribe: true });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("newsletter");
    expect(r.priority).toBe("low");
  });

  it("automated@airbnb.com (not in NOISE_LOCALPARTS) — réservation subject, no listUnsubscribe → transactional", () => {
    const e = make({ from: "Airbnb <automated@airbnb.com>", subject: "Re: réservation Écusson", snippet: "votre réservation est confirmée" });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("transactional");
    expect(r.priority).toBe("normal");
  });

  it("automated@airbnb.com — réservation with urgent snippet → transactional/high", () => {
    const e = make({ from: "Airbnb <automated@airbnb.com>", subject: "Re: réservation Écusson", snippet: "action requise avant demain" });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("transactional");
    expect(r.priority).toBe("high");
  });

  it("sender in knownContactEmails → human/high even with CATEGORY_UPDATES label", () => {
    const e = make({
      from: "Marie Dupont <marie@example.com>",
      subject: "update sur le projet",
      labelIds: ["CATEGORY_UPDATES"],
    });
    const known = new Set(["marie@example.com"]);
    const r = classifyOne(e, known);
    expect(r.category).toBe("human");
    expect(r.priority).toBe("high");
  });

  it("unknown human sender, plain subject → human/normal", () => {
    const e = make({ from: "Jean Martin <jean@startup.io>", subject: "Re: notre réunion" });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("human");
    expect(r.priority).toBe("normal");
  });

  it("unknown human sender + 'avant demain' in snippet → human/high", () => {
    const e = make({ from: "Jean Martin <jean@startup.io>", subject: "Re: notre réunion", snippet: "peux-tu confirmer avant demain ?" });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("human");
    expect(r.priority).toBe("high");
  });

  it("CATEGORY_PROMOTIONS label → promo/low", () => {
    const e = make({ from: "Shop <promo@shop.com>", subject: "-50% ce week-end", labelIds: ["CATEGORY_PROMOTIONS"] });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("promo");
    expect(r.priority).toBe("low");
  });

  it("jobs@meta.com with noise subject → notification/low", () => {
    const e = make({ from: "Meta Careers <jobs@meta.com>", subject: "aucune nouvelle offre pour toi" });
    const r = classifyOne(e, NO_CONTACTS);
    expect(r.category).toBe("notification");
    expect(r.priority).toBe("low");
  });
});
