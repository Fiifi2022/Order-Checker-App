# OrderCheck

## Run

Use **Node.js 22 or newer** (required by Firebase Admin 14). With nvm, run `nvm use` to select the version in `.nvmrc`. Run `npm install`, then `npm run dev`. Use `npm run build` and `npm start` for production.

## Authentication setup

The app uses Firebase email/password and Google sign-in with server-verified ID tokens. Only accounts with an assigned team role can access the portal. Sessions persist through Firebase Auth; signing out removes the portal and its local state.

1. In the Firebase project from `firebase-applet-config.json`, enable **Authentication → Sign-in method → Email/Password** and **Google**. Add your application hostname (and `localhost` for development) to **Authentication → Settings → Authorized domains**.
2. Provide Application Default Credentials to the server, for example with `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account file outside the repository. Grant the service account Firestore access and Firebase Authentication access needed to check revoked tokens. Never put server credentials in `VITE_` variables or commit them.
3. Set `AUTH_BOOTSTRAP_ADMIN_EMAIL` to the verified Google email of your initial administrator. This grants access only when no stored role exists for that email. The role database must be reachable; errors fail closed. The bootstrap administrator can use either a verified email/password account or Google.
4. Sign in as that administrator and use **Team Roles** to assign roles by email. Save a persistent administrator role for your own email before removing the bootstrap environment variable. Roles are checked on each API request, so deleting a role removes access immediately.
5. Deploy `firestore.rules` to the configured Firestore database. These rules deny direct client access; all persistence uses the server Admin SDK. Existing permissive rules must be replaced to prevent bypassing API authentication.

Administrators manage team roles and blueprints. Warehouse members (including legacy DCO accounts) and Compliance Auditors have full blueprint administration: upload, edit, synchronize, reset, and delete blueprints, districts, cycles, facilities, and quotas. Warehouse members also manage stock and adjustments. CCA members run audits and confirmations. Compliance Auditors review records and run verification. A person can hold multiple roles; their permissions are combined. In Team Roles, use **Edit roles** and select all applicable roles. Existing single-role accounts remain supported. Identity switching is disabled, and writes use the authenticated actor.

`GET /api/health` remains public. Other API endpoints require `Authorization: Bearer <Firebase ID token>`, including browser extension requests. The extension signs in with Firebase email/password, refreshes ID tokens, and sends authenticated audits to the selected backend. Accounts must have verified email and an assigned role. Google-only users can ask an administrator for a password reset link to set a password on the same account.

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

## Chrome extension with Render

Deploy the complete repository as a Render **Web Service**, using Node 22+, build command `npm ci && npm run build`, and start command `npm start`. Keep the `extension/` folder and `firebase-applet-config.json` in the deployed repository. The server already listens on Render's `PORT` and `0.0.0.0`.

Set `APP_URL=https://your-service.onrender.com` in Render (or your HTTPS custom domain); the download falls back to a valid `RENDER_EXTERNAL_URL` or the requesting host if `APP_URL` is empty, a placeholder, or invalid. Local downloads use HTTP for localhost. Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` from your Firebase service account, plus `GEMINI_API_KEY` for AI audits, in Render environment variables. Add the Render hostname to Firebase Authentication's authorized domains for portal sign-in.

In the signed-in portal, open the Extension tab and click **Download Packed ZIP**. Extract it, open `chrome://extensions`, enable Developer mode, and load the extracted folder. The download automatically sets the current backend and public Firebase API key. For the source `extension/` folder, enter your Render base URL in the popup and click **Save**. The backend setting survives popup closure. Changing services signs you out before sending further authenticated requests.

Sign in with your approved portal email/password account, paste or capture both logs, then click Analyze. Passwords are never saved. The extension session lasts until sign-out or browser restart; ID tokens refresh automatically. Render startup has a 90-second connection timeout and audits have a 180-second timeout. The health badge confirms service reachability; account approval is checked separately when signing in and auditing. Failed audit submissions are not automatically retried.

Companion v1.4.1 displays all assigned roles and uses the portal's current General Auditor with a fresh catalog revision for each audit. Its **Product Catalog** supports search, product editing, Fulfillment System names, receiving details, linked product syncing, and reviewed Gemini alias suggestions. The backend grants Administrator, Warehouse, and Compliance edit access; CCA can browse and receive reminders. Optional screenshot uploads (or pasted images) for either log use the same scanning endpoint as the app. Receiving reminders appear for entered, captured, or extracted product text. Input changes discard old results; order-limit decisions immediately acknowledge the existing result and are saved to history in the background without rerunning analysis. Use **Open portal** for blueprint administration, role assignment, and the full Vaccine Checker.

