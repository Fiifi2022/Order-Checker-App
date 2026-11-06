/** Gemini rejects a manually advertised server deadline below ten seconds.
 * Short audit budgets are enforced independently with optionalAuditAi's abort
 * signal; raising this transport deadline does not extend the caller's wait. */
export function geminiProviderTimeout(milliseconds:number):number {
 return Math.max(10_000,Number.isFinite(milliseconds)?Math.ceil(milliseconds):10_000);
}
