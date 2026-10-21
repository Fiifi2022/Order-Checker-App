// Test-only synthetic provider. Used solely by the isolated validation bundle.
const user = { uid: 'validation-user', email: 'validation@example.invalid', emailVerified: true, displayName: 'Validation Operator',
  async getIdToken() { return `validation-token:${Number(sessionStorage.getItem('validationAuthDelay') || 0)}`; } };
export const auth = { currentUser: user, authStateReady: async () => {} };
export const googleProvider = {};
export const db = {};
export const loginWithGoogle = async () => ({ user });
export const logoutUser = async () => {};
export const testFirebaseConnection = async () => {};
export const onAuthStateChanged = (_auth: unknown, callback: (user: any) => void) => { queueMicrotask(() => callback(user)); return () => {}; };
export const reload = async () => {};
export const sendEmailVerification = async () => {};
export const signInWithEmailAndPassword = async () => ({ user });
export const createUserWithEmailAndPassword = async () => ({ user });
export const updateProfile = async () => {};
