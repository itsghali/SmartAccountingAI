"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global application error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background">
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Critical System Error
            </h2>
            <p className="text-muted-foreground max-w-md">
              A fatal error occurred that could not be recovered from. Please try reloading the page.
            </p>
          </div>
          <Button onClick={() => reset()} variant="default" size="lg">
            Reload Application
          </Button>
        </div>
      </body>
    </html>
  );
}
