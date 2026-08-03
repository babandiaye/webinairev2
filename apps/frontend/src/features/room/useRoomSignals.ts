import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RoomEvent } from "livekit-client";
import type { Participant, RemoteParticipant } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import type { RoomDto, RoomLocksMetadata } from "@webinairev2/shared-types";
import { isModeratorMetadata } from "./participantMeta";
import { useRoomLocks } from "./useRoomLocks";

export const HAND_RAISE_TOPIC = "hand-raise";
export const REACTION_TOPIC = "reaction";

// Jeu volontairement court : au-delà d'une poignée, choisir devient plus long
// que ce que la réaction fait gagner, et la barre déborde sur mobile.
export const REACTIONS = ["👍", "👏", "❤️", "😂", "😮", "🎉"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

// Durée d'affichage d'une réaction flottante. DOIT rester alignée sur la durée
// de l'animation `reaction-rise` (styles.css) : plus courte, la réaction est
// retirée du DOM en pleine montée et disparaît d'un coup ; plus longue, un
// élément déjà invisible (animation `forwards`) traîne pour rien.
const REACTION_LIFETIME_MS = 3000;

/**
 * Messages du canal `hand-raise`.
 *
 * `raisedAgoMs` plutôt qu'un horodatage absolu : les horloges de deux postes
 * peuvent diverger de plusieurs minutes, ce qui suffirait à inverser l'ordre de
 * la file d'attente. Une DURÉE ÉCOULÉE est mesurée sur une seule horloge, donc
 * insensible à cet écart — le récepteur la reconvertit en repère local.
 */
type HandMessage =
  | { t: "set"; identity: string; name: string; raisedAgoMs: number | null }
  | { t: "sync" }
  | { t: "lower"; identity: string };

export type RaisedHand = { identity: string; name: string; raisedAt: number };

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/**
 * File des mains levées, ordonnée par ordre d'arrivée.
 *
 * Aucun stockage serveur : l'état vit dans les navigateurs. Le problème
 * classique de cette approche — celui qui rejoint après coup ne voit pas les
 * mains déjà levées — est réglé par un message `sync` émis à l'entrée, auquel
 * seuls les participants concernés répondent. Sans lui, un animateur arrivé en
 * retard (ou rafraîchissant sa page) trouvait la file vide alors que trois
 * étudiants attendaient depuis cinq minutes.
 */
function useHandRaiseState(localIdentity: string): {
  raisedHands: RaisedHand[];
  isRaised: boolean;
  toggle: () => void;
  lower: (identity: string) => void;
  lowerAll: () => void;
} {
  const room = useRoomContext();
  const [hands, setHands] = useState<Record<string, RaisedHand>>({});
  const [isRaised, setIsRaised] = useState(false);
  // Relu dans les gestionnaires d'évènement sans les faire dépendre de l'état :
  // se réabonner à chaque lever de main perdrait des messages entre-temps.
  const raisedAtRef = useRef<number | null>(null);

  const publish = useCallback(
    (payload: HandMessage) => {
      room.localParticipant
        .publishData(encode(payload), { reliable: true, topic: HAND_RAISE_TOPIC })
        .catch(() => {
          // Salle en cours de fermeture : une main levée perdue ne justifie pas
          // de faire remonter une erreur à l'utilisateur.
        });
    },
    [room]
  );

  useEffect(() => {
    function handleData(payload: Uint8Array, _participant?: RemoteParticipant, _kind?: unknown, topic?: string) {
      if (topic !== HAND_RAISE_TOPIC) return;

      let message: HandMessage;
      try {
        message = JSON.parse(new TextDecoder().decode(payload));
      } catch {
        return;
      }

      if (message.t === "sync") {
        // Seuls ceux dont la main est levée répondent : un amphi de 60 postes
        // ne doit pas produire 60 messages à chaque arrivée.
        if (raisedAtRef.current !== null) {
          publish({
            t: "set",
            identity: localIdentity,
            name: room.localParticipant.name || localIdentity,
            raisedAgoMs: Date.now() - raisedAtRef.current,
          });
        }
        return;
      }

      if (message.t === "lower") {
        if (message.identity !== localIdentity) return;
        // C'est le poste concerné qui annonce la baisse, jamais le modérateur à
        // sa place : l'état affiché reste ainsi toujours celui que son
        // propriétaire a confirmé.
        raisedAtRef.current = null;
        setIsRaised(false);
        publish({ t: "set", identity: localIdentity, name: "", raisedAgoMs: null });
        return;
      }

      if (message.t === "set") {
        setHands((prev) => {
          if (message.raisedAgoMs === null) {
            const { [message.identity]: _removed, ...rest } = prev;
            return rest;
          }
          return {
            ...prev,
            [message.identity]: {
              identity: message.identity,
              name: message.name,
              raisedAt: Date.now() - message.raisedAgoMs,
            },
          };
        });
      }
    }

    function handleLeft(participant: Participant) {
      setHands((prev) => {
        if (!(participant.identity in prev)) return prev;
        const { [participant.identity]: _removed, ...rest } = prev;
        return rest;
      });
    }

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.ParticipantDisconnected, handleLeft);
    // Demande d'état à l'entrée — voir le commentaire du hook.
    publish({ t: "sync" });

    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.ParticipantDisconnected, handleLeft);
    };
  }, [room, publish, localIdentity]);

  const toggle = useCallback(() => {
    const next = raisedAtRef.current === null;
    raisedAtRef.current = next ? Date.now() : null;
    setIsRaised(next);
    publish({
      t: "set",
      identity: localIdentity,
      name: room.localParticipant.name || localIdentity,
      raisedAgoMs: next ? 0 : null,
    });
  }, [publish, localIdentity, room]);

  const lower = useCallback(
    (identity: string) => {
      // Retrait local immédiat : le modérateur ne doit pas attendre l'aller-retour
      // pour voir la file avancer. Le poste concerné confirmera par son propre
      // message `set`, qui n'apportera alors plus rien de nouveau.
      setHands((prev) => {
        const { [identity]: _removed, ...rest } = prev;
        return rest;
      });
      if (identity === localIdentity) {
        raisedAtRef.current = null;
        setIsRaised(false);
        publish({ t: "set", identity, name: "", raisedAgoMs: null });
        return;
      }
      publish({ t: "lower", identity });
    },
    [publish, localIdentity]
  );

  const lowerAll = useCallback(() => {
    const identities = Object.keys(hands);
    setHands({});
    for (const identity of identities) {
      if (identity === localIdentity) {
        raisedAtRef.current = null;
        setIsRaised(false);
        publish({ t: "set", identity, name: "", raisedAgoMs: null });
      } else {
        publish({ t: "lower", identity });
      }
    }
  }, [hands, publish, localIdentity]);

  const raisedHands = Object.values(hands).sort((a, b) => a.raisedAt - b.raisedAt);
  return { raisedHands, isRaised, toggle, lower, lowerAll };
}

