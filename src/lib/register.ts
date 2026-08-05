// One source of truth for register (tu/vous) when the user hasn't set an explicit
// dashboard preference. WhatsApp defaults to casual — "vous" only wins when the
// user's own recent messages actually lean formal.
export function detectRegister(recentInbound: string[]): "tu" | "vous" {
  const text = recentInbound.join(" ").toLowerCase();
  const tu = (text.match(/\b(tu|t'|ton|ta|tes|toi)\b/g) ?? []).length;
  const vous = (text.match(/\b(vous|votre|vos)\b/g) ?? []).length;
  if (vous > tu) return "vous";
  return "tu"; // WhatsApp default: casual
}
