# OrderCheck

## Run

`npm install`, then `npm run dev`. Use `npm run build` and `npm start` for production.

## Authentication setup

The app uses Firebase email/password and Google sign-in with server-verified ID tokens. Only accounts with an assigned team role can access the portal. Sessions persist through Firebase Auth; signing out removes the portal and its local state.

1. In the Firebase project from `firebase-applet-config.json`, enable **Authentication → Sign-in method → Email/Password** and **Google**. Add your application hostname (and `localhost` for development) to **Authentication → Settings → Authorized domains**.
2. Provide Application Default Credentials to the server, for example with `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account file outside the repository. Grant the service account Firestore access and Firebase Authentication access needed to check revoked tokens. Never put server credentials in `VITE_` variables or commit them.
3. Set `AUTH_BOOTSTRAP_ADMIN_EMAIL` to the verified Google email of your initial administrator. This grants access only when no stored role exists for that email. The role database must be reachable; errors fail closed. The bootstrap administrator can use either a verified email/password account or Google.
4. Sign in as that administrator and use **Team Roles** to assign roles by email. Save a persistent administrator role for your own email before removing the bootstrap environment variable. Roles are checked on each API request, so deleting a role removes access immediately.
5. Deploy `firestore.rules` to the configured Firestore database. These rules deny direct client access; all persistence uses the server Admin SDK. Existing permissive rules must be replaced to prevent bypassing API authentication.

Administrators manage team roles and blueprints. Warehouse members manage stock and adjustments. CCA members run audits and confirmations. Auditors have read access and can run verification. Identity switching is disabled, and writes use the authenticated actor.

`GET /api/health` remains public. Other API endpoints require `Authorization: Bearer <Firebase ID token>`, including browser extension requests. The existing extension does not yet include a Google sign-in flow; use the authenticated web portal for audits.

## Checks

`npm run lint`, `npm test`, and `npm run build`.

## Sign-up and approval

Users can choose **Sign up** and enter their full name, position, Nest, email, and password. Passwords stay with Firebase Authentication; the application stores only name, position, Nest, and account identity in `user_profiles`. Email/password accounts receive a verification link. If profile saving or email delivery fails, users can complete their profile or resend verification while signed in.

New users see a pending-access screen until their email is verified and a role is assigned. Administrators open **Team Roles → Pending sign-ups → Review access**, choose the appropriate role and district, and save. A stated position does not grant an access role. Users can click **Check verification and access** after verification and approval. Google accounts without assigned access can also complete a profile.

Firebase’s [email/password authentication](https://firebase.google.com/docs/auth/web/password-auth) and [email verification](https://firebase.google.com/docs/auth/web/manage-users) documentation cover provider setup and email templates.

## Administrator account support

Open **Administration → Signed-up accounts** to view Firebase accounts, including users who have not completed their profiles. The view shows name, email, position, Nest, assigned role, email verification, disabled status, sign-up date, and last sign-in. Lists load 100 accounts per page; use **Load more accounts** to browse further.

Administrators can edit name, position, and Nest, assign or update roles, enable or disable accounts, revoke sessions, and set a new password for email/password accounts. Password changes revoke existing sessions. Administrators cannot disable their own account. Google passwords must be changed through Google.

Password reset and email verification links can be generated and copied for private delivery to the account holder. Generating a link does not send an email. Passwords and links are excluded from account action logs; action metadata is stored in `account_admin_logs`. Recovery responses are not cached. Firebase credential hashes are never included in account list responses.

The server service account needs Firebase Authentication user-management permissions (for example, the Firebase Authentication Admin IAM role) and Firestore access. Profile edits update Firestore and the Firebase display name; if a step fails, reload the details before retrying. These operations use Firebase’s [Admin user management](https://firebase.google.com/docs/auth/admin/manage-users) and [recovery link APIs](https://firebase.google.com/docs/auth/admin/email-action-links).
