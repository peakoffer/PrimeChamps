import "server-only";

export const OUTBOUND_DISABLED_MESSAGE =
  "Outbound sending is locked. Prime Champs is in draft-only mode.";

export function isOutboundSendingEnabled() {
  return process.env.OUTBOUND_SEND_ENABLED === "true";
}
