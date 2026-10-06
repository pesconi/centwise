export type TransactionType = "income" | "expense";

export interface Transaction {
    id: string;
    userId: string;
    amountInCents: number;
    currency: string;
    type: TransactionType;
    occurredAt: Date;
    description: string | null;
}