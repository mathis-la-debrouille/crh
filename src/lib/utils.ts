import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function sanitizeReply(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")          // markdown headers
    .replace(/^\s*[-—*_]{3,}\s*$/gm, "")  // horizontal rules like "---"
    .replace(/\*\*(.+?)\*\*/g, "*$1*")    // markdown bold → WhatsApp bold
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
