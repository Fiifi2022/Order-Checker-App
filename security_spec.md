# OrderCheck authentication and access control

## Trust boundary

The browser signs in with Firebase Authentication using Google or email/password. Every API request except `GET /api/health` requires a Firebase ID token in its Authorization header. The server verifies token signatures, expiration, revocation, and account status with Firebase Admin. Unverified email and anonymous accounts are rejected for operational access. Two narrowly scoped onboarding routes allow non-anonymous accounts with an email to save or read their own registration profile before verification; the UID and email always come from the verified token.

A verified identity must also have a stored `user_roles` record for its email. Roles are read on each request, so revoking or changing access takes effect on subsequent requests. Role storage failures return 503 and do not grant access. An explicitly configured `AUTH_BOOTSTRAP_ADMIN_EMAIL` can bootstrap the first administrator only when no stored role exists for that email.

Self-registration stores name, position, and Nest without an access role. Only an administrator can approve operational access by assigning a role. Passwords are handled solely by Firebase Authentication.

## Authorization

- Administrators can manage roles, blueprints, configuration, and operational data.
- Warehouse and legacy DCO accounts can manage stock and adjustments and run operational audits and confirmations.
- CCA accounts can run audits and confirm orders, without changing quotas, stock, roles, or blueprint configuration.
- Auditors can inspect data and run verification, without making operational changes.
- Only administrators can clear or reset data.

District assignments remain profile metadata; this change does not implement district-specific data isolation.

## Identity integrity

Operating identity comes from the authenticated account. Request-scoped context prevents simultaneous users from sharing a global active identity. Caller-supplied actor, user, CCA user, and role-attribution values are replaced before handlers run. The identity-switch endpoint is disabled for every role.

## Persistence

Firestore client rules deny all direct reads and writes. The Express server persists records using Application Default Credentials through Firebase Admin. Deploy the rules to the configured database to prevent bypassing the API through the client SDK. Administrator role writes must persist successfully before the API reports success.

Service account credentials stay on the server. ID tokens are attached only to same-origin API requests by the web client. Sign-out unmounts the portal and clears its component state. Tokens are managed and refreshed by Firebase Auth.

## Validation and limits

`server/auth.test.ts` checks missing or invalid tokens, verified identities, assigned roles, role removal, unavailable role storage, caller identity spoofing, and management permissions. The application test suite also exercises atomic vaccine confirmations and audit behavior.

Live Google sign-in, credential permissions, and deployed Firestore rules must be verified in the configured Firebase environment. The existing extension has no sign-in flow and cannot call protected endpoints until it supplies a verified Firebase token. Existing collection payload validation and audit semantics remain in the server handlers; the Admin SDK does not enforce client rules.

## Administrative account support

The `/api/admin/accounts` routes require an administrator for both reads and writes. Handlers also check this permission independently. Lists return an explicit public profile projection without password hashes, salts, or custom claims. Profiles accept only name, position, and Nest; they cannot set permission fields.

Account actions have a fixed allowlist: update password, disable, enable, revoke sessions, generate password reset link, or generate email verification link. Password changes require 8–128 characters and revoke sessions. Google-only accounts cannot have their Google password changed here. Self-disabling is rejected. No account deletion, manual verification bypass, or email changes are exposed.

Account-action logs contain actor identity, target UID, action, and timestamp, with no passwords or recovery links. API responses use `Cache-Control: no-store`. Generated links stay in the administrator’s current view until it is closed or another account is selected. Live user-management actions require the configured service account’s Firebase Authentication permissions.
