import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent } from "livekit-client";
import type { Participant } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { isModeratorMetadata } from "./participantMeta";
import { HAND_RAISE_TOPIC, REACTION_TOPIC } from "./useRoomSignals";

// Cadence de rafraîchissement de l'affichage. Les compteurs, eux, sont exacts à
// la milliseconde : ils sont alimentés par les évènements LiveKit, pas par cet
// échantillonnage — l'intervalle ne fait que redessiner le tableau.
const REFRESH_INTERVAL_MS = 1000;

export type ParticipantEngagement = {
  identity: string;
  name: string;
  isModerator: boolean;
  /** Temps cumulé dans la séance, reconnexions comprises. */
  presenceMs: number;
  /** Temps de parole cumulé (détection d'orateur actif du SFU). */
  talkMs: number;
  /** Nombre de prises de parole distinctes. */
  talkTurns: number;
  chatMessages: number;
  reactions: number;
  handRaises: number;
  /** Nombre de connexions à la séance (> 1 = a été coupé puis revenu). */
  connections: number;
  present: boolean;
  micOn: boolean;
  cameraOn: boolean;
};

type Accumulator = {
  identity: string;
  name: string;
  isModerator: boolean;
  presenceMs: number;
  /** Horodatage d'entrée de la présence en cours, null si déconnecté. */
  presentSince: number | null;
  talkMs: number;
  /** Horodatage de début de la prise de parole en cours, null si silencieux. */
  speakingSince: number | null;
  talkTurns: number;
  chatMessages: number;
  reactions: number;
  handRaises: number;
  connections: number;
};

type EngagementContextValue = {
  /** Fonction stable : lire les compteurs ne provoque aucun rendu du fournisseur. */
  getSnapshot: () => ParticipantEngagement[];
};

const EngagementContext = createContext<EngagementContextValue | null>(null);

/**
 * Collecte les statistiques d'engagement de la séance EN COURS, entièrement en
 * mémoire : rien n'est envoyé au serveur, rien n'est écrit en base.
 *
 * Pourquoi côté navigateur et pas côté backend : vérifié dans @livekit/protocol
 * 1.49, aucun webhook LiveKit n'expose la parole. La liste complète est
 * room_started, room_finished, participant_joined, participant_left,
 * participant_connection_aborted, track_published, track_unpublished, egress_*,
 * ingress_*. Le SFU calcule bien les orateurs actifs mais ne les diffuse qu'aux
 * CLIENTS connectés (ActiveSpeakersChanged) — l'agrégation n'est donc possible
 * qu'ici. Les messages Analytics* du protocole appartiennent au service interne
 * de LiveKit Cloud, sans équivalent en auto-hébergé.
 *
 * Conséquence assumée : les chiffres vivent le temps de la séance et de cet
 * onglet. C'est aussi le fonctionnement du tableau de bord de BigBlueButton, qui
 * est un tableau live. L'export CSV/PDF est le seul moyen d'en garder une trace.
 *
 * Ne provoque JAMAIS de rendu de ses enfants : tout est accumulé dans des refs
 * et la valeur de contexte est figée. Un rendu à chaque changement d'orateur
 * redessinerait toute l'interface d'appel plusieurs fois par seconde.
 */
