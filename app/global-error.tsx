"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

/**
 * Catches any uncaught error from React rendering or client effects
 * across the whole app router. Forwards to Sentry when configured,
 * then renders a clean 500 page so the user has somewhere to go.
 *
 * Pages-router fallback (NextError) provides a basic 'Something went
 * wrong' screen with retry. We could replace this with a richer
 * branded page later, but for the rare case it fires the default is
 * fine.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
