The General Auditor real-order regression library is
`general-audit-real-orders.json`. `server/generalRealOrderLibrary.test.ts` runs
every case against the catalogue-first production audit engine and the extension
report during `npm test` and the existing GitHub regression workflow.

Add a case for each newly reported format before fixing it. Include a stable ID,
category, the independently supplied request and confirmation, expected match
status and both quantity lists. Keep genuine differences in the example. Omit
tracking IDs, contact numbers and unrelated patient/clinical details. Never alter
expected quantities or names simply to make a failing audit pass.

Model recovery, rejection of unsupported model output, provider outages, timeouts
and unreadable list classification are tested separately in
`server/generalExtractionDecision.test.ts`; these tests use mocked providers and
do not consume production AI quota. The new library complements the existing
individual regression files, rather than replacing their safety and quantity cases.
