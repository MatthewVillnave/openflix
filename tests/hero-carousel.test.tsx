// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatalogWork } from '../packages/shared/dist/index.js';
import { FeaturedHero } from '../apps/web/src/Home.js';
const items = ['One', 'Two', 'Three'].map((title, i) => ({
  id: `work_${i}`,
  representativeItemId: `item_${i}`,
  title,
  type: 'movie',
  year: 2020 + i,
  overview: `Description ${title}`,
  sourceCount: 1,
  connectionCount: 1,
  memberCount: 1,
})) as CatalogWork[];
let media: MediaQueryList;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? '';
      }
    },
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  media = Object.assign(new EventTarget(), {
    matches: false,
    media: '(prefers-reduced-motion: reduce)',
  }) as MediaQueryList;
  vi.stubGlobal('matchMedia', () => media);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const advance = (ms = 10000) => act(() => vi.advanceTimersByTime(ms));
const heading = () => screen.getByRole('heading').textContent;
function loadImage(container: HTMLElement) {
  const image = container.querySelector('img');
  if (image) fireEvent.load(image);
}
it('changes artwork, metadata and action identity together every ten seconds', () => {
  const navigate = vi.fn();
  const view = render(<FeaturedHero items={items} active onNavigate={navigate} />);
  loadImage(view.container);
  // Initial programmatic heading focus must not disable the slideshow.
  fireEvent.focus(screen.getByRole('heading'));
  advance(9999);
  expect(heading()).toBe('One');
  advance(1);
  expect(heading()).toBe('Two');
  expect(screen.getByText('Description Two')).toBeTruthy();
  expect(view.container.querySelector('img')?.getAttribute('src')).toContain('/item_1/artwork/');
  fireEvent.click(screen.getByRole('button', { name: 'Explore title' }));
  expect(navigate).toHaveBeenLastCalledWith({ kind: 'detail', id: 'work_1', work: true });
  loadImage(view.container);
  advance();
  expect(heading()).toBe('Three');
  loadImage(view.container);
  advance();
  expect(heading()).toBe('One');
});
it('manual arrows and indicators reset the interval and keep cycling', () => {
  render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  advance(9000);
  fireEvent.click(screen.getByRole('button', { name: 'Show featured title 2 of 3' }));
  advance(9999);
  expect(heading()).toBe('Two');
  advance(1);
  expect(heading()).toBe('Three');
  fireEvent.click(screen.getByRole('button', { name: 'Next featured title' }));
  expect(heading()).toBe('One');
  advance(9000);
  fireEvent.click(screen.getByRole('button', { name: 'Show featured title 1 of 3' }));
  advance(9999);
  expect(heading()).toBe('One');
  advance(1);
  expect(heading()).toBe('Two');
  expect(screen.queryByRole('button', { name: /Pause|Resume/ })).toBeNull();
});
it('pointer presence and keyboard focus do not pause or move focus', () => {
  render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  fireEvent.pointerEnter(screen.getByRole('region'), { pointerType: 'mouse' });
  advance();
  expect(heading()).toBe('Two');
  const action = screen.getByRole('button', { name: 'Explore title' });
  act(() => action.focus());
  fireEvent.keyDown(action, { key: 'Tab' });
  advance();
  expect(heading()).toBe('Three');
  expect(document.activeElement).toBe(action);
});
it('stops while document or Home is hidden and restarts with a fresh interval', () => {
  const view = render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  advance(9999);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  advance(30000);
  expect(heading()).toBe('One');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
  advance(9999);
  expect(heading()).toBe('One');
  advance(1);
  expect(heading()).toBe('Two');
  view.rerender(<FeaturedHero items={items} active={false} onNavigate={vi.fn()} />);
  advance(30000);
  expect(heading()).toBe('Two');
  view.rerender(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  advance(9999);
  expect(heading()).toBe('Two');
  advance(1);
  expect(heading()).toBe('Three');
});
it('cycles by default with reduced motion, using non-animated slide replacement', () => {
  Object.assign(media, { matches: true });
  render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  advance();
  expect(heading()).toBe('Two');
  expect(screen.getByRole('region').getAttribute('data-rotation-state')).toBe('playing');
});
it('handles empty/single data and removes stale timers across rapid navigation and account remount', () => {
  const view = render(<FeaturedHero key="one" items={items} active onNavigate={vi.fn()} />);
  advance(9999);
  view.rerender(<FeaturedHero key="one" items={items} active={false} onNavigate={vi.fn()} />);
  view.rerender(<FeaturedHero key="two" items={[items[2]!]} active onNavigate={vi.fn()} />);
  advance(30000);
  expect(heading()).toBe('Three');
  expect(screen.queryByRole('button', { name: 'Next featured title' })).toBeNull();
  view.rerender(<FeaturedHero key="two" items={[]} active onNavigate={vi.fn()} />);
  expect(heading()).toBe('Make room for what you love.');
  expect(screen.queryByRole('button', { name: 'Explore title' })).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it('pauses outside the viewport and disconnects its observer on unmount', () => {
  let notify!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const view = render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  act(() =>
    notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver),
  );
  advance(30000);
  expect(heading()).toBe('One');
  act(() =>
    notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
  );
  advance();
  expect(heading()).toBe('Two');
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('replaces removed/changed catalog identities without retaining old artwork or actions', () => {
  const navigate = vi.fn();
  const view = render(<FeaturedHero items={items} active onNavigate={navigate} />);
  loadImage(view.container);
  advance();
  expect(heading()).toBe('Two');
  const replacement = {
    ...items[2]!,
    representativeItemId: 'replacement',
    overview: 'Updated description',
  };
  view.rerender(<FeaturedHero items={[replacement]} active onNavigate={navigate} />);
  expect(heading()).toBe('Three');
  expect(screen.queryByText('Description Two')).toBeNull();
  expect(view.container.querySelector('img')?.getAttribute('src')).toContain(
    '/replacement/artwork/',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Explore title' }));
  expect(navigate).toHaveBeenLastCalledWith({ kind: 'detail', id: 'work_2', work: true });
});

it('mouse-selected controls retain focus without stopping automatic rotation', () => {
  render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  const dot = screen.getByRole('button', { name: 'Show featured title 2 of 3' });
  act(() => dot.focus());
  fireEvent.click(dot);
  advance(12000);
  expect(heading()).toBe('Three');
  expect(document.activeElement).toBe(dot);
});
it('touch selection cycles without requiring Resume', () => {
  render(<FeaturedHero items={items} active onNavigate={vi.fn()} />);
  fireEvent.pointerEnter(screen.getByRole('region'), { pointerType: 'touch' });
  fireEvent.click(screen.getByRole('button', { name: 'Next featured title' }));
  advance();
  expect(heading()).toBe('Three');
});
