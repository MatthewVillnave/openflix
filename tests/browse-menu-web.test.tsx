// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from '@testing-library/user-event';
import { BrowseMenu } from '../apps/web/src/BrowseMenu.js';
afterEach(cleanup);
it('opens by touch/click, selects TV Shows and dismisses outside', async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  render(<BrowseMenu onSelect={select} />);
  await user.click(screen.getByRole('button', { name: /Browse/ }));
  await user.click(screen.getByRole('button', { name: 'TV Shows' }));
  expect(select).toHaveBeenCalledWith('series');
  expect(screen.queryByRole('button', { name: 'Movies' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /Browse/ }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('button', { name: 'Movies' })).toBeNull();
});
it('supports keyboard open, arrows, selection, Escape and normal Tab navigation', async () => {
  const select = vi.fn();
  const user = userEvent.setup();
  render(
    <>
      <BrowseMenu onSelect={select} />
      <button>After</button>
    </>,
  );
  const browse = screen.getByRole('button', { name: /Browse/ });
  browse.focus();
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Movies' }));
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'TV Shows' }));
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(browse);
  await user.keyboard('{ArrowUp}{Enter}');
  expect(select).toHaveBeenCalledWith('series');
  browse.focus();
  await user.keyboard('{Enter}{Tab}{Tab}{Tab}');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After' }));
  expect(browse.getAttribute('aria-expanded')).toBe('false');
});
