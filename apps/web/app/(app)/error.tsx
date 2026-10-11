"use client";

import { ErrorState } from "@/components/primitives";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <ErrorState
        title="This view failed to load"
        detail="Something went wrong while rendering. Your data is unchanged."
        actionLabel="Retry"
        onAction={reset}
      />
    </div>
  );
}
