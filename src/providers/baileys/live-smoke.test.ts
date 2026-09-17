import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BaileysProvider } from "./adapter";
import { parseCliArgs, sanitizePhoneNumber, checkSandboxGuard, EXIT_CODES } from "../../../scripts/smoke";

describe("Phase A Baileys Live Smoke & Safety Verification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("TRANSPORT_ENV Safety Guard", () => {
    it("allows execution when TRANSPORT_ENV is 'sandbox'", () => {
      process.env.TRANSPORT_ENV = "sandbox";
      expect(checkSandboxGuard()).toBe(true);
    });

    it("refuses execution and logs warning when TRANSPORT_ENV is 'production'", () => {
      process.env.TRANSPORT_ENV = "production";
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      expect(checkSandboxGuard()).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("[SECURITY HARD GUARD TRIGGERED]");
      expect(output).toContain("must NEVER be used with a partner-facing or production number");
    });

    it("adapter rejects sendText when TRANSPORT_ENV is not sandbox", async () => {
      process.env.TRANSPORT_ENV = "production";
      const provider = new BaileysProvider();
      
      const result = await provider.sendText({
        channelId: "test-channel",
        to: "15551234567",
        body: "Hello test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("UNSAFE_TRANSPORT_ENV");
        expect(result.retryable).toBe(false);
      }
    });

    it("adapter rejects connect when TRANSPORT_ENV is not sandbox", async () => {
      process.env.TRANSPORT_ENV = "live";
      const provider = new BaileysProvider();
      
      await expect(provider.connect({
        id: "ch-1",
        organizationId: "org-1",
        displayName: "Test",
        phoneNumber: "15550001",
        provider: "baileys",
        metaPhoneNumberId: null,
        metaWabaId: null,
        sessionRef: null,
        accessTokenRef: null,
        qualityRating: null,
        messagingTier: null,
        status: "ACTIVE",
        createdAt: new Date(),
      })).rejects.toThrow(/TRANSPORT_ENV is 'live'/);
    });
  });

  describe("Smoke CLI Argument Parsing & Sanitization", () => {
    it("parses --to and --text flags properly", () => {
      const args = parseCliArgs(["--to", "+1 (555) 123-4567", "--text", "Test message body", "--timeout", "15000", "--listen"]);
      expect(args.to).toBe("+1 (555) 123-4567");
      expect(args.text).toBe("Test message body");
      expect(args.timeoutMs).toBe(15000);
      expect(args.listen).toBe(true);
    });

    it("parses inline --to=... and --text=... syntax", () => {
      const args = parseCliArgs(["--to=+15559876543", "--text=Quick test"]);
      expect(args.to).toBe("+15559876543");
      expect(args.text).toBe("Quick test");
      expect(args.timeoutMs).toBe(30000);
      expect(args.listen).toBe(false);
    });

    it("sanitizes phone number to digits only", () => {
      expect(sanitizePhoneNumber("+1 (555) 234-5678")).toBe("15552345678");
      expect(sanitizePhoneNumber("91 98765 43210")).toBe("919876543210");
      expect(sanitizePhoneNumber("++00-112233")).toBe("00112233");
    });
  });

  describe("Distinct Exit Codes Defined", () => {
    it("defines distinct exit codes for each required failure condition", () => {
      expect(EXIT_CODES.SUCCESS).toBe(0);
      expect(EXIT_CODES.SESSION_MISSING_OR_EXPIRED).toBe(10);
      expect(EXIT_CODES.RECIPIENT_NOT_ON_WHATSAPP).toBe(11);
      expect(EXIT_CODES.NETWORK_FAILURE).toBe(12);
      expect(EXIT_CODES.SEND_TIMEOUT).toBe(13);
      expect(EXIT_CODES.UNSAFE_TRANSPORT_ENV).toBe(14);
      expect(EXIT_CODES.INVALID_ARGUMENTS).toBe(15);
    });
  });

  describe("Channel Isolation in PostgreSQL Session Store", () => {
    it("isolates auth state and keys between two distinct channels", async () => {
      const { createDbAuthState, hasValidSession, clearSession } = await import("./session-store");
      const { prisma } = await import("@/lib/prisma");

      // In-memory mock maps simulating Postgres tables
      interface MockSessionRow {
        id: string;
        channelId: string;
        creds: unknown;
        createdAt: Date;
        updatedAt: Date;
      }

      interface MockKeyRow {
        id: string;
        channelId: string;
        category: string;
        keyId: string;
        value: unknown;
        createdAt: Date;
        updatedAt: Date;
      }

      const sessionDataStore = new Map<string, MockSessionRow>();
      const signalKeyStore = new Map<string, MockKeyRow>();

      vi.spyOn(prisma.baileysSessionData, "findUnique").mockImplementation(
        ((args: { where: { channelId: string } }) => {
          return Promise.resolve(sessionDataStore.get(args.where.channelId) ?? null);
        }) as unknown as typeof prisma.baileysSessionData.findUnique,
      );

      vi.spyOn(prisma.baileysSessionData, "upsert").mockImplementation(
        ((args: { where: { channelId: string }; create: { channelId: string; creds: unknown }; update: { creds: unknown } }) => {
          const existing = sessionDataStore.get(args.where.channelId);
          const creds = args.update.creds ?? args.create.creds;
          const record: MockSessionRow = {
            id: existing?.id ?? `sess-${args.where.channelId}`,
            channelId: args.where.channelId,
            creds,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          sessionDataStore.set(args.where.channelId, record);
          return Promise.resolve(record);
        }) as unknown as typeof prisma.baileysSessionData.upsert,
      );

      vi.spyOn(prisma.baileysSessionData, "deleteMany").mockImplementation(
        ((args?: { where?: { channelId?: string } }) => {
          let count = 0;
          if (args?.where?.channelId) {
            if (sessionDataStore.delete(args.where.channelId)) count++;
          }
          return Promise.resolve({ count });
        }) as unknown as typeof prisma.baileysSessionData.deleteMany,
      );

      vi.spyOn(prisma.baileysSignalKey, "findMany").mockImplementation(
        ((args?: { where?: { channelId?: string; category?: string; keyId?: { in: string[] } } }) => {
          const results: MockKeyRow[] = [];
          for (const record of sessionDataStore.values()) {
            if (
              args?.where?.channelId &&
              record.channelId === args.where.channelId
            ) {
              // matched
            }
          }
          for (const record of signalKeyStore.values()) {
            if (
              args?.where?.channelId &&
              args?.where?.category &&
              args?.where?.keyId?.in &&
              record.channelId === args.where.channelId &&
              record.category === args.where.category &&
              args.where.keyId.in.includes(record.keyId)
            ) {
              results.push(record);
            }
          }
          return Promise.resolve(results);
        }) as unknown as typeof prisma.baileysSignalKey.findMany,
      );

      vi.spyOn(prisma.baileysSignalKey, "upsert").mockImplementation(
        ((args: {
          where: { channelId_category_keyId: { channelId: string; category: string; keyId: string } };
          create: { channelId: string; category: string; keyId: string; value: unknown };
          update: { value: unknown };
        }) => {
          const { channelId, category, keyId } = args.where.channelId_category_keyId;
          const compositeKey = `${channelId}:${category}:${keyId}`;
          const record: MockKeyRow = {
            id: `key-${compositeKey}`,
            channelId,
            category,
            keyId,
            value: args.update.value ?? args.create.value,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          signalKeyStore.set(compositeKey, record);
          return Promise.resolve(record);
        }) as unknown as typeof prisma.baileysSignalKey.upsert,
      );

      vi.spyOn(prisma.baileysSignalKey, "deleteMany").mockImplementation(
        ((args?: { where?: { channelId?: string } }) => {
          let count = 0;
          for (const [key, record] of Array.from(signalKeyStore.entries())) {
            if (args?.where?.channelId && record.channelId === args.where.channelId) {
              signalKeyStore.delete(key);
              count++;
            }
          }
          return Promise.resolve({ count });
        }) as unknown as typeof prisma.baileysSignalKey.deleteMany,
      );

      vi.spyOn(prisma.channel, "updateMany").mockImplementation(
        (() => Promise.resolve({ count: 1 })) as unknown as typeof prisma.channel.updateMany,
      );

      // Initialize auth state for Channel 1 and Channel 2
      const auth1 = await createDbAuthState("channel-1");
      const auth2 = await createDbAuthState("channel-2");

      // Verify separate creds objects
      expect(auth1.state.creds).toBeDefined();
      expect(auth2.state.creds).toBeDefined();
      expect(auth1.state.creds.registrationId).not.toEqual(auth2.state.creds.registrationId);

      // Save creds for channel 1
      auth1.state.creds.me = { id: "15550001000:1@s.whatsapp.net", name: "Channel 1 Test" };
      await auth1.saveCreds();

      // Channel 1 has valid session, Channel 2 does not
      expect(await hasValidSession("channel-1")).toBe(true);
      expect(await hasValidSession("channel-2")).toBe(false);

      // Set signal keys for channel 1
      await auth1.state.keys.set({
        "app-state-sync-key": {
          "key-1": {
            keyData: new Uint8Array([1, 2, 3]),
            fingerprint: { rawId: 1, currentIndex: 1, deviceIndexes: [] },
            timestamp: 123456789,
          },
        },
      });

      // Channel 2 reads key-1 -> should be empty
      const ch2Keys = await auth2.state.keys.get("app-state-sync-key", ["key-1"]);
      expect(ch2Keys["key-1"]).toBeUndefined();

      // Channel 1 reads key-1 -> returns data
      const ch1Keys = await auth1.state.keys.get("app-state-sync-key", ["key-1"]);
      expect(ch1Keys["key-1"]).toBeDefined();

      // Clear session for channel 1
      await clearSession("channel-1");
      expect(await hasValidSession("channel-1")).toBe(false);

      // Channel 2 store remains untouched
      expect(sessionDataStore.has("channel-2")).toBe(true);
    });
  });
});
