import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DesktopPendingModule, DesktopPreparation } from './DesktopModules';
import type { SaveSnapshot } from './types';
import demo from '../public/data/demo-snapshot.json';

afterEach(cleanup);
describe('desktop module data boundaries',()=>{
  it('keeps warehouse records pending without treating carried inventory as storage',()=>{
    render(<DesktopPendingModule page="warehouse"/>);
    expect(screen.getByLabelText('仓库分类')).toHaveTextContent('武器防具饰品魂核');
    expect(screen.getByLabelText('仓库记录')).toHaveTextContent('仓库记录待读取');
  });
  it('does not use current equipment as an unknown saved preset',()=>{
    render(<DesktopPreparation snapshot={demo as unknown as SaveSnapshot}/>);
    const panel=screen.getByLabelText('战斗准备装备');
    expect(within(panel).getByRole('heading',{name:'当前装备'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/战斗准备 1/}));
    expect(within(panel).getByRole('heading',{name:'战斗准备 1'})).toBeInTheDocument();
    expect(panel).toHaveTextContent('配置记录待读取');
    expect(panel.querySelector('.dm-prep-equipment')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'当前装备'}));
    expect(panel.querySelectorAll('.dm-prep-equipment > div')).toHaveLength(12);
  });
});
