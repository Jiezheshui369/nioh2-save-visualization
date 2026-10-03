import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopImport } from './DesktopImport';
import fixture from '../public/data/demo-snapshot.json';

const file = new File([new Uint8Array(1_000_000)], 'SAVEDATA.BIN', { lastModified: 1234567890000 });
const response = (value: unknown, status = 200) => ({ ok: status < 400, status, json: vi.fn().mockResolvedValue(value) });
function select(value = file) { fireEvent.change(screen.getByLabelText('选择 SAVEDATA.BIN'), { target: { files: [value] } }); }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(fixture))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('desktop save import', () => {
  it.each([
    new File(['{}'], 'archive.json'),
    new File(['small'], 'SAVEDATA.BIN'),
    new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'SAVEDATA.BIN'),
  ])('rejects unsupported files before starting any work ($name)', async bad => {
    const begin = vi.fn();
    render(<DesktopImport onSnapshot={vi.fn()} onBegin={begin} />);
    select(bad);
    expect(screen.getByRole('alert')).toHaveTextContent('SAVEDATA.BIN');
    expect(fetch).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled();
  });

  it('holds the lock through persistence, rejects duplicate drops, then permits the same file again', async () => {
    let finish!: () => void;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(done => { finish = done; })).mockResolvedValue(undefined);
    const end = vi.fn();
    render(<DesktopImport onSnapshot={save} onBegin={() => true} onEnd={end} />);
    select();
    await act(async () => {});
    expect(fetch).toHaveBeenCalledWith('/api/import-save', expect.objectContaining({ method: 'POST', body: file,
      headers: expect.objectContaining({ 'X-Nioh2-Modified': String(file.lastModified) }) }));
    fireEvent.drop(screen.getByLabelText('电脑导入游戏存档'), { dataTransfer: { files: [file] } });
    expect(fetch).toHaveBeenCalledTimes(1); expect(end).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toBeDisabled();
    await act(async () => finish());
    expect(screen.getByRole('button')).toBeEnabled(); expect(end).toHaveBeenCalledTimes(1);
    select(); await act(async () => {});
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('respects the parent lock and disabled drag target', async () => {
    const begin = vi.fn().mockReturnValue(false);
    const panel = render(<DesktopImport onSnapshot={vi.fn()} onBegin={begin} />);
    select(); expect(fetch).not.toHaveBeenCalled(); expect(begin).toHaveBeenCalledTimes(1);
    panel.rerender(<DesktopImport onSnapshot={vi.fn()} disabled onBegin={begin} />);
    fireEvent.drop(screen.getByLabelText('电脑导入游戏存档'), { dataTransfer: { files: [file] } });
    expect(fetch).not.toHaveBeenCalled(); expect(begin).toHaveBeenCalledTimes(1);
  });

  it('explains a non-JSON server response and allows retry', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ...response(null, 502), json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')) } as unknown as Response);
    const save = vi.fn().mockResolvedValue(undefined);
    render(<DesktopImport onSnapshot={save} />);
    select(); expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 502');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Unexpected token');
    expect(save).not.toHaveBeenCalled();
    select(); await act(async () => {});
    expect(save).toHaveBeenCalledTimes(1); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [response({ error: '已有读取任务。' }, 409), '已有读取任务'],
    [response({ error: { secret: 'not a message' } }, 400), '电脑解析失败'],
    [response({}), '解析结果不完整'],
  ])('does not apply invalid or failed results', async (result, message) => {
    vi.mocked(fetch).mockResolvedValue(result as unknown as Response);
    const save = vi.fn();
    render(<DesktopImport onSnapshot={save} />);
    select(); expect(await screen.findByRole('alert')).toHaveTextContent(message as string);
    expect(save).not.toHaveBeenCalled();
  });

  it('distinguishes a network outage from local persistence failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const save = vi.fn().mockRejectedValue(new Error('设备存储空间不足'));
    render(<DesktopImport onSnapshot={save} />);
    select(); expect(await screen.findByRole('alert')).toHaveTextContent('无法连接电脑服务');
    select(); await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent('电脑分析已完成');
    expect(screen.getByRole('alert')).toHaveTextContent('设备存储空间不足');
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('reports timeout without falsely claiming the server cancelled parsing', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_, options) => new Promise((_, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const end = vi.fn();
    render(<DesktopImport onSnapshot={vi.fn()} onEnd={end} />);
    select(); await act(async () => vi.advanceTimersByTimeAsync(240000));
    expect(screen.getByRole('alert')).toHaveTextContent('这不代表解析已取消');
    expect(screen.getByRole('button')).toBeEnabled(); expect(end).toHaveBeenCalledTimes(1);
  });

  it('ignores a late response after unmount even if transport ignores abort', async () => {
    let resolve!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(done => { resolve = done; }));
    const save = vi.fn(); const end = vi.fn();
    const panel = render(<DesktopImport onSnapshot={save} onEnd={end} />);
    select();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    panel.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => resolve(response(fixture) as unknown as Response));
    expect(save).not.toHaveBeenCalled(); expect(end).toHaveBeenCalledTimes(1);
  });
});
