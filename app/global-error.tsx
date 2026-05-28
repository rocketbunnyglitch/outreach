"use client";

import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

/**
 * Catches any uncaught error from React rendering or client effects
 * across the whole app router. Forwards to Sentry when configured,
 * then renders a clean 500 page so the user has somewhere to go.
 *
 * This component renders its OWN <html>/<body> and replaces the root
 * layout entirely (that's how Next.js global error boundaries work), so
 * the root layout's pre-paint theme-init script never runs on this path.
 * We re-inject THEME_INIT_SCRIPT in <head> so the error page honors the
 * saved light/dark preference instead of defaulting to light
 * (session-13: "error boundary loads in light mode despite dark").
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: inline theme-init must run before paint to avoid a light-mode flash on the error page */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
