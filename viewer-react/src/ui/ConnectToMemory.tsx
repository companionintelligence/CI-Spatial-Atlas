import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { connectionUrlError, forgetMemoryConnection, signInToMemory } from '../memory/auth.js';

/**
 * Connect the native shell to a Companion Memory server. The address and the short-lived
 * access token go to the Keychain, so a relaunch opens the memories without asking for the
 * password again. The password is only sent to the server; it is never stored.
 */
export function ConnectToMemory({ connectedUrl, onClose }: { connectedUrl?: string; onClose: () => void }) {
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addressField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    addressField.current?.focus();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = connectionUrlError(address);
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await signInToMemory({ memoryUrl: address.trim(), email, password });
      // signInToMemory has saved the connection to the Keychain. Reloading starts the viewer on it.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await forgetMemoryConnection();
    window.location.reload();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !busy) onClose();
  };

  return (
    <div
      className="atlas-connect-scrim"
      onClick={() => { if (!busy) onClose(); }}
      onKeyDown={onKeyDown}
    >
      <form
        className="atlas-auth-form atlas-connect"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atlas-connect-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="atlas-connect-title">Connect to Companion Memory</h2>
        <span className="atlas-auth-note">
          {connectedUrl ? `Connected to ${connectedUrl}.` : 'Your memories load from your Companion Memory server.'}
        </span>
        <label>
          Server address
          <input
            ref={addressField}
            type="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://memory.example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            required
          />
        </label>
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
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          <button className="atlas-btn ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
        {connectedUrl && (
          <button className="atlas-btn ghost" type="button" onClick={disconnect} disabled={busy}>
            Disconnect
          </button>
        )}
        <span className="atlas-auth-note">
          Your password goes only to this server. Atlas keeps a short-lived access token in the Keychain, not your password.
        </span>
      </form>
    </div>
  );
}
