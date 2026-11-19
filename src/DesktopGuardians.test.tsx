import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../public/data/demo-snapshot.json';
import type { SaveSnapshot } from './types';
import { DesktopGuardians } from './DesktopGuardians';
import assets from './desktopAssetManifest.json';
vi.mock('./desktopPresentation', async original => ({
  ...await original<typeof import('./desktopPresentation')>(),
  firstPersistedGuardianKey: () => assets.guardians[0].key,
  persistedGuardian: () => ({ fixedEntries: [], coreInstances: [{ entries: [
    { label:'first verified slot',ordinarySourceDisplay:'+1.0%' },
    { label:'?????',ordinarySourceDisplay:'+999%' },
    { label:'third verified slot',ordinarySourceDisplay:'AA' },
    { label:'fourth verified slot',ordinarySourceDisplay:'+2.1' },
    { label:'fifth verified slot',ordinarySourceDisplay:'+5.8%' },
    { label:'RAW_SLOT_SIX_NEVER_PROMOTE',ordinarySourceDisplay:'+999%' },
    { label:'RAW_SLOT_SEVEN_NEVER_PROMOTE',ordinarySourceDisplay:'+999%' },
  ] }] }),
}));
afterEach(cleanup);
describe('per-instance soul core UI boundary', () => {
  it('keeps the first five positions, hides secret slots and never promotes trailing raw fields', () => {
    const app = render(<DesktopGuardians snapshot={fixture as unknown as SaveSnapshot} />);
    const trigger = screen.getByRole('button', { name: '魂核记录1' });
    fireEvent.click(trigger);
    const rows = [...app.container.querySelectorAll('.df-core-effects .df-value-row')];
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('+1.0%');
    expect(rows[1].textContent).toBe('——');
    expect(rows[2]).toHaveTextContent('AA');
    expect(rows[3]).toHaveTextContent('+2.1');
    expect(rows[4]).toHaveTextContent('+5.8%');
    expect(app.container.textContent).not.toContain('RAW_SLOT_');
    expect(app.container.textContent).not.toContain('?????');
    expect(app.container.textContent).not.toContain('999%');
    expect([...app.container.querySelectorAll('.df-core-stats dd')].map(e=>e.textContent)).toEqual(['—','—','—']);
    fireEvent.click(screen.getByRole('button', { name: '关闭魂核' }));
    expect(trigger).toHaveFocus();
  });
});
