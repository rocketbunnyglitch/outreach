"use client";

/**
 * ComposeEmailButton — drop-in replacement for the old
 * <ComposeEmailModal>. Renders any children as a clickable trigger
 * that opens the global Gmail-style composer via the composer store.
 *
 * Same props surface as ComposeEmailModal so callsites can swap with
 * minimal diff:
 *   <ComposeEmailButton defaultTo="..." venueId="...">
 *     <Mail className="h-3 w-3" />
 *   </ComposeEmailButton>
 *
 * The actual composer window mounts at the admin layout (ComposerHost)
 * — this component just dispatches `open()`. Persistence across route
 * changes happens because the composer store + host live above the
 * router-owned <main>.
 */

import type { ReactNode } from "react";
import { useComposer } from "./composer-store";

interface Props {
  children: ReactNode;
  defaultTo?: string;
  defaultSubject?: string;
  defaultBody?: string;
  venueId?: string | null;
  cityCampaignId?: string | null;
  templateId?: string | null;
  ariaLabel?: string;
  className?: string;
  isAdmin?: boolean;
}

export function ComposeEmailButton({
  children,
  defaultTo,
  defaultSubject,
  defaultBody,
  venueId,
  cityCampaignId,
  templateId,
  ariaLabel = "Compose email",
  className,
  isAdmin = false,
}: Props) {
  const { open } = useComposer();

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        open({
          to: defaultTo,
          subject: defaultSubject,
          bodyText: defaultBody,
          venueId,
          cityCampaignId,
          templateId,
          isAdmin,
        });
      }}
    >
      {children}
    </button>
  );
}
