"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

interface CurrentUser {
    id: string;
    email: string;
}

interface Transaction {
    id: string;
    accountId: string;
    amountInCents: number;
    currency: string;
    type: "income" | "expense";
    occurredAt: string;
    description: string | null;
}

interface Account {
    id: string;
    name: string;
    openingBalanceCents: number;
    currency: "EUR";
    isActive: boolean;
}

interface FreeToSpendResult {
    liquidBalanceCents: number;
    remainingIncomeCents: number;
    remainingBillsCents: number;
    remainingInvestmentCents: number;
    safetyReserveCents: number;
    freeToSpendCents: number;
    daysRemainingInMonth: number;
    dailySafeSpendCents: number;
}

interface ScheduledItem {
    id: string;
    name: string;
    type: "income" | "bill";
    amountInCents: number;
    dayOfMonth: number;
    date: string;
}

interface PlanEntryDraft {
    name: string;
    amount: string;
    day: string;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init);
    const payload: unknown = await response.json();

    if (!response.ok) {
        const error = payload as { error?: string };
        throw new Error(error.error ?? "The request could not be completed.");
    }

    return payload as T;
}

function formatCurrency(amountInCents: number, currency: string): string {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountInCents / 100);
}

function formatPlanDate(date: string): string {
    return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC"
    });
}