export type FloatingReaction = {
  id: string;
  name: string;
  emoji: string;
  /**
   * Position horizontale de départ, en % de la largeur de la scène (20 à 80).
   *
   * Tirée au sort à la réception, pas au rendu : recalculée à chaque rendu, la
   * réaction se téléporterait latéralement en pleine montée. Bornée à 20-80
   * pour ne pas naître sous le rail latéral ni sous la barre de participants
   * (même choix que livestreamv3).
   */
  x: number;
};

type ReactionMessage = { name: string; emoji: string };

/**
 * Réactions éphémères, façon Meet/Zoom : elles traversent l'écran puis
 * disparaissent. Rien n'est conservé — le tableau d'engagement en tient le
 * compte pour la durée de la séance (voir useEngagementStats).
 */
function useReactionsState(reactionsLocked: boolean): {
  reactions: FloatingReaction[];
  send: (emoji: ReactionEmoji) => void;
} {
  const room = useRoomContext();
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Relu dans le gestionnaire sans le faire dépendre de la valeur : un
  // changement de verrou ne doit pas réabonner l'écoute en plein flux.
  const lockedRef = useRef(reactionsLocked);
  lockedRef.current = reactionsLocked;

  const push = useCallback((name: string, emoji: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setReactions((prev) => [...prev, { id, name, emoji, x: 20 + Math.random() * 60 }]);
    const timeout = setTimeout(() => {
      setReactions((prev) => prev.filter((r) => r.id !== id));
    }, REACTION_LIFETIME_MS);
    timeoutsRef.current.push(timeout);
  }, []);

  useEffect(() => {
    function handleData(payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) {
      if (topic !== REACTION_TOPIC) return;
      // Application du verrou À LA RÉCEPTION, en plus du masquage du bouton chez
      // l'émetteur : le SFU ne sait pas filtrer un canal de données par sujet, la
      // seule barrière possible est donc que chaque destinataire ignore ce qui ne
      // devrait pas circuler. Contourner suppose alors de modifier le navigateur
      // de TOUS les destinataires, pas seulement le sien.
      if (lockedRef.current && !isModeratorMetadata(participant?.metadata)) return;
      try {
        const message: ReactionMessage = JSON.parse(new TextDecoder().decode(payload));
        if (message.emoji) push(message.name, message.emoji);
      } catch {
        // message malformé ignoré
      }
    }

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, push]);

  // Purge à la sortie : sans ça, un changement de salle (principale <-> sous-
  // groupe) laisserait des minuteurs écrire dans un composant démonté.
  useEffect(() => {
    const timeouts = timeoutsRef;
    return () => {
      timeouts.current.forEach(clearTimeout);
      timeouts.current = [];
    };
  }, []);

  const send = useCallback(
    (emoji: ReactionEmoji) => {
      const name = room.localParticipant.name || room.localParticipant.identity;
      // publishData n'est pas ré-émis vers l'expéditeur : sans cet affichage
      // local, on ne verrait jamais sa propre réaction.
      push(name, emoji);
      room.localParticipant
        .publishData(encode({ name, emoji } satisfies ReactionMessage), {
          reliable: false,
          topic: REACTION_TOPIC,
        })
        .catch(() => {
          // Perte sans conséquence : une réaction est par nature éphémère, et
          // le canal non fiable est choisi pour cette raison.
        });
    },
    [room, push]
  );

  return { reactions, send };
}

