import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

const baseUrl = process.env.CENTWISE_TEST_BASE_URL;

describe.skipIf(!baseUrl)("opening balance HTTP integration (synthetic data only)", () => {
    it("preserves history, isolates owners and keeps repeated concurrent import approvals blocked", async () => {
        const runId = randomUUID();
        const today = new Date().toISOString().slice(0, 10);
        const boundary = new Date(`${today}T00:00:00.000Z`);
        const previousInstant = new Date(boundary.getTime() - 1).toISOString();
        const previousDay = previousInstant.slice(0, 10);
        const accountInput = { name: "Synthetic balance reference", openingBalanceCents: 100_000, openingBalanceDate: today, currency: "EUR" };

        async function request(path, method = "GET", body, cookie) {
            return fetch(new URL(path, baseUrl), {
                method,
                headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
        }

        async function register(label) {
            const response = await request("/api/auth/register", "POST", {
                email: `opening-balance-${runId}-${label}@example.invalid`,
                password: randomUUID()
            });
            expect(response.status).toBe(201);
            const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
            if (!cookie) throw new Error("Synthetic registration did not return a session cookie.");
            return { cookie, user: (await response.json()).user };
        }

        const owner = await register("owner");
        const other = await register("other");
        expect((await request("/api/accounts", "POST", accountInput)).status).toBe(401);
        expect((await request("/api/accounts", "POST", { ...accountInput, openingBalanceDate: undefined }, owner.cookie)).status).toBe(400);
        expect((await request("/api/accounts", "POST", { ...accountInput, openingBalanceDate: "2026-02-29" }, owner.cookie)).status).toBe(400);

        const setup = await request("/api/financial-onboarding", "POST", {
            account: accountInput, recurringIncomes: [], recurringBills: [], safetyReserveCents: 0, monthlyInvestmentCents: 0
        }, owner.cookie);
        expect(setup.status).toBe(201);
        const accountList = await request("/api/accounts", "GET", undefined, owner.cookie);
        const { accounts } = await accountList.json();
        expect(accounts).toHaveLength(1);
        const account = accounts[0];
        expect(account.openingBalanceDate).toBe(today);
        expect(account.userId).toBe(owner.user.id);

        const otherAccountResponse = await request("/api/accounts", "POST", { ...accountInput, userId: owner.user.id }, other.cookie);
        expect(otherAccountResponse.status).toBe(201);
        const { account: otherAccount } = await otherAccountResponse.json();
        expect(otherAccount.userId).toBe(other.user.id);
        expect((await request(`/api/accounts/${account.id}`, "PUT", { openingBalanceCents: 0, openingBalanceDate: today }, other.cookie)).status).toBe(404);
        expect((await request(`/api/accounts/${account.id}`, "PUT", { openingBalanceDate: today }, owner.cookie)).status).toBe(400);
        expect((await request(`/api/accounts/${account.id}`, "PUT", { openingBalanceCents: 1 }, owner.cookie)).status).toBe(400);

        async function cash() {
            const response = await request("/api/free-to-spend", "GET", undefined, owner.cookie);
            expect(response.status).toBe(200);
            return (await response.json()).calculation.liquidBalanceCents;
        }

        const transactionInput = {
            accountId: account.id, amountInCents: 10_000, currency: "EUR", type: "expense",
            occurredAt: previousInstant, description: "Synthetic historical expense"
        };
        const historicalResponse = await request("/api/transactions", "POST", transactionInput, owner.cookie);
        expect(historicalResponse.status).toBe(201);
        const { transaction: historical } = await historicalResponse.json();
        expect(await cash()).toBe(100_000);
        expect((await request("/api/transactions", "POST", { ...transactionInput, accountId: otherAccount.id }, owner.cookie)).status).toBe(404);

        const currentResponse = await request("/api/transactions", "POST", { ...transactionInput, occurredAt: boundary.toISOString(), description: "Synthetic current expense" }, owner.cookie);
        expect(currentResponse.status).toBe(201);
        const { transaction: current } = await currentResponse.json();
        expect(await cash()).toBe(90_000);
        expect((await (await request("/api/transactions", "GET", undefined, owner.cookie)).json()).transactions).toHaveLength(2);
        expect((await (await request("/api/transactions", "GET", undefined, other.cookie)).json()).transactions).toHaveLength(0);

        expect((await request(`/api/transactions?transactionId=${historical.id}`, "PUT", { occurredAt: boundary.toISOString() }, owner.cookie)).status).toBe(200);
        expect(await cash()).toBe(80_000);
        expect((await request(`/api/transactions?transactionId=${historical.id}`, "PUT", { occurredAt: previousInstant }, owner.cookie)).status).toBe(200);
        expect(await cash()).toBe(90_000);
        expect((await request(`/api/accounts/${account.id}`, "PUT", { openingBalanceCents: 100_000, openingBalanceDate: previousDay }, owner.cookie)).status).toBe(200);
        expect(await cash()).toBe(80_000);
        expect((await request(`/api/accounts/${account.id}`, "PUT", { openingBalanceCents: 100_000, openingBalanceDate: today }, owner.cookie)).status).toBe(200);
        expect(await cash()).toBe(90_000);

        const event = {
            sourceType: "bank_notification",
            sourceEventKey: `opening-balance-http-${runId}`,
            capturedAt: new Date().toISOString(),
            candidate: { ...transactionInput, occurredAt: boundary.toISOString() }
        };
        const retries = await Promise.all(Array.from({ length: 3 }, () => request("/api/import-candidates", "POST", event, owner.cookie)));
        expect(retries.map((response) => response.status).sort()).toEqual([200, 200, 201]);
        const payloads = await Promise.all(retries.map((response) => response.json()));
        const candidateId = payloads[0].candidate.id;
        expect(new Set(payloads.map((payload) => payload.candidate.id)).size).toBe(1);
        const distinct = await request("/api/import-candidates", "POST", { ...event, sourceEventKey: `${event.sourceEventKey}-distinct` }, owner.cookie);
        expect(distinct.status).toBe(201);
        expect((await distinct.json()).candidate.id).not.toBe(candidateId);
        expect((await request("/api/import-candidates", "POST", { ...event, candidate: { ...event.candidate, amountInCents: 10_001 } }, owner.cookie)).status).toBe(409);

        const approvalPath = `/api/import-candidates/${candidateId}/approve`;
        expect((await request(approvalPath, "POST")).status).toBe(401);
        expect((await request(approvalPath, "POST", undefined, other.cookie)).status).toBe(404);
        const approvals = await Promise.all(Array.from({ length: 4 }, () => request(approvalPath, "POST", undefined, owner.cookie)));
        for (const response of approvals) {
            expect(response.status).toBe(409);
            expect((await response.json()).postingBlocked).toBe(true);
        }
        expect(await cash()).toBe(90_000);
        expect((await (await request("/api/transactions", "GET", undefined, owner.cookie)).json()).transactions).toHaveLength(2);
        expect((await request(`/api/transactions?transactionId=${historical.id}`, "DELETE", undefined, owner.cookie)).status).toBe(200);
        expect(await cash()).toBe(90_000);
        expect((await request(`/api/transactions?transactionId=${current.id}`, "DELETE", undefined, owner.cookie)).status).toBe(200);
        expect(await cash()).toBe(100_000);
    }, 120_000);
});
