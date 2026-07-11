import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useChat, useLocalParticipant } from "@livekit/components-react";

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
export function CallChat() {
  const { chatMessages, send, isSending } = useChat();
  const { localParticipant } = useLocalParticipant();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages.length]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft("");
    try {
      await send(text);
    } catch {
      // message perdu silencieusement en cas d'échec réseau ponctuel — pas de
      // file d'attente/retry pour ce chat éphémère
    }
  }

  return (
    <div className="call-chat-panel">
      <div className="call-chat-messages" ref={listRef}>
        {chatMessages.length === 0 && <p className="empty-state">Aucun message pour l'instant.</p>}
        {chatMessages.map((m) => {
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
        <button className="call-chat-send" onClick={handleSend} disabled={!draft.trim() || isSending} title="Envoyer">
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
