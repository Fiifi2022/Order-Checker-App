/** Request-local reads only: never reuse stale permissions, catalogues or facilities. */
export function startGeneralAuditReferenceReads<T, S>(readDirectory: () => Promise<T>, readSheets: () => Promise<S>, optionalTimeoutMs: number) {
  const directory = Promise.resolve().then(readDirectory).then(value => ({value}), error => ({error}));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const identity = Promise.race([
    Promise.resolve().then(readSheets),
    new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error('Identity reference unavailable')), Math.max(1, optionalTimeoutMs));}),
  ]).then(sheets => ({sheets}), () => ({sheets: null})).finally(() => clearTimeout(timer));
  return {directory, identity};
}
