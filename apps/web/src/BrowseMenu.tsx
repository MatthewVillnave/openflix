import { useEffect, useRef, useState } from 'react';
export function BrowseMenu({ onSelect }: { onSelect: (type: 'movie' | 'series') => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const last = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const select = (type: 'movie' | 'series') => {
    setOpen(false);
    onSelect(type);
  };
  return (
    <div
      ref={root}
      className="browse-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          toggle.current?.focus();
        }
        if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          (event.key === 'Home'
            ? first
            : event.key === 'End'
              ? last
              : document.activeElement === first.current
                ? last
                : first
          ).current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        aria-expanded={open}
        aria-controls="browse-destinations"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
            const target = event.key === 'ArrowDown' ? first : last;
            queueMicrotask(() => target.current?.focus());
          }
        }}
      >
        Browse <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          id="browse-destinations"
          className="browse-destinations"
          aria-label="Browse categories"
        >
          <button ref={first} onClick={() => select('movie')}>
            Movies
          </button>
          <button ref={last} onClick={() => select('series')}>
            TV Shows
          </button>
        </div>
      )}
    </div>
  );
}
