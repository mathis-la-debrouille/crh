"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 font-sans">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-gray-500">{error.message}</p>
        <button
          onClick={reset}
          className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
