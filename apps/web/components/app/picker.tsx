"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

// One popover host for every inline editor (state, priority, assignee, label,
// project, cycle, filters). Pickers are popovers anchored to their trigger,
// never modals, and Esc returns focus to the trigger (Silver Lining section 7).
export interface PickerOption {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  checked?: boolean;
}
export interface PickerRequest {
  anchor: HTMLElement;
  title: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  multi?: boolean;
  searchable?: boolean;
}

const Ctx = createContext<{ open: (r: PickerRequest) => void; close: () => void } | null>(null);
export const usePicker = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("PickerProvider missing");
  return v;
};

// the popover UI loads on first use, not with the shell
const PickerPopover = dynamic(() => import("./picker-popover").then((m) => m.PickerPopover), { ssr: false });

export function PickerProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<PickerRequest | null>(null);
  const restore = useRef<HTMLElement | null>(null);
  const open = useCallback((r: PickerRequest) => {
    restore.current = r.anchor;
    setReq(r);
  }, []);
  const close = useCallback(() => {
    setReq(null);
    const el = restore.current;
    if (el && el.isConnected) el.focus();
  }, []);
  const value = useMemo(() => ({ open, close }), [open, close]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {req && <PickerPopover key={req.title + req.options.length} req={req} close={close} />}
    </Ctx.Provider>
  );
}