The saved backend URL selects the running service. After deploying new server code at that same URL, server behavior and persisted catalog/role changes apply to subsequent extension requests. Editing local source files alone does not update a remote deployment. Extension HTML and JavaScript run from the installed files: entering a backend URL does not replace those files. Download and reload the current package once to receive new extension controls and the immediate order-limit acknowledgement behavior.

To update an installed copy, replace its files with the new extracted download, click **Reload** in `chrome://extensions`, and refresh any tabs used for capture.

## Product Catalog

Open **Product Catalog** in the portal header to search the existing medicines, blood products, consumables, vaccines, and companion products by name or alias. Administrators, Warehouse (including legacy DCO), and Compliance Auditors can add products and edit aliases; CCA members can browse the catalog.

Choose **Add product**, enter the canonical name, select **General Auditor** or **Vaccine Checker**, and enter aliases one per line. Select an existing product to update its aliases or notes. Ambiguous General Auditor aliases can be listed under **Aliases requiring context**, with an explanatory note. Product names shown in the catalog are editable. A renamed display label is saved as an alias while the original identity and scope stay fixed to protect allocation keys and history. Different formulations, strengths, and vaccine companions must remain separate identities.

Products also have optional **Fulfillment System name** and **How this product is received / supplied** fields. The system name becomes a recognized alias. Receiving details appear beside matching order inputs in General Auditor and Vaccine Checker, including text extracted from screenshots. Reminders match whole product names or unambiguous aliases and keep different strengths and companions separate. They are informational and do not change quantity conversions. Changed receiving fields sync to the selected linked product when saved. Clear a field and save to remove its reminder.

The first catalog access seeds `product_catalog/current` in the existing Firestore database from the application's terminology, acronym, packaging, and vaccine lists. Changes persist across server restarts and deployments. The server loads the catalog before matching orders; General Auditor also refreshes its browser vocabulary before each audit. Gemini is not required to maintain or use catalog aliases. Concurrent edits use a catalog revision; reload before saving if another team member changed it. `GET /api/products` reads the catalog and `POST /api/products` creates or updates one product. The old in-memory vaccine alias write endpoint now directs callers to Product Catalog.

Aliases identify products; editing them does not change package conversion factors, doses per vial, stock, quotas, or allocation rules. Catalog availability is required for new audits so an unavailable database cannot silently substitute stale aliases.

### Local API changes

Run `npm run dev` from the repository root. Development bundles and watches the backend with esbuild, runs it in a plain Node process, and keeps Vite frontend updates enabled. It avoids TypeScript loader conflicts and ignores Vite temporary files. Node 22.12 or newer is required; the launcher automatically uses a supported nvm runtime if the terminal selects an older Node. If none is installed, run `nvm install 22` and `nvm use 22` first. If a newly added endpoint reports `API route not found` in an already running session, stop that older session with Ctrl+C and run `npm run dev` again. Reload the browser after the restart. When using `npm start` locally, rebuild with `npm run build` and restart `npm start` to pick up server changes.

In Product Catalog, select a product and choose **Suggest aliases with Gemini** to request established names and abbreviations. Select the suggestions you approve, click **Add selected suggestions**, then **Save product**. Gemini suggestions do not write to the catalog automatically. Duplicate or conflicting suggestions are filtered, ambiguous General Auditor terms are marked as requiring context, and ambiguous Vaccine Checker terms are excluded. If Gemini is unavailable or its quota is exhausted, manual catalog editing still works.

Use **Sync new aliases to** to select the same product's entry in the other checker. An explicit canonical-name match can preselect its counterpart; you can change it or choose **This checker only**. Saving atomically adds newly approved aliases to both entries and links them for future additions in either direction. Existing aliases and their meanings are retained independently; the sync does not copy all historical aliases, remove aliases from the other entry, or change quantities and allocation rules. Context-required aliases cannot sync into Vaccine Checker. Both engines load the saved catalog for subsequent audits. The authenticated `POST /api/products/suggest-aliases` endpoint uses Gemini only when a catalog manager requests suggestions.
