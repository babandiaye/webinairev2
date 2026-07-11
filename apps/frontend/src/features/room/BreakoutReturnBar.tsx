import { ArrowLeft } from "lucide-react";

export function BreakoutReturnBar({ title, onReturn }: { title: string; onReturn: () => void }) {
  return (
    <div className="recording-bar">
      <span>{title}</span>
      <button className="btn btn-ghost" onClick={onReturn}>
        <ArrowLeft size={15} />
        Retourner à la salle principale
      </button>
    </div>
  );
}
