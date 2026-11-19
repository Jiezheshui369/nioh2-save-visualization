import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../public/data/demo-snapshot.json';
import type { SaveSnapshot } from './types';
import { DesktopHome } from './DesktopHome';
import { DesktopCharacterInformation } from './DesktopCharacterInformation';
import { DesktopGuardians } from './DesktopGuardians';
import { desktopIntegerDisplay } from './desktopPresentation';
import { wrapDesktopText } from './DesktopTypography';
const snapshot = () => structuredClone(fixture) as unknown as SaveSnapshot;
afterEach(cleanup);
function home(value:SaveSnapshot) { return render(<DesktopHome snapshot={value} onEquipment={vi.fn()} onNavigate={vi.fn()} onGames={vi.fn()} onSwitch={vi.fn()} onLogout={vi.fn()} busy={false}/>); }
describe('desktop user readability and resource placement', () => {
  it('moves real counters to home, preserves zero and never reuses prior values', () => {
    const value=snapshot(); value.character.amrita=123456789;value.character.gold=0;
    const before=JSON.stringify(value);const app=home(value);
    expect(app.container.querySelector('[data-resource-field="amrita"] dd')).toHaveTextContent('123,456,789');
    expect(app.container.querySelector('[data-resource-field="gold"] dd')).toHaveTextContent('0');
    expect(JSON.stringify(value)).toBe(before);
    const unknown=snapshot();delete (unknown.character as Partial<typeof unknown.character>).amrita;
    app.rerender(<DesktopHome snapshot={unknown} onEquipment={vi.fn()} onNavigate={vi.fn()} onGames={vi.fn()} onSwitch={vi.fn()} onLogout={vi.fn()} busy={false}/>);
    expect(app.container.querySelector('[data-resource-field="amrita"] dd')).toHaveTextContent('—');
    expect(app.container.querySelector('[data-resource-field="amrita"]')).toHaveAttribute('data-value-source','unparsed');
  });
  it('leaves every panel and effect in details after moving only two resource rows', () => {
    const value=snapshot(), before=JSON.stringify(value);const app=render(<DesktopCharacterInformation snapshot={value}/>);
    expect(app.container.querySelectorAll('[data-detail-row]')).toHaveLength(162);
    expect(app.container.querySelectorAll('[data-value-source="snapshot-basic"]')).toHaveLength(9);
    expect(app.container.querySelectorAll('[data-detail-kind="panel"] [data-detail-row]')).toHaveLength(37);
    expect(app.container.querySelectorAll('[data-detail-kind="effect"] [data-detail-row]')).toHaveLength(116);
    expect(screen.queryByLabelText('持有金钱')).toBeNull();expect(JSON.stringify(value)).toBe(before);
  });
  it.each([undefined,null,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'123'])('keeps invalid or absent counters unknown: %s', value => expect(desktopIntegerDisplay(value)).toBe('—'));
  it('keeps exact safe integer counters, including zero and the largest safe value', () => {
    expect(desktopIntegerDisplay(0)).toBe('0');expect(desktopIntegerDisplay(Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740,991');
  });
  it('wraps a long native label without losing or duplicating Unicode characters', () => {
    const text='阴阳武者战甲 膝甲';const lines=wrapDesktopText(text,100);
    expect(lines.length).toBeGreaterThan(1);expect(lines.join('')).toBe(text);
    expect(wrapDesktopText(text,0)).toEqual([text]);
  });
  it('keeps focused guardian regions keyboard scrollable and does not steal child button keys', () => {
    render(<DesktopGuardians snapshot={snapshot()}/>);const region=screen.getByRole('region',{name:'守护灵目录'});
    Object.defineProperty(region,'scrollHeight',{value:2000});Object.defineProperty(region,'clientHeight',{value:400});
    fireEvent.keyDown(region,{key:'PageDown'});expect(region.scrollTop).toBe(340);
    fireEvent.keyDown(region,{key:'End'});expect(region.scrollTop).toBe(2000);
    fireEvent.keyDown(region,{key:'Home'});expect(region.scrollTop).toBe(0);
    fireEvent.keyDown(within(region).getAllByRole('button')[0],{key:'ArrowDown'});expect(region.scrollTop).toBe(0);
    expect(screen.getByLabelText('守护灵信息')).toHaveAttribute('tabindex','0');
  });
});
