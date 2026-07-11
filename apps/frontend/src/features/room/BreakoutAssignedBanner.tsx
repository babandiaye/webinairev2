import { useEffect, useState } from "react";
import { MyBreakoutAssignmentDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";

export function BreakoutAssignedBanner({
  roomId,
  currentBreakoutId,
  onJoin,
}: {
  roomId: string;
  currentBreakoutId: string | null;
  onJoin: (breakoutRoomId: string) => void;
}) {
  const [assignment, setAssignment] = useState<MyBreakoutAssignmentDto | null>(null);

  useEffect(() => {
    const load = () => api.myBreakoutAssignment(roomId).then(setAssignment).catch(() => {});
    load();
    // Polling simple : le moment de l'affectation est imprévisible côté participant,
    // pas besoin d'un canal temps réel dédié juste pour cette notification.
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [roomId]);

  if (!assignment?.breakoutRoomId || assignment.breakoutRoomId === currentBreakoutId) return null;

  return (
    <div className="breakout-banner">
      <span>Vous avez été affecté à « {assignment.title} »</span>
      <button className="btn btn-primary" onClick={() => onJoin(assignment.breakoutRoomId!)}>
        Rejoindre le groupe
      </button>
    </div>
  );
}
