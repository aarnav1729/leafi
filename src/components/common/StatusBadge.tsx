import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: "initial" | "evaluation" | "closed";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "px-2 py-1 text-xs font-medium rounded-full",
        status === "initial" && "bg-status-initial text-white",
        status === "evaluation" && "bg-status-evaluation text-white",
        status === "closed" && "bg-status-closed text-white"
      )}
    >
      {status === "initial"
        ? "Initial"
        : status === "evaluation"
        ? "Evaluation"
        : "Closed"}
    </span>
  );
}
