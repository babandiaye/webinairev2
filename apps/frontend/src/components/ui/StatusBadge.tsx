import { RoomStatus } from "@webinairev2/shared-types";

const LABELS: Record<RoomStatus, string> = {
  SCHEDULED: "Programmée",
  LIVE: "En direct",
  ENDED: "Terminée",
};

export function StatusBadge({ status }: { status: RoomStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>{LABELS[status]}</span>
  );
}
