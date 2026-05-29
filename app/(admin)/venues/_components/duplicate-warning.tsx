"use client";

import type { VenueDuplicate } from "@/lib/venue-duplicates";
import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { checkVenueDuplicates } from "./duplicate-check-action";

interface Props {
  /** ID of the name input — we read it via getElementById to avoid prop drilling */
  nameInputId: string;
  /** ID of the city select */
  cityInputId: string;
  /** Optional address input */
  addressInputId?: string;
  /** When editing, omit the venue itself from results */
  ignoreVenueId?: string;
}

/**
 * Watches the venue form's name + city + address inputs and surfaces any
 * existing venues that look similar. Helps prevent the operator from
 * creating duplicates of venues that were entered under slightly different
 * names ("The Drake" vs "Drake Hotel") or imported from a different campaign.
 *
 * Implementation:
 *   - reads input values via getElementById (the form is server-rendered,
 *     and this component is a pure client widget attached underneath the
 *     name field)
 *   - debounces 500ms on input
 *   - bails when name is too short (<3 chars)
 *   - calls a server action that wraps findVenueDuplicates
 *   - renders an amber warning panel with up to 5 matches + similarity %
 *
 * Operator can still submit — the form doesn't block on this. The warning
 * is informational. Clicking a duplicate goes to that venue's detail page.
 */
export function DuplicateWarning({
  nameInputId,
  cityInputId,
  addressInputId,
  ignoreVenueId,
}: Props) {
  const [name, setName] = useState("");
  const [cityId, setCityId] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [matches, setMatches] = useState<VenueDuplicate[]>([]);
  const [loading, setLoading] = useState(false);

  // Wire up listeners to the named inputs on mount
  useEffect(() => {
    const nameEl = document.getElementById(nameInputId) as HTMLInputElement | null;
    const cityEl = document.getElementById(cityInputId) as HTMLSelectElement | null;
    const addrEl = addressInputId
      ? (document.getElementById(addressInputId) as HTMLInputElement | null)
      : null;

    if (!nameEl) return;

    // Seed initial values
    setName(nameEl.value ?? "");
    setCityId(cityEl?.value ?? null);
    setAddress(addrEl?.value ?? null);

    const onName = () => setName(nameEl.value);
    const onCity = () => setCityId(cityEl?.value ?? null);
    const onAddr = () => setAddress(addrEl?.value ?? null);

    nameEl.addEventListener("input", onName);
    cityEl?.addEventListener("change", onCity);
    addrEl?.addEventListener("input", onAddr);

    return () => {
      nameEl.removeEventListener("input", onName);
      cityEl?.removeEventListener("change", onCity);
      addrEl?.removeEventListener("input", onAddr);
    };
  }, [nameInputId, cityInputId, addressInputId]);

  // Debounced lookup
  useEffect(() => {
    if (name.trim().length < 3) {
      setMatches([]);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await checkVenueDuplicates({
          candidateName: name,
          candidateAddress: address,
          cityId: cityId || null,
        });
        if (cancelled) return;
        // Filter the venue itself out if we're in edit mode
        const filtered = ignoreVenueId ? result.filter((r) => r.id !== ignoreVenueId) : result;
        setMatches(filtered);
      } catch (_err) {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [name, cityId, address, ignoreVenueId]);

  if (matches.length === 0 && !loading) return null;

  return (
    <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs dark:border-rose-900/50 dark:bg-rose-950/30">
      <div className="flex items-start gap-2">
        {loading ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-rose-700 dark:text-rose-300" />
        ) : (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-300" />
        )}
        <div className="min-w-0 flex-1">
          {loading ? (
            <p className="font-mono text-rose-800 dark:text-rose-300">checking for duplicates…</p>
          ) : (
            <>
              <p className="font-medium text-rose-900 dark:text-rose-200">
                {matches.length === 1
                  ? "1 venue looks similar — check before creating a duplicate"
                  : `${matches.length} venues look similar — check before creating a duplicate`}
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {matches.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/venues/${m.id}`}
                      target="_blank"
                      className="min-w-0 truncate text-rose-900 underline hover:no-underline dark:text-rose-200"
                    >
                      {m.name}
                      {m.address && (
                        <span className="ml-2 text-rose-700/80 dark:text-rose-300/80">
                          · {m.address.split(",")[0]}
                        </span>
                      )}
                      {m.doNotContact && (
                        <span className="ml-2 font-mono text-[10px] text-rose-500 uppercase tracking-widest">
                          DNC
                        </span>
                      )}
                    </Link>
                    <span className="shrink-0 font-mono text-[10px] text-rose-700 tabular-nums dark:text-rose-300">
                      {Math.round(m.bestScore * 100)}% match
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
