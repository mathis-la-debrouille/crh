import { prisma } from "@/lib/prisma";

export interface AccountInfo {
  id: string;
  email: string;
  label: string;
  isPrimary: boolean;
  connected: boolean;
  displayName: string | null;
  signature: string | null;
  language: string | null;
  styleNotes: string | null;
  workContext: string | null;
}

export class AccountAmbiguousError extends Error {
  options: string[];
  constructor(options: string[]) {
    super(`Multiple accounts available: ${options.join(", ")}. Specify which one.`);
    this.options = options;
  }
  toToolResult() {
    return { error: this.message, options: this.options };
  }
}

export class AccountNotFoundError extends Error {
  options: string[];
  constructor(ref: string, options: string[]) {
    super(`Account "${ref}" not found. Available: ${options.join(", ")}.`);
    this.options = options;
  }
  toToolResult() {
    return { error: this.message, options: this.options };
  }
}

export async function getConnectedAccounts(userId: string): Promise<AccountInfo[]> {
  const rows = await prisma.emailAccount.findMany({
    where: { userId, connected: true },
    select: {
      id: true, email: true, label: true, isPrimary: true, connected: true,
      displayName: true, signature: true, language: true, styleNotes: true, workContext: true,
    },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return rows;
}

export function resolveAccount(accounts: AccountInfo[], ref?: string): AccountInfo {
  const opts = accounts.map((a) => `${a.label} <${a.email}>`);

  if (!ref) {
    if (accounts.length === 1) return accounts[0];
    throw new AccountAmbiguousError(opts);
  }

  const lower = ref.toLowerCase();

  // Exact label match
  const byLabel = accounts.find((a) => a.label.toLowerCase() === lower);
  if (byLabel) return byLabel;

  // Exact email match
  const byEmail = accounts.find((a) => a.email.toLowerCase() === lower);
  if (byEmail) return byEmail;

  // Unique prefix match against label or email local-part
  const prefixMatches = accounts.filter((a) => {
    const localPart = a.email.split("@")[0].toLowerCase();
    return a.label.toLowerCase().startsWith(lower) || localPart.startsWith(lower);
  });
  if (prefixMatches.length === 1) return prefixMatches[0];
  if (prefixMatches.length > 1) throw new AccountAmbiguousError(opts);

  throw new AccountNotFoundError(ref, opts);
}
