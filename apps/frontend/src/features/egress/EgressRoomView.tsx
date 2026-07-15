import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";
import { EgressJoinDto } from "@webinairev2/shared-types";
import { egressApi } from "../../api/egressApi";
import { CallStage } from "../room/CallStage";
import { EgressWhiteboardView } from "./EgressWhiteboardView";
import { EgressPresentationView } from "./EgressPresentationView";

// Page chargée par le Chrome headless de LiveKit Web Egress (voir
// RecordingsService.start()) — jamais par un vrai utilisateur. Rendu minimal :
// grille vidéo + contenu partagé (tableau blanc/présentation), sans topbar,
// sidebar ni aucun contrôle, exactement ce que l'enregistrement doit capturer.
export function EgressRoomView() {
  const { id } = useParams<{ id: string }>();
  // Le token voyage dans le FRAGMENT (#token=…), pas en query string : le
  // fragment n'est jamais envoyé au serveur, donc n'apparaît pas dans les logs
  // d'accès nginx pour cette requête initiale — voir RecordingsService.start().
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [connection, setConnection] = useState<EgressJoinDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    egressApi
      .join(id, token)
      .then(setConnection)
      .catch((e) => setError(e instanceof Error ? e.message : "Erreur inconnue"));
  }, [id, token]);

  if (error) return <div style={{ color: "#fff", padding: 20 }}>{error}</div>;
  if (!connection || !id) return <div style={{ background: "#111319", width: "100vw", height: "100vh" }} />;

  return (
    <LiveKitRoom
      className="room-page"
      data-lk-theme="default"
      style={{ height: "100vh" }}
      serverUrl={connection.livekitUrl}
      token={connection.token}
      connect
      video={false}
      audio={false}
      // Signal attendu par LiveKit Egress (awaitStartSignal: true côté serveur) :
      // sans lui, l'enregistrement démarrerait avant que la salle ait fini de se
      // connecter/rendre, capturant un écran vide en début de vidéo.
      onConnected={() => console.log("START_RECORDING")}
    >
      <div className="call-stage-wrapper" style={{ height: "100vh" }}>
        <CallStage />
        <EgressWhiteboardView roomId={id} token={token} />
        <EgressPresentationView roomId={id} token={token} />
      </div>
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
