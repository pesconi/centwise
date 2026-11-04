import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

const baseUrl = process.env.CENTWISE_TEST_BASE_URL;

describe.skipIf(!baseUrl)(
  "duplicate review HTTP (synthetic local data only)",
  () => {
    it("isolates owned links, refreshes comparisons, retains equal purchases and blocks every approval", async () => {
      if (!baseUrl || !process.env.DATABASE_URL) {
        throw new Error(
          "Local HTTP and database URLs are required for synthetic integration.",
        );
      }
      if (!["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname)) {
        throw new Error("Synthetic HTTP integration requires a local server.");
      }
      const databaseUrl = new URL(process.env.DATABASE_URL);
      if (
        !["localhost", "127.0.0.1"].includes(databaseUrl.hostname) ||
        databaseUrl.port !== "5433" ||
        databaseUrl.pathname !== "/centwise"
      ) {
        throw new Error(
          "Synthetic fixture mutation requires localhost:5433/centwise.",
        );
      }
      const { db, schema } = await import("@centwise/database");
      const { eq, inArray } = await import("drizzle-orm");
      const users: string[] = [];
      const runId = randomUUID();
      const today = new Date().toISOString().slice(0, 10);
      const occurredAt = `${today}T00:00:00.000Z`;

      async function request(
        path: string,
        method = "GET",
        body?: unknown,
        cookie?: string,
      ) {
        return fetch(new URL(path, baseUrl), {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(cookie ? { Cookie: cookie } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      }
      async function register(label: string) {
        const response = await request("/api/auth/register", "POST", {
          email: `duplicate-${runId}-${label}@example.invalid`,
          password: randomUUID(),
        });
        expect(response.status).toBe(201);
        const { user } = await response.json();
        users.push(user.id);
        const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
        if (!cookie) throw new Error("Synthetic session cookie missing.");
        const accountResponse = await request(
          "/api/accounts",
          "POST",
          {
            name: "Synthetic duplicate review",
            openingBalanceCents: 100_000,
            openingBalanceDate: today,
            currency: "EUR",
          },
          cookie,
        );
        expect(accountResponse.status).toBe(201);
        return {
          cookie,
          userId: user.id as string,
          account: (await accountResponse.json()).account,
        };
      }

      try {
        const owner = await register("owner");
        const other = await register("other");
        const fields = {
          accountId: owner.account.id,
          amountInCents: 1234,
          currency: "EUR",
          type: "expense" as const,
          occurredAt,
          description: "Synthetic SHOP",
        };
        async function candidate(
          sourceType: string,
          overrides = {},
          cookie = owner.cookie,
        ) {
          const response = await request(
            "/api/import-candidates",
            "POST",
            {
              sourceType,
              sourceEventKey: randomUUID(),
              capturedAt: occurredAt,
              evidence: { excerpt: "Synthetic review evidence" },
              candidate: { ...fields, ...overrides },
            },
            cookie,
          );
          expect(response.status).toBe(201);
          return (await response.json()).candidate;
        }
        async function inbox(cookie = owner.cookie) {
          const response = await request(
            "/api/import-candidates",
            "GET",
            undefined,
            cookie,
          );
          expect(response.status).toBe(200);
          const payload = await response.json();
          expect(payload.postingBlocked).toBe(true);
          return payload.candidates;
        }

        expect((await request("/api/import-candidates")).status).toBe(401);
        const sms = await candidate("bank_sms");
        const notification = await candidate("bank_notification", {
          description: "  synthetic   shop ",
        });
        const separatePurchase = await candidate("bank_sms", {
          description: "Another synthetic merchant",
        });
        const noMatch = await candidate("bank_notification", {
          type: "income",
        });
        const card = await candidate("card_statement_pdf");
        const transfer = await candidate("bank_statement_pdf", {
          description: "Synthetic transfer between accounts",
        });
        const foreign = await candidate(
          "bank_sms",
          { accountId: other.account.id },
          other.cookie,
        );

        const manualResponse = await request(
          "/api/transactions",
          "POST",
          fields,
          owner.cookie,
        );
        expect(manualResponse.status).toBe(201);
        const { transaction: manual } = await manualResponse.json();
        expect(
          (
            await request(
              "/api/transactions",
              "POST",
              { ...fields, accountId: other.account.id },
              owner.cookie,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await request(
              "/api/transactions",
              "POST",
              { ...fields, recurringOccurrenceId: randomUUID() },
              owner.cookie,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await request(
              `/api/import-candidates/${sms.id}`,
              "PATCH",
              { accountId: other.account.id },
              owner.cookie,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await request(
              `/api/import-candidates/${sms.id}`,
              "PATCH",
              { amountInCents: 1 },
              other.cookie,
            )
          ).status,
        ).toBe(404);

        // Deliberately malformed legacy links must never become comparison evidence.
        async function source(userId: string) {
          const [row] = await db
            .insert(schema.importSources)
            .values({
              userId,
              sourceType: "bank_sms",
              sourceEventKey: randomUUID(),
              capturedAt: new Date(occurredAt),
              fingerprint: "synthetic-invalid-link",
            })
            .returning();
          if (!row) throw new Error("Synthetic source insert returned no row.");
          return row;
        }
        const foreignSource = await source(other.userId);
        const [badSource] = await db
          .insert(schema.importCandidates)
          .values({
            ...fields,
            occurredAt: new Date(occurredAt),
            userId: owner.userId,
            sourceId: foreignSource.id,
            status: "pending_review",
          })
          .returning();
        const ownSource = await source(owner.userId);
        const [badAccount] = await db
          .insert(schema.importCandidates)
          .values({
            ...fields,
            accountId: other.account.id,
            occurredAt: new Date(occurredAt),
            userId: owner.userId,
            sourceId: ownSource.id,
            status: "pending_review",
          })
          .returning();
        const [badManualAccount] = await db
          .insert(schema.transactions)
          .values({
            ...fields,
            type: "expense",
            accountId: other.account.id,
            occurredAt: new Date(occurredAt),
            userId: owner.userId,
          })
          .returning();
        if (!badSource || !badAccount || !badManualAccount) {
          throw new Error(
            "Synthetic invalid-link fixture insert returned no row.",
          );
        }

        const rows = await inbox();
        const review = rows.find(
          (row: { id: string }) => row.id === sms.id,
        ).duplicateReview;
        expect(review).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              targetId: notification.id,
              reason: "same_fields_and_description",
            }),
            expect.objectContaining({
              targetId: manual.id,
              targetType: "manual_transaction",
            }),
            expect.objectContaining({
              targetId: separatePurchase.id,
              reason: "same_fields",
            }),
          ]),
        );
        expect(
          rows.find((row: { id: string }) => row.id === noMatch.id)
            .duplicateReview,
        ).toEqual([]);
        expect(JSON.stringify(rows)).not.toContain(foreign.id);
        expect(JSON.stringify(rows)).not.toContain(badSource.id);
        expect(
          rows.find((row: { id: string }) => row.id === badAccount.id)
            .duplicateReview,
        ).toEqual([]);
        expect(JSON.stringify(review)).not.toContain(badAccount.id);
        expect(JSON.stringify(review)).not.toContain(badManualAccount.id);
        expect(JSON.stringify(await inbox(other.cookie))).not.toContain(sms.id);

        expect(
          (
            await request(
              `/api/import-candidates/${notification.id}`,
              "PATCH",
              { amountInCents: 9999 },
              owner.cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await request(
              `/api/import-candidates/${separatePurchase.id}/reject`,
              "POST",
              {},
              owner.cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await request(
              `/api/transactions?transactionId=${manual.id}`,
              "PUT",
              { amountInCents: 9999 },
              owner.cookie,
            )
          ).status,
        ).toBe(200);
        const updated = (await inbox()).find(
          (row: { id: string }) => row.id === sms.id,
        ).duplicateReview;
        expect(
          updated.map((match: { targetId: string }) => match.targetId),
        ).not.toContain(notification.id);
        expect(
          updated.map((match: { targetId: string }) => match.targetId),
        ).not.toContain(separatePurchase.id);
        expect(
          updated.map((match: { targetId: string }) => match.targetId),
        ).not.toContain(manual.id);

        for (const id of [sms.id, noMatch.id, card.id, transfer.id]) {
          const approvals = await Promise.all(
            [1, 2].map(() =>
              request(
                `/api/import-candidates/${id}/approve`,
                "POST",
                {},
                owner.cookie,
              ),
            ),
          );
          for (const response of approvals) {
            expect(response.status).toBe(409);
            expect((await response.json()).postingBlocked).toBe(true);
          }
        }
        expect(
          (
            await request(
              `/api/import-candidates/${sms.id}/approve`,
              "POST",
              {},
              other.cookie,
            )
          ).status,
        ).toBe(404);
        const ledger = await request(
          "/api/transactions",
          "GET",
          undefined,
          owner.cookie,
        );
        expect((await ledger.json()).transactions).toHaveLength(2);
        const persisted = await db.query.importCandidates.findFirst({
          where: eq(schema.importCandidates.id, sms.id),
        });
        expect(persisted?.status).toBe("pending_review");
        expect(persisted?.postingStatus).toBe("blocked");
      } finally {
        if (users.length > 0) {
          await db
            .delete(schema.transactions)
            .where(inArray(schema.transactions.userId, users));
          await db
            .delete(schema.importCandidates)
            .where(inArray(schema.importCandidates.userId, users));
          await db
            .delete(schema.importSources)
            .where(inArray(schema.importSources.userId, users));
          await db
            .delete(schema.accounts)
            .where(inArray(schema.accounts.userId, users));
          await db.delete(schema.users).where(inArray(schema.users.id, users));
        }
      }
    }, 60_000);
  },
);
