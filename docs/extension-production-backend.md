The extension uses https://ordercheck-production.up.railway.app permanently.

The popup, side panel, authenticated API helper, background allocation reader and downloadable ZIP share the production target in extension/backend-target.js. The checked-in configuration and Chrome host permission include the same URL. Old customBackendUrl settings are ignored and removed when the panel opens. The backend field is read-only; no Save step is needed. Downloads from localhost or a previous deployment still target production.

Install the latest extension version from the website's Extension tab, replace the existing extracted extension files, reload OrderCheck in chrome://extensions and refresh FS tabs. Existing installations cannot receive these file changes until reloaded with the updated package.

This fixes backend selection; it does not bypass authentication, Firestore permissions, network failures or provider quotas. Production health returned HTTP 200 during verification. Recent production logs showed no quota, permission, crash or network errors.
