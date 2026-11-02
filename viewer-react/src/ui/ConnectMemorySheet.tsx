import { useState, type FormEvent } from 'react';

import { memoryConnectHref } from './memoryConnectHref.js';

/**
 * Connect this viewer to a Companion Memory. The address is where the memories live. Signing
 * in to that account happens next, in this tab, when the server asks for it.
 */
export function ConnectMemorySheet({ onClose }: { onClose: () => void }) {
  const [address, setAddress] = useState(
    () => new URL(window.location.href).searchParams.get('memory') ?? '',
  );
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const next = memoryConnectHref(window.location.href, address);

    if (!next) {
      setError('Enter the address of your Companion Memory, starting with https://');
      return;
    }

    window.location.assign(next);
  };

  return (
    <div className="atlas-connect" role="dialog" aria-modal="true" aria-labelledby="atlas-connect-title">
      <form className="atlas-auth-form atlas-connect-card" onSubmit={submit}>
        <strong id="atlas-connect-title">Connect your memories</strong>
        <span className="atlas-connect-lede">
          Enter the address of your Companion Memory. Your memories load in this tab, and you sign
          in to that account here.
        </span>
        <label>
          Companion Memory address
          <input
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://memory.example.com"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setError(null);
            }}
            required
          />
        </label>
        {error && <span className="atlas-auth-error" role="alert">{error}</span>}
        <div className="atlas-auth-actions">
          <button className="atlas-btn primary" type="submit">
            Connect
          </button>
          <button className="atlas-btn ghost" type="button" onClick={onClose}>
            Not now
          </button>
        </div>
      </form>
    </div>
  );
}
