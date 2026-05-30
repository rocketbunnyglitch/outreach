import { Badge } from "@/components/ui/badge";
import { staffMembers, tasks } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, eq, isNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateTask } from "../_actions";
import { CompleteTaskButton } from "../_components/complete-task-button";
import { DeleteTaskButton } from "../_components/delete-task-button";
import { TaskForm } from "../_components/task-form";

export const metadata = { title: "Task" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { staff: currentStaff } = await requireStaff();

  const [task, staffList] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        source: tasks.source,
        targetType: tasks.targetType,
        targetId: tasks.targetId,
        assignedStaffId: tasks.assignedStaffId,
        dueAt: tasks.dueAt,
        completedAt: tasks.completedAt,
        slaThresholdMinutes: tasks.slaThresholdMinutes,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        version: tasks.version,
      })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        id: staffMembers.id,
        displayName: staffMembers.displayName,
      })
      .from(staffMembers)
      .where(isNull(staffMembers.archivedAt))
      .orderBy(asc(staffMembers.displayName)),
  ]);

  if (!task) {
    notFound();
  }

  // datetime-local input expects "YYYY-MM-DDTHH:MM" — convert from Date
  const dueAtLocal = task.dueAt ? toDatetimeLocalString(task.dueAt) : null;

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            <ChevronLeft className="h-3 w-3" /> All tasks
          </Link>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight">{task.title}</h1>
          <div className="mt-3 flex items-center gap-2">
            <Badge tone="muted">{task.source}</Badge>
            {task.targetType !== "misc" && (
              <Badge tone="muted">{task.targetType.replace("_", " ")}</Badge>
            )}
            {task.targetType === "email_thread" && task.targetId && (
              <Link
                href={`/inbox/${task.targetId}`}
                className="font-mono text-[11px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                open thread →
              </Link>
            )}
            {task.completedAt && (
              <span className="font-mono text-xs text-zinc-500">
                completed {task.completedAt.toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {task.status === "pending" || task.status === "in_progress" ? (
            <CompleteTaskButton taskId={task.id} version={task.version} />
          ) : null}
          {currentStaff.role === "admin" ? <DeleteTaskButton taskId={task.id} /> : null}
        </div>
      </header>

      <TaskForm
        mode="edit"
        staffList={staffList}
        currentUserId={currentStaff.id}
        initial={{
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          targetType: task.targetType,
          targetId: task.targetId,
          assignedStaffId: task.assignedStaffId,
          dueAt: dueAtLocal,
          slaThresholdMinutes: task.slaThresholdMinutes,
          version: task.version,
        }}
        action={updateTask}
      />
    </div>
  );
}

function toDatetimeLocalString(d: Date): string {
  // datetime-local wants the user's local time formatted "YYYY-MM-DDTHH:MM"
  // We always render server-side here, but the DB stores UTC. Convert to
  // local for the input, accepting that "local" on the server is its TZ.
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