type RoomSignals = {
  raisedHands: RaisedHand[];
  isRaised: boolean;
  toggleHand: () => void;
  lowerHand: (identity: string) => void;
  lowerAllHands: () => void;
  reactions: FloatingReaction[];
  sendReaction: (emoji: ReactionEmoji) => void;
  locks: RoomLocksMetadata;
};

const RoomSignalsContext = createContext<RoomSignals | null>(null);

/**
 * Instance UNIQUE des signaux de salle, partagée par la barre de contrôle, la
 * liste des participants et la scène.
 *
 * Indispensable et pas seulement économe : `publishData` n'est pas ré-émis vers
 * son expéditeur. Avec une instance par composant, celui qui lève la main la
 * verrait dans sa barre de contrôle mais pas dans sa propre liste de
 * participants — deux vues du même état, contradictoires.
 *
 * Le fournisseur se redessine à chaque main levée ou réaction, mais `children`
 * lui étant transmis en propriété, React n'en refait pas le rendu : seuls les
 * composants qui appellent useRoomSignals() sont concernés.
 */
export function RoomSignalsProvider({
  localIdentity,
  room,
  children,
}: {
  localIdentity: string;
  room: RoomDto;
  children: React.ReactNode;
}) {
  // Les verrous vivent ici plutôt que dans chaque composant : une seule écoute
  // des métadonnées de salle, et pas de RoomDto à faire descendre jusqu'au chat.
  const locks = useRoomLocks(room);
  const { raisedHands, isRaised, toggle, lower, lowerAll } = useHandRaiseState(localIdentity);
  const { reactions, send } = useReactionsState(locks.reactionsLocked);

  const value = useMemo<RoomSignals>(
    () => ({
      raisedHands,
      isRaised,
      toggleHand: toggle,
      lowerHand: lower,
      lowerAllHands: lowerAll,
      reactions,
      sendReaction: send,
      locks,
    }),
    [raisedHands, isRaised, toggle, lower, lowerAll, reactions, send, locks]
  );

  return createElement(RoomSignalsContext.Provider, { value }, children);
}

export function useRoomSignals(): RoomSignals {
  const context = useContext(RoomSignalsContext);
  if (!context) {
    throw new Error("useRoomSignals doit être utilisé dans <RoomSignalsProvider>");
  }
  return context;
}
