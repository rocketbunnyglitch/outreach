import { staffMembers } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { createTask } from "../_actions";
import { TaskForm } from "../_components/task-form";

export const metadata = { title: "New task" };
export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const { staff: currentStaff } = await requireStaff();
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
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <ChevronLeft className="h-3 w-3" /> All tasks
        </Link>
        <h1 className="mt-3 font-semibold text-4xl tracking-tight">New task</h1>
      </header>
      <TaskForm
        mode="create"
        staffList={staffList}
        currentUserId={currentStaff.id}
        action={createTask}
      />
    </div>
  );
}