export function EngagementProvider({
  children,
  // Seul l'animateur consulte ce tableau : inutile de faire tourner la collecte
  // dans les 60 navigateurs d'un amphi pour des chiffres que personne n'y lira.
  enabled,
}: {
  children: React.ReactNode;
  enabled: boolean;
}) {
  const room = useRoomContext();
  const accumulatorsRef = useRef<Map<string, Accumulator>>(new Map());

  useEffect(() => {
    if (!enabled) return;
    const accumulators = accumulatorsRef.current;

    function ensure(participant: Participant): Accumulator {
      const existing = accumulators.get(participant.identity);
      if (existing) {
        // Le nom peut arriver après la connexion (métadonnées mises à jour) —
        // on ne fige donc pas la première valeur vue.
        existing.name = participant.name || participant.identity;
        existing.isModerator = isModeratorMetadata(participant.metadata);
        return existing;
      }
      const created: Accumulator = {
        identity: participant.identity,
        name: participant.name || participant.identity,
        isModerator: isModeratorMetadata(participant.metadata),
        presenceMs: 0,
        // joinedAt du SFU quand il est connu : sinon un participant déjà présent
        // à l'ouverture du panneau démarrerait à zéro, ce qui sous-estimerait la
        // présence de tous ceux arrivés avant l'animateur.
        presentSince: participant.joinedAt?.getTime() ?? Date.now(),
        talkMs: 0,
        speakingSince: null,
        talkTurns: 0,
        chatMessages: 0,
        reactions: 0,
        handRaises: 0,
        connections: 1,
      };
      accumulators.set(participant.identity, created);
      return created;
    }

    // Amorçage : les participants déjà là quand ce fournisseur est monté.
    ensure(room.localParticipant);
    room.remoteParticipants.forEach(ensure);

    function handleConnected(participant: Participant) {
      const accumulator = accumulators.get(participant.identity);
      if (!accumulator) {
        ensure(participant);
        return;
      }
      // Retour après une coupure : on rouvre une période de présence sans perdre
      // le temps déjà cumulé, et on compte une connexion de plus — c'est
      // précisément ce qui signale une connexion instable.
      accumulator.presentSince = Date.now();
      accumulator.connections += 1;
    }

    function handleDisconnected(participant: Participant) {
      const accumulator = accumulators.get(participant.identity);
      if (!accumulator) return;
      const now = Date.now();
      if (accumulator.presentSince !== null) {
        accumulator.presenceMs += now - accumulator.presentSince;
        accumulator.presentSince = null;
      }
      // Quitter en pleine phrase ne doit pas laisser une prise de parole ouverte
      // qui continuerait de croître indéfiniment au calcul de l'instantané.
      if (accumulator.speakingSince !== null) {
        accumulator.talkMs += now - accumulator.speakingSince;
        accumulator.speakingSince = null;
      }
    }

    function handleActiveSpeakers(speakers: Participant[]) {
      const now = Date.now();
      const speaking = new Set(speakers.map((s) => s.identity));

      for (const accumulator of accumulators.values()) {
        const isSpeaking = speaking.has(accumulator.identity);
        if (isSpeaking && accumulator.speakingSince === null) {
          accumulator.speakingSince = now;
          accumulator.talkTurns += 1;
        } else if (!isSpeaking && accumulator.speakingSince !== null) {
          accumulator.talkMs += now - accumulator.speakingSince;
          accumulator.speakingSince = null;
        }
      }

      // Un orateur inconnu du tableau (arrivé avant l'amorçage, ou évènement
      // reçu avant ParticipantConnected) doit quand même être compté.
      for (const speaker of speakers) {
        if (!accumulators.has(speaker.identity)) {
          const accumulator = ensure(speaker);
          accumulator.speakingSince = now;
          accumulator.talkTurns += 1;
        }
      }
    }

    // On écoute l'évènement brut plutôt que useChat() : ce hook renverrait un
    // nouveau tableau à chaque message et forcerait un rendu du fournisseur,
    // donc de toute l'interface d'appel.
    function handleChatMessage(_message: unknown, participant?: Participant) {
      if (!participant) return;
      ensure(participant).chatMessages += 1;
    }

    // Réactions et mains levées transitent par le canal de données (voir
    // useRoomSignals) : on les compte à la source plutôt que de les faire
    // remonter par un second chemin. Seules celles REÇUES sont comptées —
    // publishData n'étant pas ré-émis vers son expéditeur, l'animateur ne verra
    // pas ses propres réactions dans le tableau, ce qui est sans conséquence
    // puisque c'est l'engagement des étudiants qu'il vient y lire.
    function handleSignal(
      payload: Uint8Array,
      participant?: Participant,
      _kind?: unknown,
      topic?: string
    ) {
      if (!participant) return;
      if (topic === REACTION_TOPIC) {
        ensure(participant).reactions += 1;
        return;
      }
      if (topic !== HAND_RAISE_TOPIC) return;
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        // Seule une main qui SE LÈVE compte : `raisedAgoMs: null` est une main
        // baissée, et une réponse de resynchronisation rejoue une main déjà
        // comptée — la compter deux fois gonflerait le total à chaque arrivée.
        if (message?.t === "set" && message.raisedAgoMs === 0) {
          ensure(participant).handRaises += 1;
        }
      } catch {
        // message malformé ignoré
      }
    }

    room.on(RoomEvent.ParticipantConnected, handleConnected);
    room.on(RoomEvent.ParticipantDisconnected, handleDisconnected);
    room.on(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
    room.on(RoomEvent.ChatMessage, handleChatMessage);
    room.on(RoomEvent.DataReceived, handleSignal);

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleConnected);
      room.off(RoomEvent.ParticipantDisconnected, handleDisconnected);
      room.off(RoomEvent.ActiveSpeakersChanged, handleActiveSpeakers);
      room.off(RoomEvent.ChatMessage, handleChatMessage);
      room.off(RoomEvent.DataReceived, handleSignal);
    };
  }, [room, enabled]);

  const value = useMemo<EngagementContextValue>(
    () => ({
      getSnapshot() {
        const now = Date.now();
        return [...accumulatorsRef.current.values()]
          .map((accumulator) => {
            // Périodes en cours ajoutées à la volée : les accumulateurs ne sont
            // clos qu'aux transitions, ils ne peuvent pas "avancer" tout seuls.
            const live = room.getParticipantByIdentity(accumulator.identity);
            return {
              identity: accumulator.identity,
              name: accumulator.name,
              isModerator: accumulator.isModerator,
              presenceMs:
                accumulator.presenceMs +
                (accumulator.presentSince !== null ? now - accumulator.presentSince : 0),
              talkMs:
                accumulator.talkMs +
                (accumulator.speakingSince !== null ? now - accumulator.speakingSince : 0),
              talkTurns: accumulator.talkTurns,
              chatMessages: accumulator.chatMessages,
              reactions: accumulator.reactions,
              handRaises: accumulator.handRaises,
              connections: accumulator.connections,
              present: accumulator.presentSince !== null,
              micOn: live?.isMicrophoneEnabled ?? false,
              cameraOn: live?.isCameraEnabled ?? false,
            };
          })
          .sort((a, b) => b.talkMs - a.talkMs || a.name.localeCompare(b.name));
      },
    }),
    [room]
  );

  return createElement(EngagementContext.Provider, { value }, children);
}

/**
 * Instantané rafraîchi une fois par seconde tant que `active` est vrai. Le
 * composant appelant est le seul à se redessiner.
 */
export function useEngagementSnapshot(active: boolean): ParticipantEngagement[] {
  const context = useContext(EngagementContext);
  const [snapshot, setSnapshot] = useState<ParticipantEngagement[]>([]);

  useEffect(() => {
    if (!active || !context) return;
    setSnapshot(context.getSnapshot());
    const interval = setInterval(() => setSnapshot(context.getSnapshot()), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active, context]);

  return snapshot;
}

// Exporté pour l'affichage ET les exports : un même formatage partout évite
// qu'un CSV et le tableau à l'écran ne racontent pas la même chose.
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
