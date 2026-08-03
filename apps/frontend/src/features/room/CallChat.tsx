import { useEffect, useRef, useState } from "react";
import { Lock, Send } from "lucide-react";
import { useChat, useLocalParticipant } from "@livekit/components-react";
import { isModeratorMetadata } from "./participantMeta";
import { useRoomSignals } from "./useRoomSignals";

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

// Chat maison (remplace le <Chat> par défaut de @livekit/components-react,
// dont le style ne suit pas la charte du reste de la salle). useChat() est
// appelé ici, dans un composant qui doit rester monté en permanence : si on
// démonte ce composant en changeant d'onglet (Discussion ↔ Participants), la
// hook perd son historique et les messages déjà reçus disparaissent. C'est
// pour ça que CallSidebar affiche/masque ce panneau en CSS plutôt qu'en JSX
// conditionnel.
export function CallChat({ canManage }: { canManage: boolean }) {
  const { chatMessages, send, isSending } = useChat();
  const { localParticipant } = useLocalParticipant();
  const { locks } = useRoomSignals();
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const chatBlocked = locks.chatLocked && !canManage;
  // Filtrage À LA RÉCEPTION en plus du masquage de la saisie : le SFU ne sait pas
  // filtrer un canal de données par sujet, la seule barrière possible est que
  // chaque destinataire écarte ce qui ne devrait pas circuler. L'animateur reste
  // toujours lisible, verrou ou non — c'est lui qui l'a posé.
  const visibleMessages = locks.chatLocked
    ? chatMessages.filter((m) => isModeratorMetadata(m.from?.metadata))
    : chatMessages;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleMessages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) return;
    setSendError(null);
    try {
      await send(text);
      // Vidé APRÈS le succès seulement. Auparavant le champ était vidé d'avance
      // et l'erreur avalée : comme useChat n'émet l'écho local qu'une fois
      // sendText résolu (voir setupChat dans @livekit/components-core), un envoi
      // en échec était indiscernable d'un envoi réussi — le texte disparaissait,
      // rien ne s'affichait, et il ne restait aucune trace à diagnostiquer.
      setDraft("");
    } catch (e) {
      // console.error en plus du bandeau : le message d'erreur du SDK est le
      // seul indice exploitable quand l'envoi échoue côté transport.
      console.error("Échec d'envoi du message de discussion", e);
      setSendError(e instanceof Error ? e.message : "Message non envoyé");
    }
  }

  return (
    <div className="call-chat-panel">
      <div className="call-chat-messages" ref={listRef}>
        {visibleMessages.length === 0 && <p className="empty-state">Aucun message pour l'instant.</p>}
        {visibleMessages.map((m) => {
          const own = m.from?.identity === localParticipant.identity;
          return (
            <div className={`call-chat-message ${own ? "own" : ""}`} key={m.id}>
              <div className="call-chat-message-meta">
                <span className="call-chat-message-author">{own ? "Vous" : m.from?.name || m.from?.identity}</span>
                <span className="call-chat-message-time">{formatTime(m.timestamp)}</span>
              </div>
              <div className="call-chat-message-bubble">{m.message}</div>
            </div>
          );
        })}
      </div>

      {chatBlocked ? (
        <div className="call-chat-locked">
          <Lock size={14} />
          La discussion est réservée à l'animateur.
        </div>
      ) : (
        <>
        {/* Le texte reste dans le champ après un échec : l'utilisateur peut
            réessayer sans le retaper. */}
        {sendError && <div className="call-chat-error">Message non envoyé — {sendError}</div>}
        <div className="call-chat-input-row">
          <input
            className="call-chat-input"
            placeholder="Écrire un message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <button
            className="call-chat-send"
            onClick={handleSend}
            disabled={!draft.trim() || isSending}
            title="Envoyer"
          >
            <Send size={16} />
          </button>
        </div>
        </>
      )}
    </div>
  );
}
