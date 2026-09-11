import { useState, type FormEvent } from 'react';

import { isMemoryAuthError, signInToMemory } from '../memory/auth.js';

function retry(): void {
  window.location.reload();
}

/**
 * A recovery-first load failure. A blank globe cannot tell a user whether the
 * server is empty, offline, or unauthorised; this keeps those outcomes distinct
 * and gives live-memory users a path back into the product.
 */
export function StoryLoadError({ error, memoryUrl }: { error: string | null; memoryUrl?: string }) {
  const authError = Boolean(memoryUrl) && isMemoryAuthError(error);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!memoryUrl || !email || !password) return;

    setBusy(true);
    setSignInError(null);

    try {
      await signInToMemory({ memoryUrl, email, password });
      window.location.reload();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atlas-boot">
      <div className="msg" role={authError ? 'alert' : undefined}>
        <strong>{authError ? 'Sign in to load your memories' : 'Couldn’t load a story.'}</strong>
        <span>
          {authError
            ? 'Your Companion Memory session is missing or expired. Sign in here to reconnect this tab.'
            : error ?? 'Append ?story=&lt;url&gt; to view one.'}
        </span>
        <div className="atlas-auth-actions">
          {authError && !open && (
            <button className="atlas-btn primary" type="button" onClick={() => setOpen(true)}>
              Sign in to Companion Memory
            </button>
          )}
          <button className="atlas-btn" type="button" onClick={retry} disabled={busy}>
            Try again
          </button>
        </div>
        {authError && open && (
          <form className="atlas-auth-form" onSubmit={submit}>
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
            {signInError && <span className="atlas-auth-error" role="alert">{signInError}</span>}
            <div className="atlas-auth-actions">
              <button className="atlas-btn primary" type="submit" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button className="atlas-btn ghost" type="button" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </button>
            </div>
            <span className="atlas-auth-note">Your access token stays in this browser tab and is never added to the URL.</span>
          </form>
        )}
      </div>
    </div>
  );
}
