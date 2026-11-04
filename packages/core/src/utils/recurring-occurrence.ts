export function getUtcDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function getRecurringOccurrenceDate(year: number, monthIndex: number, dayOfMonth: number): string {
    const lastDayOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const month = String(monthIndex + 1).padStart(2, "0");
    const day = String(Math.min(dayOfMonth, lastDayOfMonth)).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export function getUtcMonthStartDate(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}
