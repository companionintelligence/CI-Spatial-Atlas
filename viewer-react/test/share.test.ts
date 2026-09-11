import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyShareUrl } from '../src/ui/share.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyShareUrl', () => {
  it('reports success when the browser accepts the clipboard write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyShareUrl('https://atlas.example/view')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://atlas.example/view');
  });

  it('reports failure when clipboard access is unavailable or rejected', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    vi.stubGlobal('document', undefined);
    await expect(copyShareUrl('https://atlas.example/view')).resolves.toBe(false);

    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyShareUrl('https://atlas.example/view')).resolves.toBe(false);
  });

  it('falls back to the legacy copy command for insecure previews', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    const input = { value: '', setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn(), style: {} };
    const body = { appendChild: vi.fn() };
    vi.stubGlobal('navigator', { clipboard: undefined });
    vi.stubGlobal('document', {
      body,
      execCommand,
      createElement: vi.fn().mockReturnValue(input),
    });

    await expect(copyShareUrl('https://atlas.example/view')).resolves.toBe(true);
    expect(input.value).toBe('https://atlas.example/view');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(input.remove).toHaveBeenCalled();
  });
});
