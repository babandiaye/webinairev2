import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BreakoutRoomDto, ParticipantDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";

const UNASSIGNED = "";

export function BreakoutManagePanel({
  roomId,
  open,
  onClose,
  onJoin,
}: {
  roomId: string;
  open: boolean;
  onClose: () => void;
  onJoin: (breakoutRoomId: string) => void;
}) {
  const [breakouts, setBreakouts] = useState<BreakoutRoomDto[]>([]);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [b, p] = await Promise.all([api.listBreakoutRooms(roomId), api.listRoomParticipants(roomId)]);
      setBreakouts(b);
      setParticipants(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  useEffect(() => {
    if (open) refresh();
  }, [open, roomId]);

  function breakoutOf(userId: string): string {
    return breakouts.find((b) => b.assignedUserIds.includes(userId))?.id ?? UNASSIGNED;
  }

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      await api.createBreakoutRooms(roomId, { count });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(userId: string, breakoutRoomId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.assignBreakout(roomId, { assignments: [{ userId, breakoutRoomId: breakoutRoomId || null }] });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleCloseAll() {
    setBusy(true);
    setError(null);
    try {
      await api.closeBreakoutRooms(roomId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  const activeBreakouts = breakouts.filter((b) => b.status !== "ENDED");

  if (!open) return null;

  return (
    <div className="breakout-panel">
      <div className="breakout-panel-header">
        <h4>Salles de sous-groupe</h4>
        <button className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="breakout-panel-section">
            <label>Créer des sous-salles</label>
            <div className="breakout-create-row">
              <input
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
              <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
                Créer
              </button>
            </div>
          </div>

          {activeBreakouts.length === 0 ? (
            <p className="empty-state">Aucune sous-salle pour l'instant.</p>
          ) : (
            <>
              <div className="breakout-panel-section">
                <label>Sous-salles</label>
                <div className="breakout-room-list">
                  {activeBreakouts.map((b) => (
                    <div className="breakout-room-row" key={b.id}>
                      <span>{b.title}</span>
                      <button className="btn btn-ghost" onClick={() => onJoin(b.id)}>
                        Visiter
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="breakout-panel-section">
                <label>Affectation des participants</label>
                <div className="breakout-assign-list">
                  {participants.length === 0 ? (
                    <p className="empty-state">Aucun participant dans la salle principale.</p>
                  ) : (
                    participants.map((p) => (
                      <div className="breakout-assign-row" key={p.identity}>
                        <span>{p.name}</span>
                        <select
                          className="role-select"
                          value={breakoutOf(p.identity)}
                          disabled={busy}
                          onChange={(e) => handleAssign(p.identity, e.target.value)}
                        >
                          <option value={UNASSIGNED}>Non affecté</option>
                          {activeBreakouts.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <button className="btn btn-danger" onClick={handleCloseAll} disabled={busy}>
                Fermer toutes les sous-salles
              </button>
            </>
          )}
    </div>
  );
}
