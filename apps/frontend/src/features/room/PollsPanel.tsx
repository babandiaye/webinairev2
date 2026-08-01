import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { PollDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";

const TOPIC = "poll";
const STATUS_LABELS: Record<PollDto["status"], string> = {
  DRAFT: "Brouillon",
  OPEN: "Ouvert",
  CLOSED: "Fermé",
};

export function PollsPanel({
  roomId,
  canManage,
  open,
  onClose,
}: {
  roomId: string;
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [polls, setPolls] = useState<PollDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const room = useRoomContext();

  function refresh() {
    api.listPolls(roomId).then(setPolls).catch(() => {});
  }

  useEffect(() => {
    if (!open) return;
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [open, roomId]);

  // room.on direct plutôt que useDataChannel(TOPIC, callbackEnLigne) : ce
  // hook réabonne room.on(DataReceived) dès que la référence du callback
  // change, et une fonction fléchée déclarée dans le corps du composant en
  // est une nouvelle À CHAQUE rendu — tout message reçu pendant la fenêtre de
  // réabonnement est perdu pour de bon (même en `reliable: true`, qui ne
  // protège que le transport, pas la présence d'un auditeur JS au bon
  // moment). Défaut découvert sur le tableau blanc (voir Whiteboard.tsx pour
  // le détail complet), reproduit ici à l'identique et corrigé de même — même
  // si l'impact y est moindre : le sondage a déjà un secours (l'intervalle de
  // 4 s ci-dessus), donc un message manqué ne fait qu'ajouter jusqu'à 4 s de
  // retard plutôt que désynchroniser durablement.
  useEffect(() => {
    function handleData(_payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) {
      if (topic === TOPIC) refresh();
    }
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, roomId]);

  function notifyOthers() {
    room.localParticipant.publishData(new TextEncoder().encode("updated"), { reliable: true, topic: TOPIC });
  }

  async function handleCreate() {
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (!question.trim() || cleanOptions.length < 2) {
      setError("Une question et au moins deux options sont nécessaires");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createPoll(roomId, { question: question.trim(), options: cleanOptions, multiple });
      setQuestion("");
      setOptions(["", ""]);
      setMultiple(false);
      setShowCreateForm(false);
      refresh();
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(pollId: string) {
    setBusy(true);
    try {
      await api.openPoll(roomId, pollId);
      refresh();
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(pollId: string) {
    setBusy(true);
    try {
      await api.closePoll(roomId, pollId);
      refresh();
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(poll: PollDto, optionId: string) {
    const current = poll.options.filter((o) => o.votedByMe).map((o) => o.id);
    const optionIds = poll.multiple
      ? current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
      : [optionId];
    if (optionIds.length === 0) return;

    setBusy(true);
    try {
      await api.votePoll(roomId, poll.id, { optionIds });
      refresh();
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="breakout-panel">
      <div className="breakout-panel-header">
        <h4>Sondages</h4>
        <button className="icon-btn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

          {error && <div className="error-banner">{error}</div>}

          {canManage && (
            <div className="breakout-panel-section">
              {showCreateForm ? (
                <div className="poll-create-form">
                  <input
                    placeholder="Question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  {options.map((opt, i) => (
                    <input
                      key={i}
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={(e) =>
                        setOptions((prev) => prev.map((o, idx) => (idx === i ? e.target.value : o)))
                      }
                    />
                  ))}
                  <button className="btn btn-ghost" onClick={() => setOptions((prev) => [...prev, ""])}>
                    <Plus size={14} />
                    Ajouter une option
                  </button>
                  <label className="poll-multiple-check">
                    <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
                    Choix multiple
                  </label>
                  <button className="btn btn-primary" onClick={handleCreate} disabled={busy}>
                    Créer le sondage
                  </button>
                </div>
              ) : (
                <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>
                  <Plus size={15} />
                  Nouveau sondage
                </button>
              )}
            </div>
          )}

          {polls.length === 0 ? (
            <p className="empty-state">Aucun sondage pour l'instant.</p>
          ) : (
            <div className="poll-list">
              {polls.map((poll) => {
                const total = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
                return (
                  <div className="poll-card" key={poll.id}>
                    <div className="poll-card-header">
                      <span className="poll-question">{poll.question}</span>
                      <span className={`status-badge status-${poll.status === "OPEN" ? "live" : poll.status === "CLOSED" ? "ended" : "scheduled"}`}>
                        {STATUS_LABELS[poll.status]}
                      </span>
                    </div>
                    <div className="poll-options">
                      {poll.options.map((o) => {
                        const pct = total > 0 ? Math.round((o.voteCount / total) * 100) : 0;
                        return (
                          <button
                            key={o.id}
                            className={`poll-option ${o.votedByMe ? "voted" : ""}`}
                            disabled={poll.status !== "OPEN" || busy}
                            onClick={() => handleVote(poll, o.id)}
                          >
                            <div className="poll-option-bar" style={{ width: `${pct}%` }} />
                            <span className="poll-option-label">{o.label}</span>
                            <span className="poll-option-count">
                              {o.voteCount} ({pct}%)
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {canManage && (
                      <div className="poll-card-actions">
                        {poll.status === "DRAFT" && (
                          <button className="btn btn-ghost" onClick={() => handleOpen(poll.id)} disabled={busy}>
                            Ouvrir
                          </button>
                        )}
                        {poll.status === "OPEN" && (
                          <button className="btn btn-ghost" onClick={() => handleClose(poll.id)} disabled={busy}>
                            Fermer
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
    </div>
  );
}
