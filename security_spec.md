# Zipline Ghana OrderCheck Compliance - Firebase Firestore Security Specification

This document details the security spec and threat model for the Zipline Order Auditing Firestore database, in accordance with Zero-Trust guidelines.

## 1. Data Invariants

1. **Authorization**: Only authenticated users (e.g. verified Customer Care team members) can read, create, or update audit records. 
2. **Immutability of Key Fields**: Once an audit is created, critical fields such as `id`, `timestamp`, `whatsappMessage`, `fulfillmentConfirmation`, `confidence`, `verdict`, and `allMatch` cannot be modified by any tier other than standard system automations.
3. **Pillared Updates**: Updates are only allowed for changing the status and appending resolution notes. No ghost fields can be injected.
4. **Valid States**: Status can only transition to `'resolved'` or `'ignored'` from `'pending'`.
5. **Confidence Range**: Confidence must be a valid integer between 0 and 100 inclusive.

---

## 2. The "Dirty Dozen" Threat Payloads

Every single one of these payloads must be rejected (`PERMISSION_DENIED`) by the firestore rules engine:

1. **Payload 1: Unauthenticated Creation**
   - Attempt by an unauthenticated user to write any audit log.
2. **Payload 2: Set Tampered ID**
   - Injecting SQL-like injection or massive character buffers as the document ID path variable.
3. **Payload 3: Identity Spoofing (Owner bypass)**
   - Attempt to override the automated audit fields to claim credit or tamper with analytics.
4. **Payload 4: Invalid Status Enum Val**
   - Setting status to `'approved_by_kwame'` instead of standard `['pending', 'resolved', 'ignored']`.
5. **Payload 5: Immutability Tampering (Changing WhatsApp Message)**
   - Attempting to update `whatsappMessage` text on an existing document.
6. **Payload 6: Fraudulent Confidence Inflation**
   - Attempting to rewrite the confidence index from custom levels to standard 100 on mismatch audits.
7. **Payload 7: Value Type Poisoning**
   - Updating `resolutionNotes` with a numeric array or boolean instead of a string.
8. **Payload 8: Denial-of-Wallet Buffer Overflow**
   - Injecting a 2MB string into `resolutionNotes`.
9. **Payload 9: Ghost Field Insertion**
   - Passing an extra key `isVerifiedBySystem: true` during update.
10. **Payload 10: State Shortcircuiting**
    - Transitioning a completed/resolved audit record's `resolutionNotes` after a final resolution has been cleared.
11. **Payload 11: Spoofed Server Timestamp**
    - Providing a custom client date string on `resolvedAt` instead of relying on `request.time`.
12. **Payload 12: Anonymous User Intrusion**
    - Attempting write operations using an unverified or anonymous user account.

---

## 3. Test Runner Design

The rules will be fully verified against these conditions using the local rules flat recommended checking configuration. No operation can proceed if these checks fail.
