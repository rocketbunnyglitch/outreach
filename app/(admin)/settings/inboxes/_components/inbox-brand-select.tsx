"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reassignInboxBrand } from "../_actions";

/** Inline brand re-assignment for a connected email — group it under any brand. */
export function InboxBrandSelect({
  emailId,
  currentBrandId,
  brands,
}: {
  emailId: string;
  currentBrandId: string;
  brands: Array<{ id: string; displayName: string }>;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [value, setValue] = useState(currentBrandId);

  function handle(next: string) {
    if (next === value) return;
    const prev = value;
    setValue(next);
    startTx(async () => {
      const res = await reassignInboxBrand(emailId, next);
      if (res.ok) router.refresh();
      else setValue(prev);
    });
  }

  return (
    <select
      value={value}
      onChange={(e) => handle(e.target.value)}
      disabled={pending}
      title="Brand this email is grouped under — change to regroup it"
      className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
    >
      {brands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.displayName}
        </option>
      ))}
    </select>
  );
}
