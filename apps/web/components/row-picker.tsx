"use client";

import { useEffect, useRef, useState } from "react";

// Inline keyboard picker rendered in place of a list row — Linear-style
// `p`/`a`/`l`/`s` property menus. Owns keydown while mounted (capture
// phase, so the list's document listener never sees them).
export interface PickerOption {
  value: string;
  label: string;
  hint?: string;
  swatch?: string;
  checked?: boolean;
}

export function RowPicker({
  title,
  options,
  multi = false,
  initialChecked,
  onSelect,
  onApply,
  onClose,
}: {
  title: string;
  options: PickerOption[];
  multi?: boolean;
  initialChecked?: ReadonlySet<string>;
  onSelect?: (value: string) => void;
  onApply?: (values: string[]) => void;
  onClose: () => void;
}) {
  const [hi, setHi] = useState(0);
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    initialChecked ?? new Set(),
  );
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // let ⌘K etc. through
      e.preventDefault();
      e.stopPropagation();
      const opt = options[hi];
      switch (e.key) {
        case "j":
        case "ArrowDown":
          setHi((h) => Math.min(h + 1, options.length - 1));
          break;
        case "k":
        case "ArrowUp":
          setHi((h) => Math.max(h - 1, 0));
          break;
        case "x":
        case " ":
          if (multi && opt) {
            setChecked((s) => {
              const next = new Set(s);
              if (next.has(opt.value)) next.delete(opt.value);
              else next.add(opt.value);
              return next;
            });
          }
          break;
        case "Enter":
          if (multi) onApply?.([...checked]);
          else if (opt) onSelect?.(opt.value);
          break;
        case "Escape":
          onClose();
          break;
        default:
          // digits jump straight to options (priority menus especially)
          if (!multi && /^[0-9]$/.test(e.key)) {
            const n = Number(e.key);
            const target = options.findIndex((o) => o.hint === e.key);
            if (target >= 0) onSelect?.(options[target]!.value);
            else if (n >= 1 && n <= options.length)
              onSelect?.(options[n - 1]!.value);
          }
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hi, options, checked, multi, onSelect, onApply, onClose]);

  return (
    <li
      ref={ref}
      className="border-b border-lining-faint bg-surface-2 px-4 py-1.5"
      role="menu"
      aria-label={title}
    >
      <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
        {title}
        {multi && (
          <span className="ml-2 normal-case text-ink-muted">
            <kbd>x</kbd> toggle · <kbd>⏎</kbd> apply
          </span>
        )}
      </div>
      <ul>
        {options.map((o, i) => (
          <li
            key={o.value || "__empty"}
            role="menuitem"
            aria-selected={i === hi}
            className={`flex h-6 cursor-pointer items-center gap-2 rounded-sm px-2 font-mono text-[12px] ${
              i === hi ? "bg-surface-3 text-ink" : "text-ink-muted"
            }`}
            onMouseEnter={() => setHi(i)}
            onClick={() =>
              multi
                ? setChecked((s) => {
                    const next = new Set(s);
                    if (next.has(o.value)) next.delete(o.value);
                    else next.add(o.value);
                    return next;
                  })
                : onSelect?.(o.value)
            }
          >
            {multi && (
              <span
                className={`h-2 w-2 shrink-0 rounded-sm border ${
                  checked.has(o.value)
                    ? "border-accent bg-accent"
                    : "border-lining"
                }`}
              />
            )}
            {o.swatch && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: o.swatch }}
              />
            )}
            <span className="truncate">{o.label}</span>
            {o.hint && (
              <kbd className="ml-auto font-mono text-[11px] text-ink-tertiary">
                {o.hint}
              </kbd>
            )}
          </li>
        ))}
        {options.length === 0 && (
          <li className="px-2 py-1 font-mono text-[11px] text-ink-tertiary">
            no options
          </li>
        )}
      </ul>
    </li>
  );
}
