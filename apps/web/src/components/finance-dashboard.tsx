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

export function FinanceDashboard() {
    const queryClient = useQueryClient();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [formError, setFormError] = useState<string | null>(null);
    const [accountFormError, setAccountFormError] = useState<string | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

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
        queryFn: () => requestJson<{ calculation: FreeToSpendResult }>("/api/free-to-spend"),
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
                ) : (
                    <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
                        <section className="border-t-4 border-spruce bg-white p-6 shadow-[0_20px_50px_-32px_rgba(23,33,29,0.45)] sm:p-8">
                            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-ink/55">Free to spend</p>
                            <p className={`mt-4 text-5xl font-semibold tracking-tight ${calculation && calculation.freeToSpendCents < 0 ? "text-red-700" : "text-ink"}`}>{calculation ? formatCurrency(calculation.freeToSpendCents, "EUR") : "--"}</p>
                            <p className="mt-3 text-sm text-ink/60">Current liquid balance: {formatCurrency(balanceInCents, "EUR")} across {accounts.length} active {accounts.length === 1 ? "account" : "accounts"}.</p>
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
                                    <li className="flex items-center justify-between gap-4 py-4" key={transaction.id}>
                                        <div className="min-w-0">
                                            <p className="truncate font-semibold">{transaction.description ?? "Untitled transaction"}</p>
                                            <p className="mt-1 text-sm text-ink/55">{new Date(transaction.occurredAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3">
                                            <p className={`font-semibold ${transaction.type === "expense" ? "text-red-700" : "text-spruce"}`}>{transaction.type === "expense" ? "-" : "+"}{formatCurrency(transaction.amountInCents, transaction.currency)}</p>
                                            <button aria-label={`Remove ${transaction.description ?? "transaction"}`} className="text-sm font-semibold text-ink/50 underline underline-offset-4 transition hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={deleteTransactionMutation.isPending} onClick={() => handleTransactionDelete(transaction.id)} type="button">Remove</button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            {deleteTransactionMutation.isError ? <p className="mt-4 text-sm text-red-700">{deleteTransactionMutation.error.message}</p> : null}
                        </section>
                    </div>
                )}
            </div>
        </main>
    );
}