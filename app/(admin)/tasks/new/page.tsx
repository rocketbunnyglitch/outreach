import { staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { asc, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createTask } from "../_actions";
import { TaskForm } from "../_components/task-form";

export const metadata = { title: "New task · Crawl Engine" };
export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const staffList = await db
    .select({
      id: staffMembers.id,
      displayName: staffMembers.displayName,
    })
    .from(staffMembers)
    .where(isNull(staffMembers.archivedAt))
    .orderBy(asc(staffMembers.displayName));

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100"
        >
          <ChevronLeft className="h-3 w-3" /> All tasks
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight">New task</h1>
      </header>
      <TaskForm mode="create" staffList={staffList} action={createTask} />
    </div>
  );
}
