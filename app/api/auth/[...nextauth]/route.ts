/**
 * NextAuth catchall route. Handles every endpoint under /api/auth/*
 * (signin, signout, callback, csrf, session, providers, etc.) by
 * delegating to the handlers exported from auth.ts.
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;

export const dynamic = "force-dynamic";
