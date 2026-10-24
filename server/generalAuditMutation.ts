// Product confirmation and order-limit acknowledgements update the same audit.
// Serialize those actions so one saved decision cannot overwrite the other.
export const generalAuditMutations = new Map<string, Promise<void>>();
