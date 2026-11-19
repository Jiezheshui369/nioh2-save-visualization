import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameBitmapText, planBitmapText } from './GameBitmapText';
import type { PrivateBitmapFont } from './GameBitmapText';

// Synthetic metrics only; no private font or atlas is part of the test source.
const font: PrivateBitmapFont = {
  source: 'synthetic-test', runtimeBindingProven: false, nominalBitmapHeight: 40,
  ascent: 50, descent: 3, atlasUrl: '/synthetic.png', glyphs: {
    65: { x: 0, y: 0, width: 15, height: 40, xoffset: -2, baseline: 47, xadvance: 13 },
    66: { x: 16, y: 0, width: 17, height: 40, xoffset: 1, baseline: 44, xadvance: 18 },
    32: { x: 34, y: 0, width: 6, height: 40, xoffset: 0, baseline: 40, xadvance: 6 },
  },
};
describe('private bitmap text metrics and default boundary', () => {
  it('uses the recorded advances and baseline, including negative bearings', () => {
    const plan = planBitmapText('AB', font);
    expect(plan.left).toBe(-2);
    expect(plan.width).toBe(33);
    expect(plan.height).toBe(53);
    expect(plan.placements.map(x => [x.x, x.y])).toEqual([[-2, 3], [14, 6]]);
  });
  it('reports supplementary Unicode once and never aliases missing codepoints to glyph zero', () => {
    const plan = planBitmapText('A🧪🧪𠮷 ', font);
    expect(plan.missing).toEqual([0x1f9ea, 0x20bb7]);
    expect(plan.placements).toHaveLength(2);
  });
  it('does not add canvases or private-font requests without the explicit preview provider', () => {
    const { container } = render(<h2><GameBitmapText>能力强化值 123</GameBitmapText></h2>);
    expect(screen.getByRole('heading', { name: '能力强化值 123' })).toBeVisible();
    expect(container.querySelector('canvas')).toBeNull();
  });
});
