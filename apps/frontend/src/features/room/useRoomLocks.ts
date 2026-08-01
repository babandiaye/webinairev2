import { useEffect, useState } from "react";
import { RoomEvent } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import type { RoomDto, RoomLocksMetadata } from "@webinairev2/shared-types";

const UNLOCKED: RoomLocksMetadata = {
  chatLocked: false,
  reactionsLocked: false,
  participantListLocked: false,
};

function parse(metadata: string | undefined): RoomLocksMetadata | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return {
      chatLocked: parsed?.chatLocked === true,
      reactionsLocked: parsed?.reactionsLocked === true,
      participantListLocked: parsed?.participantListLocked === true,
    };
  } catch {
    return null;
  }
}

/**
 * Verrous d'interaction en vigueur, tenus à jour en direct.
 *
 * Source de vérité : les métadonnées de la salle LiveKit, poussées par
 * RoomsService.syncRoomMetadata et rediffusées à tout le monde à chaque
 * changement — un participant ne rappelle jamais l'API après son entrée, un
 * champ du RoomDto ne l'atteindrait donc plus.
 *
 * Le RoomDto sert de valeur initiale le temps que les métadonnées arrivent (et
 * de repli si la salle LiveKit n'en a pas encore reçu). Sans lui, un chat
 * verrouillé s'afficherait ouvert pendant la fraction de seconde suivant
 * l'entrée — assez pour laisser passer un message.
 */
export function useRoomLocks(room: RoomDto): RoomLocksMetadata {
  const livekitRoom = useRoomContext();
  const [locks, setLocks] = useState<RoomLocksMetadata | null>(() => parse(livekitRoom.metadata));

  useEffect(() => {
    function handleChanged(metadata: string | undefined) {
      setLocks(parse(metadata));
    }
    setLocks(parse(livekitRoom.metadata));
    livekitRoom.on(RoomEvent.RoomMetadataChanged, handleChanged);
    return () => {
      livekitRoom.off(RoomEvent.RoomMetadataChanged, handleChanged);
    };
  }, [livekitRoom]);

  return (
    locks ?? {
      chatLocked: room.chatLocked ?? UNLOCKED.chatLocked,
      reactionsLocked: room.reactionsLocked ?? UNLOCKED.reactionsLocked,
      participantListLocked: room.participantListLocked ?? UNLOCKED.participantListLocked,
    }
  );
}
