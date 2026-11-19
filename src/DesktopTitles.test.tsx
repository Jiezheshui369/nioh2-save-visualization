import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import demo from '../public/data/demo-snapshot.json';
import type { SaveSnapshot } from './types';
import { DesktopTitles } from './DesktopTitles';
import { titleFixture } from './test/titleFixture';
afterEach(cleanup);
const original = demo as unknown as SaveSnapshot;
const snapshot = (ids: number[] = []) => ({...original,titles:titleFixture(ids)}) as SaveSnapshot;
describe('Figma 05 titles with actual snapshot state', () => {
  it('starts at the native Ungyo overview and exposes the designed entrance', () => {
    render(<DesktopTitles snapshot={snapshot([4707])} />);
    expect(screen.getByRole('button',{name:'称号一览'})).toBeInTheDocument();
    expect(screen.getByLabelText('当前分组汇总')).toHaveTextContent('0 / 178');
    expect(screen.getByLabelText('称号汇总')).toHaveTextContent('1 / 390');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'游玩记录（尚未接入）'})).toBeDisabled();
  });
  it('switches category, opens exact saved IDs and shows selected condition', () => {
    render(<DesktopTitles snapshot={snapshot([4707])} />);
    fireEvent.click(screen.getByRole('button',{name:/切换称号类别/}));
    expect(screen.getByLabelText('当前分组汇总')).toHaveTextContent('1 / 212');
    fireEvent.click(screen.getByRole('button',{name:'称号一览'}));
    const list=screen.getByRole('list',{name:'称号列表'});
    expect(within(list).getAllByRole('listitem')).toHaveLength(212);
    fireEvent.click(within(list).getByRole('button',{name:/伟大的勇猛武者/}));
    expect(screen.getByRole('region',{name:'选中称号详情'})).toHaveTextContent('使用猛妖怪化达一定次数以上。');
    expect(screen.getByRole('region',{name:'选中称号详情'})).toHaveTextContent('实时进度、可见性及可领取状态：未知');
    expect(screen.queryByText('100/100 · 已完成')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'返回恩惠总览'}));
    expect(screen.getByRole('button',{name:'称号一览'})).toBeInTheDocument();
  });
  it('keeps legacy snapshots visibly unknown', () => {
    render(<DesktopTitles snapshot={original} />);
    expect(screen.getByRole('heading',{name:'此快照尚未解析称号'})).toBeInTheDocument();
    expect(screen.getByLabelText('当前分组汇总')).toHaveTextContent('待读取');
    expect(screen.getByLabelText('当前分组汇总')).not.toHaveTextContent('0 / 178');
  });
  it('updates an unchanged snapshot ID from its current content', () => {
    const app=render(<DesktopTitles snapshot={snapshot([4707])} />);
    fireEvent.click(screen.getByRole('button',{name:/切换称号类别/}));
    fireEvent.click(screen.getByRole('button',{name:'称号一览'}));
    fireEvent.click(within(screen.getByRole('list',{name:'称号列表'})).getAllByRole('button')[0]);
    expect(screen.getByRole('region',{name:'选中称号详情'})).toHaveTextContent('已获得');
    app.rerender(<DesktopTitles snapshot={snapshot([])} />);
    expect(screen.getByRole('region',{name:'选中称号详情'})).toHaveTextContent('尚未获得');
    expect(screen.getByLabelText('称号汇总')).toHaveTextContent('0 / 390');
  });
  it('uses the existing menu callback and keyboard category control', () => {
    const onMenu=vi.fn();render(<DesktopTitles snapshot={snapshot()} onMenu={onMenu} />);
    fireEvent.keyDown(screen.getByRole('button',{name:/切换称号类别/}),{key:'ArrowLeft'});
    expect(screen.getByLabelText('当前分组汇总')).toHaveTextContent('0 / 212');
    fireEvent.click(screen.getByRole('button',{name:'呼出菜单'}));expect(onMenu).toHaveBeenCalledOnce();
  });
  it('does not present the Ungyo perk labels as verified Agyo perks', () => {
    render(<DesktopTitles snapshot={snapshot()} />);
    fireEvent.click(screen.getByRole('button',{name:/切换称号类别/}));
    expect(screen.getByText('恩惠内容未解析')).toBeInTheDocument();
    expect(screen.queryByLabelText('获得金钱')).not.toBeInTheDocument();
  });
  it('renders a failed saved-set parse as unknown rather than waiting or zero', () => {
    const value=snapshot();
    value.titles={...value.titles!,state:'unknown',reason:'unsupported-layout-or-set',
      entries:value.titles!.entries.map(e=>({...e,savedAwarded:null})),
      summary:{total:390,awarded:null,notAwarded:null,unknown:390,groups:[0,1].map(category=>({category:category as 0|1,total:category===0?212:178,awarded:null,notAwarded:null,unknown:category===0?212:178}))}};
    render(<DesktopTitles snapshot={value} />);
    expect(screen.getByLabelText('当前分组汇总')).toHaveTextContent('未知');
    expect(screen.getByLabelText('当前分组汇总')).not.toHaveTextContent('待读取');
  });
});
