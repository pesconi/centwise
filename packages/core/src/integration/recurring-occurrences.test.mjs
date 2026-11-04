import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

const baseUrl = process.env.CENTWISE_TEST_BASE_URL;

describe.skipIf(!baseUrl)("recurring occurrence HTTP integration (synthetic data only)", () => {
    it("materializes once, reconciles settlements atomically, and isolates users", async () => {
        const runId = randomUUID();
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const transactionInstant = `${today}T00:00:00.000Z`;
        const currentDay = now.getUTCDate();
        const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
        const nextDay = Math.min(currentDay + 1, lastDay);
        const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), currentDay + 1)).toISOString().slice(0, 10);

        async function request(path, method = "GET", body, cookie) {
            return fetch(new URL(path, baseUrl), {
                method,
                headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
        }

        async function register(label) {
            const response = await request("/api/auth/register", "POST", {
                email: `occurrences-${runId}-${label}@example.invalid`,
                password: randomUUID()
            });
            expect(response.status).toBe(201);
            const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
            if (!cookie) throw new Error("Synthetic registration did not return a session cookie.");
            return cookie;
        }

        async function createAccount(cookie, label, openingBalanceCents = 100_000) {
            const response = await request("/api/accounts", "POST", {
                name: `Synthetic ${label}`,
                openingBalanceCents,
                openingBalanceDate: today,
                currency: "EUR"
            }, cookie);
            expect(response.status).toBe(201);
            return (await response.json()).account;
        }

        const ownerCookie = await register("owner");
        const otherCookie = await register("other");
        const ownerAccount = await createAccount(ownerCookie, "primary");
        const ownerSecondAccount = await createAccount(ownerCookie, "secondary", 0);
        const otherAccount = await createAccount(otherCookie, "other");

        async function createRule(cookie, path, body) {
            const response = await request(path, "POST", body, cookie);
            expect(response.status).toBe(201);
            return (await response.json());
        }

        await createRule(ownerCookie, "/api/recurring-bills", {
            name: "Synthetic month-end bill",
            amountInCents: 10_000,
            dueDayOfMonth: 31
        });
        await createRule(ownerCookie, "/api/recurring-bills", {
            name: "Synthetic partial bill",
            amountInCents: 5_000,
            dueDayOfMonth: nextDay
        });
        await createRule(ownerCookie, "/api/recurring-incomes", {
            name: "Synthetic expected income",
            amountInCents: 30_000,
            expectedDayOfMonth: nextDay
        });
        await createRule(ownerCookie, "/api/recurring-incomes", {
            name: "Synthetic due-today income",
            amountInCents: 5_000,
            expectedDayOfMonth: currentDay
        });
        await createRule(otherCookie, "/api/recurring-bills", {
            name: "Foreign synthetic bill",
            amountInCents: 10_000,
            dueDayOfMonth: 31
        });

        async function plan(cookie) {
            const response = await request("/api/free-to-spend", "GET", undefined, cookie);
            expect(response.status).toBe(200);
            return response.json();
        }

        const concurrentPlans = await Promise.all(Array.from({ length: 4 }, () => plan(ownerCookie)));
        const occurrenceIds = concurrentPlans.map(({ scheduledItems }) =>
            scheduledItems.filter((item) => item.name.startsWith("Synthetic ")).map((item) => item.id).sort()
        );
        expect(occurrenceIds.every((ids) => JSON.stringify(ids) === JSON.stringify(occurrenceIds[0]))).toBe(true);
        expect(occurrenceIds[0]).toHaveLength(4);

        const ownerPlan = concurrentPlans[0];
        const monthEndBill = ownerPlan.scheduledItems.find((item) => item.name === "Synthetic month-end bill");
        const partialBill = ownerPlan.scheduledItems.find((item) => item.name === "Synthetic partial bill");
        const expectedIncome = ownerPlan.scheduledItems.find((item) => item.name === "Synthetic expected income");
        const dueTodayIncome = ownerPlan.scheduledItems.find((item) => item.name === "Synthetic due-today income");
        expect(monthEndBill.date).toBe(`${today.slice(0, 8)}${String(lastDay).padStart(2, "0")}`);
        expect(partialBill).toBeDefined();
        expect(expectedIncome).toBeDefined();
        expect(dueTodayIncome.date).toBe(today);
        const otherPlan = await plan(otherCookie);
        const foreignOccurrence = otherPlan.scheduledItems.find((item) => item.name === "Foreign synthetic bill");
        expect((await request(`/api/recurring-occurrences/${dueTodayIncome.id}`, "PATCH", {
            action: "reschedule",
            scheduledDate: tomorrow
        }, ownerCookie)).status).toBe(200);
        const rescheduledPlan = await plan(ownerCookie);
        expect(rescheduledPlan.calculation.remainingIncomeCents).toBe((nextDay > currentDay ? 30_000 : 0) + 5_000);
        expect((await request(
            "/api/transactions",
            "POST",
            {
                accountId: ownerAccount.id,
                recurringOccurrenceId: foreignOccurrence.id,
                amountInCents: 100,
                currency: "EUR",
                type: "expense",
                occurredAt: transactionInstant
            },
            ownerCookie
        )).status).toBe(404);
        expect((await request(
            "/api/transactions",
            "POST",
            {
                accountId: otherAccount.id,
                recurringOccurrenceId: monthEndBill.id,
                amountInCents: 100,
                currency: "EUR",
                type: "expense",
                occurredAt: transactionInstant
            },
            ownerCookie
        )).status).toBe(404);
        expect((await request(`/api/recurring-occurrences/${monthEndBill.id}`, "PATCH", { action: "cancel" }, otherCookie)).status).toBe(404);

        const paymentInput = {
            accountId: ownerAccount.id,
            recurringOccurrenceId: monthEndBill.id,
            amountInCents: 4_000,
            currency: "EUR",
            type: "expense",
            occurredAt: transactionInstant,
            description: "Synthetic partial payment"
        };
        expect((await request("/api/transactions", "POST", {
            ...paymentInput,
            type: "income"
        }, ownerCookie)).status).toBe(409);
        const paymentResponse = await request("/api/transactions", "POST", paymentInput, ownerCookie);
        expect(paymentResponse.status).toBe(201);
        const { transaction: payment } = await paymentResponse.json();
        let currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.liquidBalanceCents).toBe(96_000);
        expect(currentPlan.calculation.remainingBillsCents).toBe(11_000);

        expect((await request(
            `/api/transactions?transactionId=${payment.id}`,
            "PUT",
            { amountInCents: 2_000 },
            ownerCookie
        )).status).toBe(200);
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.liquidBalanceCents).toBe(98_000);
        expect(currentPlan.calculation.remainingBillsCents).toBe(13_000);

        expect((await request(
            `/api/transactions?transactionId=${payment.id}`,
            "PUT",
            {
                amountInCents: 2_000,
                accountId: ownerSecondAccount.id,
                recurringOccurrenceId: monthEndBill.id
            },
            ownerCookie
        )).status).toBe(200);
        expect((await request(`/api/transactions?transactionId=${payment.id}`, "PUT", {
            type: "income"
        }, ownerCookie)).status).toBe(409);
        const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 12)).toISOString();
        expect((await request(`/api/transactions?transactionId=${payment.id}`, "PUT", {
            occurredAt: nextMonthDate,
            recurringOccurrenceId: monthEndBill.id
        }, ownerCookie)).status).toBe(409);
        expect((await request(`/api/transactions?transactionId=${payment.id}`, "PUT", {
            type: "income",
            recurringOccurrenceId: expectedIncome.id
        }, ownerCookie)).status).toBe(200);

        expect((await request(`/api/transactions?transactionId=${payment.id}`, "DELETE", undefined, otherCookie)).status).toBe(404);
        expect((await request(`/api/transactions?transactionId=${payment.id}`, "DELETE", undefined, ownerCookie)).status).toBe(200);
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.liquidBalanceCents).toBe(100_000);
        expect(currentPlan.calculation.remainingBillsCents).toBe(15_000);

        const shortPaymentResponse = await request("/api/transactions", "POST", {
            ...paymentInput,
            recurringOccurrenceId: partialBill.id,
            amountInCents: 2_000
        }, ownerCookie);
        expect(shortPaymentResponse.status).toBe(201);
        const { transaction: shortPayment } = await shortPaymentResponse.json();
        expect((await request(`/api/recurring-occurrences/${partialBill.id}`, "PATCH", {
            action: "short-settle",
            confirm: true
        }, ownerCookie)).status).toBe(200);
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.remainingBillsCents).toBe(10_000);

        expect((await request(`/api/transactions?transactionId=${shortPayment.id}`, "PUT", {
            amountInCents: 2_500
        }, ownerCookie)).status).toBe(200);
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.remainingBillsCents).toBe(12_500);

        expect((await request(`/api/transactions?transactionId=${shortPayment.id}`, "DELETE", undefined, ownerCookie)).status).toBe(200);
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.remainingBillsCents).toBe(15_000);

        const concurrentPayments = await Promise.all(Array.from({ length: 3 }, () => request("/api/transactions", "POST", {
            ...paymentInput,
            recurringOccurrenceId: partialBill.id,
            amountInCents: 2_000
        }, ownerCookie)));
        expect(concurrentPayments.map((response) => response.status)).toEqual([201, 201, 201]);
        const concurrentPaymentIds = await Promise.all(concurrentPayments.map(async (response) => (await response.json()).transaction.id));
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.liquidBalanceCents).toBe(94_000);
        expect(currentPlan.calculation.remainingBillsCents).toBe(10_000);
        const concurrentDeletions = await Promise.all(concurrentPaymentIds.map((id) =>
            request(`/api/transactions?transactionId=${id}`, "DELETE", undefined, ownerCookie)
        ));
        expect(concurrentDeletions.map((response) => response.status)).toEqual([200, 200, 200]);
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.liquidBalanceCents).toBe(100_000);
        expect(currentPlan.calculation.remainingBillsCents).toBe(15_000);

        const overpaymentResponse = await request("/api/transactions", "POST", {
            ...paymentInput,
            amountInCents: 15_000
        }, ownerCookie);
        expect(overpaymentResponse.status).toBe(201);
        const { transaction: overpayment } = await overpaymentResponse.json();
        currentPlan = await plan(ownerCookie);
        expect(currentPlan.calculation.liquidBalanceCents).toBe(85_000);
        expect(currentPlan.calculation.remainingBillsCents).toBe(5_000);
        expect(currentPlan.scheduledItems.some((item) => item.id === monthEndBill.id)).toBe(false);

        const historicalPayment = await request("/api/transactions", "POST", {
            ...paymentInput,
            occurredAt: new Date(Date.parse(`${today}T00:00:00.000Z`) - 1).toISOString()
        }, ownerCookie);
        expect(historicalPayment.status).toBe(409);
        expect((await request(`/api/transactions?transactionId=${overpayment.id}`, "DELETE", undefined, ownerCookie)).status).toBe(200);
    }, 30_000);
});
