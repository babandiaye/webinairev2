import { useEffect, useRef } from "react";
import { Track } from "livekit-client";
import type { RemoteTrackPublication } from "livekit-client";
import { useIsMuted, useLocalParticipant, useTracks, VideoTrack } from "@livekit/components-react";
import type { TrackReference } from "@livekit/components-react";
import { Video, VideoOff } from "lucide-react";
import type { Role } from "@webinairev2/shared-types";
import { isModeratorMetadata } from "./participantMeta";

function participantLabel(track: TrackReference): string {
  return track.participant.name || track.participant.identity;
}

// useTracks (onlySubscribed, par défaut) garantit que publication.track existe,
// mais pas qu'il produise une image : une caméra coupée côté émetteur reste
// "abonnée" côté LiveKit, juste avec une piste vide (rendu : cadre noir). Le
// composant ParticipantTile de la lib gère ça nativement en basculant sur un
// avatar dès que la piste est muted ; comme on ne l'utilise plus (cf. commentaire
// plus bas, modèle non-grille), il faut reproduire ce garde-fou nous-mêmes, sous
// peine d'un <video> monté mais purement noir — exactement le symptôme observé.
function StageVideo({ trackRef, compact }: { trackRef: TrackReference; compact?: boolean }) {
  const isMuted = useIsMuted(trackRef);

  if (isMuted) {
    return (
      <div className={compact ? "call-stage-secondary-off" : "call-stage-waiting"}>
        <VideoOff size={compact ? 20 : 40} />
        {!compact && <p>{participantLabel(trackRef)} — caméra coupée</p>}
      </div>
    );
  }

  return (
    <>
      <VideoTrack trackRef={trackRef} className="call-stage-video" />
      <div className="call-stage-name-tag">{participantLabel(trackRef)}</div>
    </>
  );
}

