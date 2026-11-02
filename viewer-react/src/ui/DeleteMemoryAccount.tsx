import { useState, type FormEvent } from 'react';

import { clearMemoryToken, deleteMemoryAccount, signInToMemory } from '../memory/auth.js';

type Step = 'credentials' | 'confirm' | 'deleted';

/**
 * Account deletion from the sign-in screen. Apple's Guideline 5.1.1(v) asks for
 * account deletion from inside the app, and the store checklist treats any
 * sign-in as needing it. The person signs in to the account first, which proves
 * who is asking, then types its email again before anything is deleted. The
 * password is not asked for twice: a CI-Portal account has a random password
 * that nobody knows.
 */
export function DeleteMemoryAccount({ memoryUrl, onClose }: { memoryUrl: string; onClose: () => void }) {
  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const emailConfirmed = email.trim() !== '' && confirmEmail.trim().toLowerCase() === email.trim().toLowerCase();

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !password) return;

    setBusy(true);
    setError(null);

    try {
      const token = await signInToMemory({ memoryUrl, email: email.trim(), password });
      setAccessToken(token);
      setPassword('');
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!emailConfirmed || !accessToken) return;

    setBusy(true);
    setError(null);

    try {
      await deleteMemoryAccount({ memoryUrl, accessToken, confirmEmail: confirmEmail.trim() });
      setConfirmEmail('');
      setStep('deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the account.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    // Signing in only to delete must not leave this tab signed in.
    if (step === 'confirm') clearMemoryToken();
    onClose();
  };

  if (step === 'deleted') {
    return (
      <section className="atlas-auth-form" role="status">
        <strong>Your account has been deleted.</strong>
        <span className="atlas-auth-note">It ends now. Its data is purged after the server’s grace period.</span>
        <div className="atlas-auth-actions">
          <button className="atlas-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    );
  }

  if (step === 'credentials') {
    return (
      <form className="atlas-auth-form" onSubmit={signIn}>
        <strong>Delete your Companion Memory account</strong>
        <span className="atlas-auth-note">
          Sign in to the account you want to delete. You will type its email again to confirm. Deleting ends the
          account now, and its data is purged after the server’s grace period.
        </span>
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <span className="atlas-auth-error" role="alert">{error}</span>}
        <div className="atlas-auth-actions">
          <button className="atlas-btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Continue'}
          </button>
          <button className="atlas-btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <form className="atlas-auth-form" onSubmit={remove}>
      <strong>Confirm deletion</strong>
      <span className="atlas-auth-note">Type {email.trim()} to delete this account. This can’t be undone from the app.</span>
      <label>
        Email to confirm
        <input
          type="email"
          autoComplete="off"
          value={confirmEmail}
          onChange={(event) => setConfirmEmail(event.target.value)}
          required
        />
      </label>
      {error && <span className="atlas-auth-error" role="alert">{error}</span>}
      <div className="atlas-auth-actions">
        <button className="atlas-btn danger" type="submit" disabled={busy || !emailConfirmed}>
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
        <button className="atlas-btn ghost" type="button" onClick={cancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
