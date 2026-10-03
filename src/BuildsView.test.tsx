import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuildsView } from './App';
import { deleteSavedBuild, loadSavedBuilds, saveCurrentBuild } from './buildLibrary';
import type { SavedBuild } from './buildLibrary';
import type { SaveSnapshot } from './types';
import fixture from '../public/data/demo-snapshot.json';

vi.mock('./buildLibrary', async original => ({ ...await original<typeof import('./buildLibrary')>(),
  loadSavedBuilds: vi.fn(), saveCurrentBuild: vi.fn(), deleteSavedBuild: vi.fn() }));
const snapshot = fixture as unknown as SaveSnapshot;
const saved: SavedBuild = {
  schemaVersion: '1.0.0', id: 'saved-1', title: '我的离线配装', note: '',
  createdAt: '2026-09-25T00:00:00Z', updatedAt: '2026-09-25T00:00:00Z',
  sourceSnapshotId: snapshot.snapshotId, sourceLastWriteLocal: snapshot.sourceLastWriteLocal,
  level: snapshot.character.level, attributes: snapshot.character.attributes, equipment: snapshot.currentLoadout,
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadSavedBuilds).mockResolvedValue([saved]); });
afterEach(() => cleanup());

describe('build library failure UX', () => {
  it('does not mistake a failed read for an empty library and can retry', async () => {
    vi.mocked(loadSavedBuilds).mockRejectedValueOnce(new Error('存储暂时不可用'));
    render(<BuildsView snapshot={snapshot} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('存储暂时不可用');
    expect(screen.queryByText('配装册还是空的')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏当前配装' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '重试读取配装册' }));
    expect(await screen.findByRole('heading', { name: saved.title })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏当前配装' })).toBeEnabled();
  });

  it('locks concurrent clicks and keeps notes and old records after a failed save', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(saveCurrentBuild).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render(<BuildsView snapshot={snapshot} />);
    await screen.findByRole('heading', { name: saved.title });
    fireEvent.change(screen.getByLabelText('配装备注'), { target: { value: '不能丢失此备注' } });
    const button = screen.getByRole('button', { name: '收藏当前配装' });
    fireEvent.click(button); fireEvent.click(button);
    expect(saveCurrentBuild).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => reject(new Error('配装册最多保存 50 套')));
    expect(await screen.findByRole('alert')).toHaveTextContent('50 套');
    expect(screen.getByLabelText('配装备注')).toHaveValue('不能丢失此备注');
    expect(screen.getByRole('heading', { name: saved.title })).toBeVisible();
    expect(screen.queryByText('已收藏到配装册')).not.toBeInTheDocument();
  });

  it('retains the displayed build when confirmed deletion fails', async () => {
    vi.mocked(deleteSavedBuild).mockRejectedValue(new Error('配装仍保留，请重试'));
    render(<BuildsView snapshot={snapshot} />);
    await screen.findByRole('heading', { name: saved.title });
    fireEvent.click(screen.getByRole('button', { name: '移除这套配装' }));
    expect(deleteSavedBuild).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '再次点击确认删除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('配装仍保留');
    expect(screen.getByRole('heading', { name: saved.title })).toBeVisible();
    expect(deleteSavedBuild).toHaveBeenCalledWith(saved.id);
  });
});