// Volontairement PAS de grille façon Zoom/Meet (une vignette par participant) :
// une salle peut compter jusqu'à ~1000 participants, et seuls le modérateur et
// les quelques personnes ayant reçu le droit de parole/présentation publient
// jamais une caméra ou un partage d'écran (voir setSpeakerPermission/
// setPresenterPermission côté RoomsService) — les afficher tous exploserait le
// rendu pour rien, puisque l'immense majorité des participants n'a aucune piste
// à montrer. Modèle repris de livestreamv3 : une seule vidéo principale (partage
// d'écran en priorité, sinon la caméra du modérateur) + une petite bande de
// vignettes secondaires pour les autres orateurs actifs.
//
// canManage=true par défaut : couvre l'appel sans prop de la vue Egress
// (EgressRoomView), qui doit toujours capturer la grille complète pour
// l'enregistrement — jamais soumise à la logique d'économie de bande passante
// ci-dessous puisqu'elle ne compte qu'un seul abonné (le recorder headless).
export function CallStage({ canManage = true }: { canManage?: boolean }) {
  const { localParticipant } = useLocalParticipant();
  // onlySubscribed:false pour un spectateur : autoSubscribe est désactivé côté
  // connexion (voir RoomPage.tsx), donc les pistes publiées n'apparaissent pas
  // encore comme "abonnées" — il faut néanmoins pouvoir les lister pour décider
  // laquelle est la piste principale, avant même de s'y abonner.
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false });

  const screenTrack = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const camTracks = tracks.filter((t) => t.source === Track.Source.Camera);
  const mainCamTrack =
    camTracks.find((t) => isModeratorMetadata(t.participant.metadata)) ?? camTracks[0];
  const secondaryCamTracks = camTracks.filter(
    (t) => t.participant.identity !== mainCamTrack?.participant.identity
  );

  const mainTrack = screenTrack ?? mainCamTrack;

  // Abonnement manuel pour un spectateur (canManage=false) : ne s'abonne
  // JAMAIS aux pistes secondaires, et uniquement à la piste principale
  // courante — se désabonne de l'ancienne dès qu'elle change (bascule
  // modérateur ↔ partage d'écran, changement d'orateur…). Sur une salle à
  // grande échelle, chaque piste abonnée en plus coûte sa bande passante
  // ×(nombre de spectateurs) ; voir RoomPage.tsx pour le contexte complet.
  const subscribedPubRef = useRef<RemoteTrackPublication | null>(null);
  useEffect(() => {
    if (canManage) return;
    // Un spectateur ne publie jamais (canPublish=false par défaut), donc la
    // piste principale ne devrait jamais être la sienne — ce garde-fou
    // protège quand même setSubscribed(), absent de LocalTrackPublication.
    const nextPub =
      mainTrack && !mainTrack.participant.isLocal
        ? (mainTrack.publication as RemoteTrackPublication)
        : null;
    if (subscribedPubRef.current === nextPub) return;
    subscribedPubRef.current?.setSubscribed(false);
    nextPub?.setSubscribed(true);
    subscribedPubRef.current = nextPub;
  }, [canManage, mainTrack]);

  // Même mécanique pour l'AUDIO, oubliée jusqu'ici : autoSubscribe:false
  // désactive aussi l'abonnement automatique au micro, pas seulement à la
  // caméra — sans ce bloc, un spectateur n'entend jamais personne, modérateur
  // compris (RoomAudioRenderer, monté dans RoomPage.tsx, ne lit que ce qui est
  // effectivement abonné). Contrairement à la vidéo, on s'abonne à TOUTES les
  // pistes micro publiées, pas seulement une "principale" : plusieurs
  // personnes peuvent avoir la parole en même temps (voir
  // setSpeakerPermission), et un flux audio coûte quelques dizaines de kbps —
  // rien à voir avec le coût d'une piste vidéo en plus.
  // ScreenShareAudio inclus : setPresenterPermission accorde SCREEN_SHARE_AUDIO
  // en même temps que SCREEN_SHARE côté serveur. L'app ne capture pas encore
  // cette piste (le toggle de partage d'écran ne passe pas captureOptions.audio,
  // et livekit-client met audio:false par défaut), mais l'omettre ici serait
  // exactement la même faille que le micro : silencieuse jusqu'au jour où
  // quelqu'un active la capture audio de l'écran.
  const audioTracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], {
    onlySubscribed: false,
  });
  const subscribedAudioRef = useRef<Set<RemoteTrackPublication>>(new Set());
  useEffect(() => {
    if (canManage) return;
    const nextPubs = new Set(
      audioTracks.filter((t) => !t.participant.isLocal).map((t) => t.publication as RemoteTrackPublication)
    );
    for (const pub of subscribedAudioRef.current) {
      if (!nextPubs.has(pub)) pub.setSubscribed(false);
    }
    for (const pub of nextPubs) {
      if (!subscribedAudioRef.current.has(pub)) pub.setSubscribed(true);
    }
    subscribedAudioRef.current = nextPubs;
  }, [canManage, audioTracks]);

  const localRole: Role | undefined = (() => {
    try {
      return localParticipant.metadata ? JSON.parse(localParticipant.metadata).role : undefined;
    } catch {
      return undefined;
    }
  })();

  return (
    <div className="call-stage">
      <div className="call-stage-main">
        {mainTrack ? (
          <StageVideo trackRef={mainTrack} />
        ) : (
          <div className="call-stage-waiting">
            <Video size={40} />
            <p>En attente du modérateur…</p>
            {localRole === "VIEWER" && <span>La session commencera dès l'activation de sa caméra.</span>}
          </div>
        )}
      </div>

      {/* Un spectateur ne s'abonne jamais à ces pistes (voir plus haut) : les
          afficher pour lui n'aurait de toute façon aucune image à montrer. */}
      {canManage && secondaryCamTracks.length > 0 && (
        <div className="call-stage-secondary">
          {secondaryCamTracks.map((t) => (
            <div className="call-stage-secondary-tile" key={t.participant.identity}>
              <StageVideo trackRef={t} compact />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
