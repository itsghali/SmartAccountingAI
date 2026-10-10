"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex h-[100vh] w-full flex-col items-center justify-center gap-4 bg-background">
      <div className="flex flex-col items-center gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Something went wrong!
        </h2>
        <p className="text-muted-foreground">
          An unexpected error occurred. We apologize for the inconvenience.
        </p>
      </div>
      <Button onClick={() => reset()} variant="default">
        Try again
      </Button>
    </div>
  );
}
