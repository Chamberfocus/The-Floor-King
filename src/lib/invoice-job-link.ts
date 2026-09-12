/**
 * Which job an ad-hoc "New invoice" should attach to.
 * One active job → link it. Zero or many → staff must pick (or leave unlinked).
 */
export function defaultInvoiceJobId(
  activeJobIds: readonly string[],
): string | null {
  return activeJobIds.length === 1 ? activeJobIds[0] : null;
}
