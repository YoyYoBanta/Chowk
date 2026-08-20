import { env } from "@/config/env";
import type { WhatsAppProvider } from "./types";
// This file has a dedicated ESLint override (eslint.config.mjs) exempting
// it — and only it — from the "no reaching into src/providers/baileys/"
// rule: it is the one sanctioned place allowed to construct the adapter
// (architecture.md §5 rule 2, "one factory, one call site"). It still may
// never import the raw baileys package itself, only this adapter module.
import { baileysAdapter } from "./baileys/adapter";
import { cloudApiAdapter } from "./cloud-api/adapter";

/**
 * The ONE place `WHATSAPP_PROVIDER` is read to select behavior
 * (context.md §8.0.3 / architecture.md §5 rule 2). Everything else in the
 * app receives a `WhatsAppProvider` from this function and never inspects
 * `.name` to branch on transport.
 */
let cached: WhatsAppProvider | undefined;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;

  switch (env.WHATSAPP_PROVIDER) {
    case "baileys":
      cached = baileysAdapter;
      break;
    case "cloud-api":
      cached = cloudApiAdapter;
      break;
    default: {
      const exhaustive: never = env.WHATSAPP_PROVIDER;
      throw new Error(`Unknown WHATSAPP_PROVIDER: ${String(exhaustive)}`);
    }
  }

  return cached;
}
