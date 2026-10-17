import { Skeleton } from "./ui";

// Frames render the instant a lazy dialog is requested, while its chunk
// loads — same outer geometry as the real surface so nothing shifts.
export function ModalFrame() {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/80 pt-[15vh]" role="status" aria-busy="true" aria-label="Loading">
      <div className="w-full max-w-lg rounded-md border border-lining-bright bg-surface-1 p-3 shadow-lg">
        <Skeleton className="h-8 w-full" />
        <div className="mt-2 space-y-1.5">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-4/5" />
        </div>
      </div>
    </div>
  );
}

export function PeekFrame() {
  return (
    <div
      className="fixed inset-y-0 right-0 z-40 flex w-[min(480px,100vw)] shrink-0 flex-col border-l border-lining-strong bg-surface-1 min-[1440px]:static min-[1440px]:z-auto min-[1440px]:w-[var(--peek-w)]"
      role="status" aria-busy="true" aria-label="Loading"
    >
      <div className="flex h-12 items-center gap-3 border-b border-lining-faint px-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-5 w-2/3" />
      </div>
      <div className="space-y-3 p-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
