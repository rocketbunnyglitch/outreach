import { cn } from "@/lib/cn";
import { FOLDER_LABELS, INBOX_FOLDERS, type InboxFolder } from "@/lib/inbox-data";
import {
  CheckCheck,
  CheckCircle2,
  Clock4,
  Inbox as InboxIcon,
  MailOpen,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

/**
 * Five canonical folders. Anything else (campaign / brand / staff) becomes
 * a filter chip below the folders — see CLAUDE design rationale: 13 folders
 * is decision fatigue dressed as power-user.
 */
const FOLDER_ICONS: Record<InboxFolder, React.ReactNode> = {
  needs_reply: <InboxIcon className="h-4 w-4" />,
  waiting: <Clock4 className="h-4 w-4" />,
  follow_up: <RotateCcw className="h-4 w-4" />,
  closed: <CheckCircle2 className="h-4 w-4" />,
  all: <MailOpen className="h-4 w-4" />,
};

export function FolderList({
  activeFolder,
  counts,
  mineOnly,
  currentStaffId,
}: {
  activeFolder: InboxFolder;
  counts: Record<InboxFolder, number>;
  mineOnly: boolean;
  currentStaffId: string;
}) {
  return (
    <nav aria-label="Inbox folders" className="flex flex-col gap-4">
      <header className="px-2">
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Operations</p>
        <h2 className="mt-0.5 font-semibold text-lg tracking-tight">Inbox</h2>
      </header>

      <ul className="flex flex-col gap-0.5">
        {INBOX_FOLDERS.map((folder) => {
          const isActive = folder === activeFolder;
          const count = counts[folder] ?? 0;
          const params = new URLSearchParams();
          params.set("folder", folder);
          if (mineOnly) params.set("staff", currentStaffId);
          return (
            <li key={folder}>
              <Link
                href={`/inbox?${params.toString()}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900",
                )}
              >
                <span
                  className={cn(
                    "shrink-0",
                    isActive
                      ? "text-zinc-200 dark:text-zinc-700"
                      : "text-zinc-500 dark:text-zinc-400",
                  )}
                >
                  {FOLDER_ICONS[folder]}
                </span>
                <span className="flex-1 truncate">{FOLDER_LABELS[folder]}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] tabular-nums",
                      isActive
                        ? "text-zinc-300 dark:text-zinc-700"
                        : "text-zinc-500 dark:text-zinc-500",
                    )}
                  >
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-zinc-200/80 border-t pt-3 dark:border-zinc-800/60">
        <p className="px-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
          Filters
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          <li>
            <ChipLink
              href={
                mineOnly
                  ? `/inbox?folder=${activeFolder}`
                  : `/inbox?folder=${activeFolder}&staff=${currentStaffId}`
              }
              active={mineOnly}
              icon={<CheckCheck className="h-3.5 w-3.5" />}
            >
              Mine only
            </ChipLink>
          </li>
          {/*
            Brand / campaign / city chips ship in the next iteration once
            we have settings to choose from. Keeping the visual slot here
            so the layout doesn't shift when they land.
          */}
        </ul>
      </div>
    </nav>
  );
}

function ChipLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
        active
          ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900",
      )}
    >
      <span className="shrink-0 text-zinc-500">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
    </Link>
  );
}
