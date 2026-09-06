/**
 * Companion Memory, rendered as a peer of files in the Import & export panel.
 *
 * The two sections here are the only surface `src/memory/import.ts` and
 * `src/memory/export.ts` have. Both of those modules go to real trouble to
 * degrade *visibly* — an older server without `places()`, a truncated archive,
 * a lossy write-back — and every one of those signals arrives as a string on a
 * result object. A panel that renders only the happy path throws all of it away
 * and turns a partial import into a mystery, so everything below is about
 * getting `warnings`, `stats.truncated` and `lossy` onto the screen.
 */
import type { Story } from '@companion-atlas/story';
import {
  exportProgressLabel,
  exportSummary,
  importProgressLabel,
  importProgressPercent,
  importSummary,
  isUnfiltered,
  truncationNote,
} from './memoryTransfer.js';
import type { MemoryTransferState } from './useMemoryTransfer.js';

/** A bounding-box edge. Kept as `text` rather than `number`: a `number` input
 *  hands back `''` for "-12." mid-typing, so the minus sign vanishes under the
 *  user's cursor. Validation happens in `parseMemoryFilter` instead. */
function Edge({
  id, label, value, placeholder, onChange, disabled,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="io-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className="io-input"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function WarningList({ warnings }: { warnings: readonly string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="io-warnings">
      {warnings.map((w) => <li key={w}>{w}</li>)}
    </ul>
  );
}

export function MemoryImportSection({ transfer }: { transfer: MemoryTransferState }) {
  const {
    connected, filter, setFilter, clearFilter,
    importing, progress, lastImport, problems, runImport, cancelImport,
  } = transfer;

  const pct = progress ? importProgressPercent(progress) : null;
  const truncated = lastImport ? truncationNote(lastImport) : null;

  return (
    <section className="io-section">
      <h3>Import from Memory</h3>
      {!connected ? (
        <p className="io-hint">
          Not connected to a Companion Memory. Open Atlas with <code>?memory=</code> pointed
          at a CI-Server (or set <code>VITE_MEMORY_URL</code>) to import your own archive.
        </p>
      ) : (
        <>
          <p className="io-hint">
            Brings in places, located memories and any story you previously saved back.
            Narrow it first — a whole archive is rarely what you want, and the import is
            bounded, so an unfiltered one is likely to come back partial.
          </p>

          <div className="io-fields">
            <label className="io-field" htmlFor="io-mem-start">
              <span>From</span>
              <input
                id="io-mem-start"
                type="date"
                className="io-input"
                value={filter.start}
                disabled={importing}
                onChange={(e) => setFilter({ start: e.target.value })}
              />
            </label>
            <label className="io-field" htmlFor="io-mem-end">
              <span>To</span>
              <input
                id="io-mem-end"
                type="date"
                className="io-input"
                value={filter.end}
                disabled={importing}
                onChange={(e) => setFilter({ end: e.target.value })}
              />
            </label>
          </div>

          <fieldset className="io-box" disabled={importing}>
            <legend>Area (degrees)</legend>
            <div className="io-fields">
              <Edge id="io-mem-w" label="West" placeholder="-123.2" value={filter.west}
                onChange={(v) => setFilter({ west: v })} disabled={importing} />
              <Edge id="io-mem-s" label="South" placeholder="37.6" value={filter.south}
                onChange={(v) => setFilter({ south: v })} disabled={importing} />
              <Edge id="io-mem-e" label="East" placeholder="-122.3" value={filter.east}
                onChange={(v) => setFilter({ east: v })} disabled={importing} />
              <Edge id="io-mem-n" label="North" placeholder="37.9" value={filter.north}
                onChange={(v) => setFilter({ north: v })} disabled={importing} />
            </div>
          </fieldset>

          {problems.length > 0 && (
            <ul className="io-problems" role="alert">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}

          {!importing && isUnfiltered(filter) && (
            <p className="io-note">No filter set — this will try to import everything.</p>
          )}

          <div className="io-actions">
            <button className="atlas-btn primary" disabled={importing} onClick={runImport}>
              {importing ? 'Importing…' : 'Import from Memory'}
            </button>
            {importing && <button className="atlas-btn" onClick={cancelImport}>Cancel</button>}
            {!importing && !isUnfiltered(filter) && (
              <button className="io-link" onClick={clearFilter}>Clear filter</button>
            )}
          </div>

          {/* A silent multi-minute import is indistinguishable from a hung one,
              so the phase and its running count stay on screen throughout —
              `aria-live` because the numbers are the whole message. */}
          {importing && progress && (
            <div className="io-progress" role="status" aria-live="polite">
              <span className="io-progress-label">{importProgressLabel(progress)}</span>
              <div className={pct == null ? 'io-bar indeterminate' : 'io-bar'}>
                <i style={pct == null ? undefined : { width: `${pct}%` }} />
              </div>
            </div>
          )}

          {!importing && lastImport && (
            <div className={lastImport.connected ? 'io-result' : 'io-result bad'}>
              <p className="io-summary">{importSummary(lastImport)}</p>
              {truncated && <p className="io-note warn">{truncated}</p>}
              <WarningList warnings={lastImport.warnings} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MemoryExportSection({
  transfer, story,
}: {
  transfer: MemoryTransferState;
  story: Story | null;
}) {
  const { connected, exporting, exportProgress, lastExport, runExport } = transfer;
  if (!connected) return null;

  return (
    <section className="io-section">
      <h3>Export to Memory</h3>
      <p className="io-hint">
        Writes this story back as memory — the story document, its authored pins, and the
        places it knows. The write is idempotent, so exporting the same story twice
        updates it rather than duplicating it.
      </p>
      <div className="io-actions">
        <button
          className="atlas-btn"
          disabled={!story || exporting}
          onClick={() => story && runExport(story)}
        >
          {exporting ? 'Saving…' : 'Export to Memory'}
        </button>
      </div>

      {exporting && exportProgress && (
        <p className="io-note" role="status" aria-live="polite">{exportProgressLabel(exportProgress)}</p>
      )}

      {!exporting && lastExport && (
        <div className={lastExport.ok ? 'io-result' : 'io-result bad'}>
          <p className="io-summary">{exportSummary(lastExport)}</p>
          {/* `lossy` is written to be read by a person, and it is the answer to
              "why is my photo gone next week" (presigned URLs expire). Next to
              the success state, not behind a disclosure — a save that claims to
              be clean and isn't is the thing this text exists to prevent. */}
          {lastExport.ok && lastExport.lossy.length > 0 && (
            <>
              <p className="io-note">What this save could not carry:</p>
              <ul className="io-warnings">
                {lastExport.lossy.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </>
          )}
          <WarningList warnings={lastExport.warnings} />
          {lastExport.failed.length > 0 && (
            <ul className="io-problems">
              {lastExport.failed.map((f) => <li key={f.id}>{f.id}: {f.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
