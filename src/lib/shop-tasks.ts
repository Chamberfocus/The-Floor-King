/** Open to-dos and the notice that goes back to the person who sent one. */

export interface ShopTaskRow {
  id: string;
  title: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  assignedTo: string | null;
  assigneeName: string;
  createdBy: string | null;
  senderName: string;
  completedBy: string | null;
  completerName: string;
  senderSeenAt: string | null;
}

export interface ShopTaskLists {
  /** Assigned to this person and not done. */
  mine: ShopTaskRow[];
  /** This person sent it to someone else and it is still open. */
  sent: ShopTaskRow[];
  /** Someone else finished a to-do this person sent, and they have not seen that yet. */
  finished: ShopTaskRow[];
}

function isOpen(status: string): boolean {
  return status === "open" || status === "in_progress";
}

export function splitShopTasks(tasks: ShopTaskRow[], userId: string): ShopTaskLists {
  return {
    mine: tasks.filter((task) => task.assignedTo === userId && isOpen(task.status)),
    sent: tasks.filter(
      (task) => task.createdBy === userId && task.assignedTo !== userId && isOpen(task.status),
    ),
    finished: tasks.filter(
      (task) =>
        task.createdBy === userId &&
        task.status === "completed" &&
        !task.senderSeenAt &&
        !!task.completedBy &&
        task.completedBy !== userId,
    ),
  };
}

export function tasksForCustomer(tasks: ShopTaskRow[], customerId: string): ShopTaskRow[] {
  return tasks.filter(
    (task) => task.customerId === customerId && isOpen(task.status),
  );
}