export function FinanceDashboard() {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [formError, setFormError] = useState<string | null>(null);
    const [accountFormError, setAccountFormError] = useState<string | null>(null);
    const [onboardingError, setOnboardingError] = useState<string | null>(null);
    const [incomeDrafts, setIncomeDrafts] = useState<PlanEntryDraft[]>([]);
    const [billDrafts, setBillDrafts] = useState<PlanEntryDraft[]>([]);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
    const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
    const [editingScheduledItem, setEditingScheduledItem] = useState<{ id: string; type: ScheduledItem["type"] } | null>(null);
    const [transactionEditError, setTransactionEditError] = useState<string | null>(null);
    const [scheduledItemEditError, setScheduledItemEditError] = useState<string | null>(null);

    const sessionQuery = useQuery({
        queryKey: ["session"],
        queryFn: async () => {
            const response = await fetch("/api/auth/session");

            if (response.status === 401) {
                return null;
            }

            if (!response.ok) {
                throw new Error("Could not load your session.");
            }

            return (await response.json() as { user: CurrentUser }).user;
        }
    });

    const user = sessionQuery.data ?? null;

    const transactionsQuery = useQuery({
        queryKey: ["transactions"],
        queryFn: () => requestJson<{ transactions: Transaction[] }>("/api/transactions"),
        enabled: Boolean(user)
    });

    const accountsQuery = useQuery({
        queryKey: ["accounts"],
        queryFn: () => requestJson<{ accounts: Account[] }>("/api/accounts"),
        enabled: Boolean(user)
    });

    const freeToSpendQuery = useQuery({
        queryKey: ["free-to-spend"],
        queryFn: () => requestJson<{
            calculation: FreeToSpendResult;
            periodEndDate: string;
            scheduledItems: ScheduledItem[];
        }>("/api/free-to-spend"),
        enabled: Boolean(user)
    });

    const financialSettingsQuery = useQuery({
        queryKey: ["financial-settings"],
        queryFn: () => requestJson<{ settings: { safetyReserveCents: number; monthlyInvestmentCents: number }; isConfigured: boolean }>("/api/financial-settings"),
        enabled: Boolean(user)
    });

    const authMutation = useMutation({
        mutationFn: (credentials: { email: string; password: string }) =>
            requestJson<{ user: CurrentUser }>(`/api/auth/${authMode}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(credentials)
            }),
        onSuccess: ({ user }) => {
            queryClient.setQueryData(["session"], user);
            setEmail("");
            setPassword("");
        }
    });

    const logoutMutation = useMutation({
        mutationFn: () => requestJson<{ success: boolean }>("/api/auth/logout", { method: "POST" }),
        onSuccess: () => {
            queryClient.setQueryData(["session"], null);
            queryClient.removeQueries({ queryKey: ["transactions"] });
            queryClient.removeQueries({ queryKey: ["accounts"] });
            queryClient.removeQueries({ queryKey: ["free-to-spend"] });
            queryClient.removeQueries({ queryKey: ["financial-settings"] });
            setAuthMode("login");
            setEmail("");
            setPassword("");
            setSelectedAccountId(null);
        }
    });

    const accountMutation = useMutation({
        mutationFn: (account: Omit<Account, "id" | "isActive">) =>
            requestJson<{ account: Account }>("/api/accounts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(account)
            }),
        onSuccess: async ({ account }) => {
            setSelectedAccountId(account.id);
            await queryClient.invalidateQueries({ queryKey: ["accounts"] });
            await queryClient.invalidateQueries({ queryKey: ["free-to-spend"] });
        }
    });

    const onboardingMutation = useMutation({
        mutationFn: (onboarding: {
            account?: Omit<Account, "id" | "isActive">;
            recurringIncomes: { name: string; amountInCents: number; expectedDayOfMonth: number }[];
            recurringBills: { name: string; amountInCents: number; dueDayOfMonth: number }[];
            safetyReserveCents: number;
            monthlyInvestmentCents: number;
        }) => requestJson<{ success: boolean }>("/api/financial-onboarding", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(onboarding)
        }),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["accounts"] }),
                queryClient.invalidateQueries({ queryKey: ["financial-settings"] }),
                queryClient.invalidateQueries({ queryKey: ["free-to-spend"] })
            ]);
        }
    });

    const transactionMutation = useMutation({
        mutationFn: (transaction: Omit<Transaction, "id">) =>
            requestJson<{ transaction: Transaction }>("/api/transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(transaction)
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["transactions"] });
            await queryClient.invalidateQueries({ queryKey: ["free-to-spend"] });
        }
    });

    const updateTransactionMutation = useMutation({
        mutationFn: ({ transactionId, updates }: {
            transactionId: string;
            updates: Pick<Transaction, "amountInCents" | "type" | "occurredAt" | "description">;
        }) => requestJson<{ transaction: Transaction }>(`/api/transactions?transactionId=${transactionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates)
        }),
        onSuccess: async () => {
            setEditingTransactionId(null);
            setTransactionEditError(null);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["transactions"] }),
                queryClient.invalidateQueries({ queryKey: ["free-to-spend"] })
            ]);
        }
    });

    const updateScheduledItemMutation = useMutation({
        mutationFn: ({ item, name, amountInCents, dayOfMonth }: {
            item: ScheduledItem;
            name: string;
            amountInCents: number;
            dayOfMonth: number;
        }) => requestJson<{ bill?: unknown; income?: unknown }>(
            `/api/recurring-${item.type === "bill" ? "bills" : "incomes"}/${item.id}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(item.type === "bill"
                    ? { name, amountInCents, dueDayOfMonth: dayOfMonth }
                    : { name, amountInCents, expectedDayOfMonth: dayOfMonth })
            }
        ),
        onSuccess: async () => {
            setEditingScheduledItem(null);
            setScheduledItemEditError(null);
            await queryClient.invalidateQueries({ queryKey: ["free-to-spend"] });
        }
    });

    const deleteTransactionMutation = useMutation({
        mutationFn: ({ transactionId }: { transactionId: string }) =>
            requestJson<{ transaction: Transaction }>(`/api/transactions?transactionId=${transactionId}`, {
                method: "DELETE"
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["transactions"] });
            await queryClient.invalidateQueries({ queryKey: ["free-to-spend"] });
        }
    });

    function handleUserSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        authMutation.mutate({ email, password });
    }

    function handleTransactionSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setFormError(null);

        if (!user) {
            return;
        }

        const form = event.currentTarget;
        const formData = new FormData(form);
        const amountInCents = Math.round(Number(formData.get("amount")) * 100);

        if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
            setFormError("Enter an amount greater than zero.");
            return;
        }

        const accountId = selectedAccountId ?? accounts[0]?.id;

        if (!accountId) {
            setFormError("Create an account before recording a transaction.");
            return;
        }

        transactionMutation.mutate(
            {
                accountId,
                amountInCents,
                currency: "EUR",
                type: String(formData.get("type")) as Transaction["type"],
                occurredAt: new Date(String(formData.get("occurredAt"))).toISOString(),
                description: String(formData.get("description")) || null
            },
            { onSuccess: () => form.reset() }
        );
    }

    function handleTransactionEditSubmit(event: FormEvent<HTMLFormElement>, transactionId: string) {
        event.preventDefault();
        setTransactionEditError(null);
        updateTransactionMutation.reset();

        const formData = new FormData(event.currentTarget);
        const amountInCents = Math.round(Number(formData.get("amount")) * 100);
        const date = String(formData.get("occurredAt"));
        const occurredAt = new Date(`${date}T00:00:00.000Z`);
        const type = String(formData.get("type"));

        if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
            setTransactionEditError("Enter an amount greater than zero.");
            return;
        }

        if (!date || Number.isNaN(occurredAt.getTime())) {
            setTransactionEditError("Enter a valid date.");
            return;
        }

        if (type !== "income" && type !== "expense") {
            setTransactionEditError("Choose income or expense.");
            return;
        }

        updateTransactionMutation.mutate({
            transactionId,
            updates: {
                amountInCents,
                type,
                occurredAt: occurredAt.toISOString(),
                description: String(formData.get("description")).trim() || null
            }
        });
    }

    function handleScheduledItemEditSubmit(event: FormEvent<HTMLFormElement>, item: ScheduledItem) {
        event.preventDefault();
        setScheduledItemEditError(null);
        updateScheduledItemMutation.reset();

        const formData = new FormData(event.currentTarget);
        const name = String(formData.get("name")).trim();
        const amountInCents = Math.round(Number(formData.get("amount")) * 100);
        const dayOfMonth = Number(formData.get("dayOfMonth"));

        if (!name || name.length > 100 || !Number.isSafeInteger(amountInCents) || amountInCents <= 0
            || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
            setScheduledItemEditError("Enter a name, positive amount, and day from 1 to 31.");
            return;
        }

        updateScheduledItemMutation.mutate({ item, name, amountInCents, dayOfMonth });
    }

    function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setAccountFormError(null);

        const form = event.currentTarget;
        const formData = new FormData(form);
        const openingBalanceCents = Math.round(Number(formData.get("openingBalance")) * 100);

        if (!Number.isSafeInteger(openingBalanceCents)) {
            setAccountFormError("Enter a valid opening balance.");
            return;
        }

        accountMutation.mutate(
            {
                name: String(formData.get("name")),
                openingBalanceCents,
                currency: "EUR"
            },
            { onSuccess: () => form.reset() }
        );
    }

    function handleOnboardingSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setOnboardingError(null);

        const formData = new FormData(event.currentTarget);
        const parseAmount = (value: FormDataEntryValue | null): number | null => {
            const amountInCents = Math.round(Number(value) * 100);
            return Number.isSafeInteger(amountInCents) && amountInCents >= 0 ? amountInCents : null;
        };
        const parseEntries = (
            drafts: PlanEntryDraft[],
            field: "income" | "bill"
        ): { name: string; amountInCents: number; day: number }[] | null => {
            const entries: { name: string; amountInCents: number; day: number }[] = [];

            for (const [index] of drafts.entries()) {
                const name = String(formData.get(`${field}Name${index}`) ?? "").trim();
                const rawAmount = String(formData.get(`${field}Amount${index}`) ?? "").trim();
                const rawDay = String(formData.get(`${field}Day${index}`) ?? "").trim();

                if (!name && !rawAmount && !rawDay) {
                    continue;
                }

                const amountInCents = parseAmount(rawAmount);
                const day = Number(rawDay);

                if (!name || amountInCents === null || amountInCents <= 0 || !Number.isInteger(day) || day < 1 || day > 31) {
                    return null;
                }

                entries.push({ name, amountInCents, day });
            }

            return entries;
        };

        const recurringIncomes = parseEntries(incomeDrafts, "income");
        const recurringBills = parseEntries(billDrafts, "bill");
        const safetyReserveCents = parseAmount(formData.get("safetyReserve"));
        const monthlyInvestmentCents = parseAmount(formData.get("monthlyInvestment"));

        if (!recurringIncomes || !recurringBills || safetyReserveCents === null || monthlyInvestmentCents === null) {
            setOnboardingError("Complete each added item with a name, positive amount, and day from 1 to 31. Reserve and investment must be zero or more.");
            return;
        }

        let account: Omit<Account, "id" | "isActive"> | undefined;

        if (accounts.length === 0) {
            const name = String(formData.get("accountName") ?? "").trim();
            const openingBalanceCents = parseAmount(formData.get("openingBalance"));

            if (!name || openingBalanceCents === null) {
                setOnboardingError("Enter an account name and a valid opening balance.");
                return;
            }

            account = { name, openingBalanceCents, currency: "EUR" };
        }

        onboardingMutation.mutate({
            account,
            recurringIncomes: recurringIncomes.map(({ name, amountInCents, day }) => ({ name, amountInCents, expectedDayOfMonth: day })),
            recurringBills: recurringBills.map(({ name, amountInCents, day }) => ({ name, amountInCents, dueDayOfMonth: day })),
            safetyReserveCents,
            monthlyInvestmentCents
        });
    }

    function handleTransactionDelete(transactionId: string) {
        if (!user) {
            return;
        }

        deleteTransactionMutation.mutate({ transactionId });
    }

    const transactions = transactionsQuery.data?.transactions ?? [];
    const accounts = accountsQuery.data?.accounts.filter((account) => account.isActive) ?? [];
    const activeAccountId = selectedAccountId ?? accounts[0]?.id ?? "";
    const activeAccountIds = new Set(accounts.map((account) => account.id));
    const balanceInCents = accounts.reduce((total, account) => total + account.openingBalanceCents, 0) + transactions.filter((transaction) => activeAccountIds.has(transaction.accountId)).reduce(
        (total, transaction) => total + (transaction.type === "income" ? transaction.amountInCents : -transaction.amountInCents),
        0
    );
    const calculation = freeToSpendQuery.data?.calculation;
    const scheduledItems = freeToSpendQuery.data?.scheduledItems ?? [];
    const periodEndDate = freeToSpendQuery.data?.periodEndDate;
    const requiresOnboarding = Boolean(user) && financialSettingsQuery.data?.isConfigured === false;

    return (
        <main className="min-h-screen bg-[linear-gradient(125deg,#f7f7f2_0%,#edf4ee_52%,#f7f7f2_100%)] px-5 py-8 sm:px-8 lg:px-12">
            <div className="mx-auto max-w-6xl">
                <header className="mb-12 flex flex-col gap-5 border-b border-ink/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-spruce">Personal finance</p>
                        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Centwise</h1>
                    </div>
                    {user ? (
                        <div className="flex items-center gap-3 text-sm text-ink/65">
                            <span>{user.email}</span>
                            <a className="font-semibold text-spruce underline underline-offset-4" href="/imports">Import inbox</a>
                            <button className="font-semibold text-spruce underline underline-offset-4" disabled={logoutMutation.isPending} onClick={() => logoutMutation.mutate()} type="button">
                                Sign out
                            </button>
                        </div>
                    ) : null}
                </header>

                {!user ? (
                    <section className="grid max-w-2xl gap-8 border-l-4 border-clay bg-white/70 p-8 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:grid-cols-[1fr_auto] sm:items-end">
                        <div>
                            <h2 className="text-2xl font-semibold">{authMode === "login" ? "Welcome back" : "Create your account"}</h2>
                            <p className="mt-2 max-w-lg text-ink/65">Use a separate account for each household member. Your password never leaves the server as plain text.</p>
                        </div>
                        <form className="flex w-full max-w-sm flex-col gap-3" onSubmit={handleUserSubmit}>
                            <label className="text-sm font-semibold" htmlFor="email">Email address</label>
                            <input className="h-11 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" id="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
                            <label className="text-sm font-semibold" htmlFor="password">Password</label>
                            <input className="h-11 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" id="password" minLength={12} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" required type="password" value={password} />
                            <button className="h-11 bg-spruce px-4 font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60" disabled={authMutation.isPending} type="submit">
                                {authMutation.isPending ? "Checking account..." : authMode === "login" ? "Sign in" : "Create account"}
                            </button>
                            <button className="text-sm font-semibold text-spruce underline underline-offset-4" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")} type="button">
                                {authMode === "login" ? "Create an account" : "I already have an account"}
                            </button>
                            {authMutation.isError ? <p className="text-sm text-red-700">{authMutation.error.message}</p> : null}
                        </form>
                    </section>
                ) : accountsQuery.isLoading || financialSettingsQuery.isLoading ? (
                    <p className="py-16 text-center text-ink/60">Loading your financial setup...</p>
                ) : accountsQuery.isError || financialSettingsQuery.isError ? (
                    <p className="py-16 text-center text-red-700">Could not load your financial setup. Refresh to try again.</p>
                ) : requiresOnboarding ? (
                    <section className="max-w-3xl border-t-4 border-clay bg-white p-6 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-8">
                        <div className="mb-8 border-b border-ink/10 pb-6">
                            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-spruce">Your monthly plan</p>
                            <h2 className="mt-2 text-3xl font-semibold">Set up your starting point</h2>
                            <p className="mt-2 max-w-xl text-ink/60">Add what you know. Income and bills are optional, and you can change this plan later.</p>
                        </div>
                        <form className="grid gap-8" onSubmit={handleOnboardingSubmit}>
                            {accounts.length === 0 ? (
                                <fieldset className="grid gap-4">
                                    <legend className="text-xl font-semibold">Starting balance</legend>
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <label className="grid gap-2 text-sm font-semibold" htmlFor="setupAccountName">Account name
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" autoComplete="off" id="setupAccountName" name="accountName" placeholder="Main account" required />
                                        </label>
                                        <label className="grid gap-2 text-sm font-semibold" htmlFor="setupOpeningBalance">Balance today (EUR)
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" defaultValue="0.00" id="setupOpeningBalance" min="0" name="openingBalance" required step="0.01" type="number" />
                                        </label>
                                    </div>
                                </fieldset>
                            ) : null}

                            <fieldset className="grid gap-4">
                                <legend className="text-xl font-semibold">Monthly income</legend>
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="mt-1 text-sm text-ink/60">Leave empty if you have none or prefer to add it later.</p>
                                    </div>
                                    <button className="shrink-0 text-sm font-semibold text-spruce underline underline-offset-4" onClick={() => setIncomeDrafts((entries) => [...entries, { name: "", amount: "", day: "" }])} type="button">Add income</button>
                                </div>
                                {incomeDrafts.map((entry, index) => (
                                    <div className="grid gap-3 border-l-2 border-spruce/30 pl-4 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end" key={index}>
                                        <label className="grid gap-2 text-sm font-semibold">Name
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" name={`incomeName${index}`} onChange={(event) => setIncomeDrafts((entries) => entries.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Salary" value={entry.name} />
                                        </label>
                                        <label className="grid gap-2 text-sm font-semibold">Amount (EUR)
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" min="0.01" name={`incomeAmount${index}`} onChange={(event) => setIncomeDrafts((entries) => entries.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} placeholder="0.00" step="0.01" type="number" value={entry.amount} />
                                        </label>
                                        <label className="grid gap-2 text-sm font-semibold">Pay day
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" max="31" min="1" name={`incomeDay${index}`} onChange={(event) => setIncomeDrafts((entries) => entries.map((item, itemIndex) => itemIndex === index ? { ...item, day: event.target.value } : item))} placeholder="1-31" type="number" value={entry.day} />
                                        </label>
                                        <button aria-label="Remove income" className="h-11 px-2 text-sm font-semibold text-red-700 underline underline-offset-4" onClick={() => setIncomeDrafts((entries) => entries.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>
                                    </div>
                                ))}
                            </fieldset>

                            <fieldset className="grid gap-4">
                                <legend className="text-xl font-semibold">Monthly bills</legend>
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <p className="mt-1 text-sm text-ink/60">Add required recurring bills; one-off costs can be logged later.</p>
                                    </div>
                                    <button className="shrink-0 text-sm font-semibold text-spruce underline underline-offset-4" onClick={() => setBillDrafts((entries) => [...entries, { name: "", amount: "", day: "" }])} type="button">Add bill</button>
                                </div>
                                {billDrafts.map((entry, index) => (
                                    <div className="grid gap-3 border-l-2 border-clay/40 pl-4 sm:grid-cols-[1.2fr_1fr_0.7fr_auto] sm:items-end" key={index}>
                                        <label className="grid gap-2 text-sm font-semibold">Name
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" name={`billName${index}`} onChange={(event) => setBillDrafts((entries) => entries.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="Rent" value={entry.name} />
                                        </label>
                                        <label className="grid gap-2 text-sm font-semibold">Amount (EUR)
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" min="0.01" name={`billAmount${index}`} onChange={(event) => setBillDrafts((entries) => entries.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} placeholder="0.00" step="0.01" type="number" value={entry.amount} />
                                        </label>
                                        <label className="grid gap-2 text-sm font-semibold">Due day
                                            <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" max="31" min="1" name={`billDay${index}`} onChange={(event) => setBillDrafts((entries) => entries.map((item, itemIndex) => itemIndex === index ? { ...item, day: event.target.value } : item))} placeholder="1-31" type="number" value={entry.day} />
                                        </label>
                                        <button aria-label="Remove bill" className="h-11 px-2 text-sm font-semibold text-red-700 underline underline-offset-4" onClick={() => setBillDrafts((entries) => entries.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove</button>
                                    </div>
                                ))}
                            </fieldset>

                            <fieldset className="grid gap-4 border-t border-ink/10 pt-6">
                                <legend className="text-xl font-semibold">Protect what matters</legend>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="setupInvestment">Monthly investment (EUR)
                                        <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" defaultValue="0.00" id="setupInvestment" min="0" name="monthlyInvestment" required step="0.01" type="number" />
                                    </label>
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="setupReserve">Safety reserve (EUR)
                                        <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" defaultValue="0.00" id="setupReserve" min="0" name="safetyReserve" required step="0.01" type="number" />
                                    </label>
                                </div>
                            </fieldset>

                            <div className="grid gap-3 border-t border-ink/10 pt-6">
                                <button className="h-12 bg-spruce px-5 font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60" disabled={onboardingMutation.isPending} type="submit">
                                    {onboardingMutation.isPending ? "Saving your plan..." : "Save plan"}
                                </button>
                                {onboardingError ? <p className="text-sm text-red-700">{onboardingError}</p> : null}
                                {onboardingMutation.isError ? <p className="text-sm text-red-700">{onboardingMutation.error.message}</p> : null}
                            </div>
                        </form>
                    </section>
                ) : (
                    <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
                        <section className="border-t-4 border-spruce bg-white p-6 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-8">
                            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-ink/55">Free to spend</p>
                            <p className={`mt-4 text-5xl font-semibold tracking-tight ${calculation && calculation.freeToSpendCents < 0 ? "text-red-700" : "text-ink"}`}>{calculation ? formatCurrency(calculation.freeToSpendCents, "EUR") : "--"}</p>
                            <p className="mt-3 text-sm text-ink/60">Current liquid balance: {formatCurrency(balanceInCents, "EUR")} across {accounts.length} active {accounts.length === 1 ? "account" : "accounts"}.</p>
                            {calculation ? (
                                <div className="mt-6 border-l-2 border-spruce/40 pl-4">
                                    <p className="text-sm font-semibold uppercase tracking-[0.1em] text-spruce">Safe spending per day</p>
                                    <p className={`mt-1 text-3xl font-semibold ${calculation.freeToSpendCents < 0 ? "text-red-700" : "text-ink"}`}>{formatCurrency(calculation.dailySafeSpendCents, "EUR")}</p>
                                    <p className="mt-1 text-sm text-ink/60">
                                        {calculation.freeToSpendCents < 0
                                            ? `No safe spending room remains; the plan is short by ${formatCurrency(Math.abs(calculation.freeToSpendCents), "EUR")}.`
                                            : `Per remaining calendar day through ${periodEndDate ? formatPlanDate(periodEndDate) : "month end"}, including today.`}
                                    </p>
                                    <p className="mt-1 text-xs text-ink/50">When positive, the available amount is spread across {calculation.daysRemainingInMonth} days and rounded down to cents. Dates follow UTC.</p>
                                </div>
                            ) : null}
                            {freeToSpendQuery.isError ? <p className="mt-3 text-sm text-red-700">{freeToSpendQuery.error.message}</p> : null}

                            {accounts.length === 0 ? (
                                <form className="mt-10 grid gap-4 border-t border-ink/10 pt-8" onSubmit={handleAccountSubmit}>
                                    <div>
                                        <h2 className="text-xl font-semibold">Add your first account</h2>
                                        <p className="mt-1 text-sm text-ink/60">Start from the balance you have today.</p>
                                    </div>
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="accountName">Account name
                                        <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" id="accountName" name="name" placeholder="Main account" required />
                                    </label>
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="openingBalance">Opening balance (EUR)
                                        <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" id="openingBalance" name="openingBalance" placeholder="0.00" required step="0.01" type="number" />
                                    </label>
                                    <button className="h-11 bg-spruce px-4 font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60" disabled={accountMutation.isPending} type="submit">
                                        {accountMutation.isPending ? "Saving account..." : "Add account"}
                                    </button>
                                    {accountFormError ? <p className="text-sm text-red-700">{accountFormError}</p> : null}
                                    {accountMutation.isError ? <p className="text-sm text-red-700">{accountMutation.error.message}</p> : null}
                                </form>
                            ) : null}

                            <form className="mt-10 grid gap-4" onSubmit={handleTransactionSubmit}>
                                <div className="grid gap-2">
                                    <label className="text-sm font-semibold" htmlFor="description">Description</label>
                                    <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" id="description" name="description" placeholder="Lunch, salary, rent" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="amount">Amount
                                        <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" id="amount" min="0.01" name="amount" placeholder="0.00" required step="0.01" type="number" />
                                    </label>
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="type">Type
                                        <select className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" defaultValue="expense" id="type" name="type">
                                            <option value="expense">Expense</option>
                                            <option value="income">Income</option>
                                        </select>
                                    </label>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="occurredAt">Date
                                        <input className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" defaultValue={new Date().toISOString().slice(0, 10)} id="occurredAt" name="occurredAt" required type="date" />
                                    </label>
                                    <label className="grid gap-2 text-sm font-semibold" htmlFor="accountId">Account
                                        <select className="h-11 border border-ink/20 bg-canvas px-3 outline-none ring-spruce focus:ring-2" disabled={accounts.length === 0} id="accountId" onChange={(event) => setSelectedAccountId(event.target.value)} value={activeAccountId}>
                                            {accounts.length === 0 ? <option value="">Add an account first</option> : null}
                                            {accounts.map((account) => (
                                                <option key={account.id} value={account.id}>{account.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <button className="mt-2 h-11 bg-clay px-4 font-semibold text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60" disabled={transactionMutation.isPending || accounts.length === 0} type="submit">
                                    {transactionMutation.isPending ? "Saving..." : "Add transaction"}
                                </button>
                                {formError ? <p className="text-sm text-red-700">{formError}</p> : null}
                                {transactionMutation.isError ? <p className="text-sm text-red-700">{transactionMutation.error.message}</p> : null}
                            </form>
                        </section>

                        <div className="grid gap-8">
                            <section className="bg-white/70 p-6 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-8">
                                <div className="mb-6 border-b border-ink/10 pb-5">
                                    <h2 className="text-2xl font-semibold">This month&apos;s plan</h2>
                                    <p className="mt-1 text-sm text-ink/60">These amounts are already accounted for in free to spend.</p>
                                    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
                                        <div className="bg-white p-4">
                                            <dt className="text-sm text-ink/60">Bills still due</dt>
                                            <dd className="mt-1 font-semibold">{calculation ? formatCurrency(calculation.remainingBillsCents, "EUR") : "--"}</dd>
                                        </div>
                                        <div className="bg-white p-4">
                                            <dt className="text-sm text-ink/60">Monthly investment</dt>
                                            <dd className="mt-1 font-semibold">{calculation ? formatCurrency(calculation.remainingInvestmentCents, "EUR") : "--"}</dd>
                                        </div>
                                        <div className="bg-white p-4">
                                            <dt className="text-sm text-ink/60">Safety reserve</dt>
                                            <dd className="mt-1 font-semibold">{calculation ? formatCurrency(calculation.safetyReserveCents, "EUR") : "--"}</dd>
                                        </div>
                                    </dl>
                                </div>
                                <div>
                                    <div className="flex items-baseline justify-between gap-4">
                                        <h3 className="text-xl font-semibold">Coming up</h3>
                                        <span className="text-sm text-ink/55">Remaining income and bills</span>
                                    </div>
                                    {freeToSpendQuery.isLoading ? <p className="mt-4 text-sm text-ink/60">Loading your monthly plan...</p> : null}
                                    {freeToSpendQuery.isError ? <p className="mt-4 text-sm text-red-700">{freeToSpendQuery.error.message}</p> : null}
                                    {!freeToSpendQuery.isLoading && !freeToSpendQuery.isError && scheduledItems.length === 0 ? (
                                        <p className="mt-4 text-sm text-ink/60">No more scheduled income or bills this month.</p>
                                    ) : null}
                                    {scheduledItems.length > 0 ? (
                                        <ul className="mt-3 divide-y divide-ink/10">
                                            {scheduledItems.map((item) => (
                                                <li className="border-b border-ink/10 py-3 last:border-0" key={`${item.type}-${item.id}`}>
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="min-w-0">
                                                            <p className="truncate font-medium">{item.name}</p>
                                                            <p className="text-sm text-ink/55">{item.type === "income" ? "Income" : "Bill"} - {formatPlanDate(item.date)}</p>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-3">
                                                            <p className={`font-semibold ${item.type === "income" ? "text-spruce" : "text-ink"}`}>
                                                                {item.type === "income" ? "+" : "-"}{formatCurrency(item.amountInCents, "EUR")}
                                                            </p>
                                                            <button
                                                                className="text-sm font-semibold text-spruce underline underline-offset-4"
                                                                onClick={() => {
                                                                    setEditingScheduledItem({ id: item.id, type: item.type });
                                                                    setScheduledItemEditError(null);
                                                                    updateScheduledItemMutation.reset();
                                                                }}
                                                                type="button"
                                                            >
                                                                Edit
                                                            </button>
                                                        </div>
                                                    </div>
                                                    {editingScheduledItem?.id === item.id && editingScheduledItem.type === item.type ? (
                                                        <form className="mt-4 grid gap-3 border-l-2 border-spruce/30 pl-4 sm:grid-cols-3" onSubmit={(event) => handleScheduledItemEditSubmit(event, item)}>
                                                            <label className="grid gap-1 text-sm font-semibold">Name
                                                                <input className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={item.name} maxLength={100} name="name" required />
                                                            </label>
                                                            <label className="grid gap-1 text-sm font-semibold">Amount (EUR)
                                                                <input className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={(item.amountInCents / 100).toFixed(2)} min="0.01" name="amount" required step="0.01" type="number" />
                                                            </label>
                                                            <label className="grid gap-1 text-sm font-semibold">{item.type === "bill" ? "Due day" : "Expected day"}
                                                                <input className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={item.dayOfMonth} max="31" min="1" name="dayOfMonth" required type="number" />
                                                            </label>
                                                            <div className="flex items-center gap-4 sm:col-span-3">
                                                                <button className="h-10 bg-spruce px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={updateScheduledItemMutation.isPending} type="submit">
                                                                    {updateScheduledItemMutation.isPending ? "Saving..." : "Save changes"}
                                                                </button>
                                                                <button className="text-sm font-semibold text-ink/60 underline underline-offset-4" onClick={() => setEditingScheduledItem(null)} type="button">Cancel</button>
                                                            </div>
                                                            {scheduledItemEditError ? <p className="text-sm text-red-700 sm:col-span-3">{scheduledItemEditError}</p> : null}
                                                            {updateScheduledItemMutation.isError ? <p className="text-sm text-red-700 sm:col-span-3">{updateScheduledItemMutation.error.message}</p> : null}
                                                        </form>
                                                    ) : null}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : null}
                                    {calculation ? (
                                        <p className="mt-3 text-sm text-ink/60">
                                            Remaining this month: {formatCurrency(calculation.remainingIncomeCents, "EUR")} income and {formatCurrency(calculation.remainingBillsCents, "EUR")} in bills.
                                        </p>
                                    ) : null}
                                    {periodEndDate ? <p className="mt-1 text-xs text-ink/50">Plan runs through {formatPlanDate(periodEndDate)} (UTC).</p> : null}
                                </div>
                            </section>
                            <section className="bg-white/70 p-6 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-8">
                                <div className="mb-6 flex items-end justify-between border-b border-ink/10 pb-4">
                                    <div>
                                        <h2 className="text-2xl font-semibold">Activity</h2>
                                        <p className="mt-1 text-sm text-ink/60">Most recent transactions first.</p>
                                    </div>
                                    <span className="text-sm font-semibold text-spruce">{transactions.length} total</span>
                                </div>
                                {transactionsQuery.isLoading ? <p className="py-10 text-center text-ink/60">Loading transactions...</p> : null}
                                {transactionsQuery.isError ? <p className="py-10 text-center text-red-700">{transactionsQuery.error.message}</p> : null}
                                {!transactionsQuery.isLoading && !transactionsQuery.isError && transactions.length === 0 ? <p className="py-10 text-center text-ink/60">Your recorded activity will appear here.</p> : null}
                                <ul className="divide-y divide-ink/10">
                                    {transactions.map((transaction) => (
                                        <li className="py-4" key={transaction.id}>
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0">
                                                    <p className="truncate font-semibold">{transaction.description ?? "Untitled transaction"}</p>
                                                    <p className="mt-1 text-sm text-ink/55">{new Date(transaction.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-3">
                                                    <p className={`font-semibold ${transaction.type === "expense" ? "text-red-700" : "text-spruce"}`}>{transaction.type === "expense" ? "-" : "+"}{formatCurrency(transaction.amountInCents, transaction.currency)}</p>
                                                    <button
                                                        className="text-sm font-semibold text-spruce underline underline-offset-4"
                                                        onClick={() => {
                                                            setEditingTransactionId(transaction.id);
                                                            setTransactionEditError(null);
                                                            updateTransactionMutation.reset();
                                                        }}
                                                        type="button"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button aria-label={`Remove ${transaction.description ?? "transaction"}`} className="text-sm font-semibold text-ink/50 underline underline-offset-4 transition hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={deleteTransactionMutation.isPending} onClick={() => handleTransactionDelete(transaction.id)} type="button">Remove</button>
                                                </div>
                                            </div>
                                            {editingTransactionId === transaction.id ? (
                                                <form className="mt-4 grid gap-3 border-l-2 border-spruce/30 pl-4 sm:grid-cols-2" onSubmit={(event) => handleTransactionEditSubmit(event, transaction.id)}>
                                                    <label className="grid gap-1 text-sm font-semibold">Description
                                                        <input className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={transaction.description ?? ""} maxLength={500} name="description" />
                                                    </label>
                                                    <label className="grid gap-1 text-sm font-semibold">Amount (EUR)
                                                        <input className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={(transaction.amountInCents / 100).toFixed(2)} min="0.01" name="amount" required step="0.01" type="number" />
                                                    </label>
                                                    <label className="grid gap-1 text-sm font-semibold">Type
                                                        <select className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={transaction.type} name="type">
                                                            <option value="expense">Expense</option>
                                                            <option value="income">Income</option>
                                                        </select>
                                                    </label>
                                                    <label className="grid gap-1 text-sm font-semibold">Date
                                                        <input className="h-10 border border-ink/20 bg-white px-3 outline-none ring-spruce focus:ring-2" defaultValue={transaction.occurredAt.slice(0, 10)} name="occurredAt" required type="date" />
                                                    </label>
                                                    <div className="flex items-center gap-4 sm:col-span-2">
                                                        <button className="h-10 bg-spruce px-4 text-sm font-semibold text-white disabled:opacity-60" disabled={updateTransactionMutation.isPending} type="submit">
                                                            {updateTransactionMutation.isPending ? "Saving..." : "Save changes"}
                                                        </button>
                                                        <button className="text-sm font-semibold text-ink/60 underline underline-offset-4" onClick={() => setEditingTransactionId(null)} type="button">Cancel</button>
                                                    </div>
                                                    {transactionEditError ? <p className="text-sm text-red-700 sm:col-span-2">{transactionEditError}</p> : null}
                                                    {updateTransactionMutation.isError ? <p className="text-sm text-red-700 sm:col-span-2">{updateTransactionMutation.error.message}</p> : null}
                                                </form>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                                {deleteTransactionMutation.isError ? <p className="mt-4 text-sm text-red-700">{deleteTransactionMutation.error.message}</p> : null}
                            </section>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}