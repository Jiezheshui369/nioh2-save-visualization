import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MobileAssetImage } from './MobileAssetImage';

afterEach(cleanup);
describe('mobile asset failures', () => {
  it('replaces failed category art with known category text and tries a changed source', () => {
    const { container, rerender } = render(<MobileAssetImage src="/private/a.webp" fallback={<span>手甲</span>} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('手甲');
    rerender(<MobileAssetImage src="/private/b.webp" fallback={<span>防具</span>} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/private/b.webp');
    expect(container).not.toHaveTextContent('手甲');
  });
  it('removes failed decoration without adding a made-up image or category', () => {
    const { container } = render(<MobileAssetImage src="/private/decoration.svg" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container).toBeEmptyDOMElement();
  });
  it('does not request an absent or unknown mapping', () => {
    const { container } = render(<MobileAssetImage />);
    expect(container).toBeEmptyDOMElement();
  });
});
