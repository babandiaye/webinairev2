import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  Headphones,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { RoomDto } from "@webinairev2/shared-types";

export type DeviceSelection = {
  audioinput?: string;
  videoinput?: string;
  audiooutput?: string;
};

// Choix retenus par appareil : celui qui branche toujours le même casque ne
// devrait pas avoir à le resélectionner à chaque cours.
const STORAGE_PREFIX = "webinairev2.device.";
// Assez long pour prononcer une phrase entière — en dessous, on teste surtout
// son propre réflexe, pas la chaîne audio.
const ECHO_TEST_DURATION_MS = 5000;
const TEST_TONE_HZ = 440;
const TEST_TONE_MS = 1200;

function loadStoredDevices(): DeviceSelection {
  const read = (kind: string) => localStorage.getItem(STORAGE_PREFIX + kind) ?? undefined;
  return {
    audioinput: read("audioinput"),
    videoinput: read("videoinput"),
    audiooutput: read("audiooutput"),
  };
}

type EchoState = "idle" | "recording" | "playing" | "verdict";

function DeviceSelect({
  kind,
  label,
  icon,
  devices,
  value,
  disabled,
  onChange,
}: {
  kind: MediaDeviceKind;
  label: string;
  icon: React.ReactNode;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  disabled?: boolean;
  onChange: (deviceId: string) => void;
}) {
  const list = devices.filter((d) => d.kind === kind);
  if (list.length === 0) return null;

  return (
    <label className="prejoin-field">
      <span className="prejoin-field-label">
        {icon}
        {label}
      </span>
      <select
        className="prejoin-select"
        value={value ?? list[0]?.deviceId ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {list.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Écran de vérification affiché AVANT d'entrer dans la salle : choix des
 * périphériques, aperçu caméra, niveau du micro et test d'écho.
 *
 * Pourquoi avant et pas dans les Paramètres (qui existent déjà) : une fois en
 * cours, découvrir que son micro capte le haut-parleur du voisin coûte
 * l'attention de toute la classe. BigBlueButton impose ce test à l'entrée pour
 * cette raison précise, et c'est le prolongement naturel de la détection d'écho
 * en séance (voir useEchoDetection) — corriger en amont vaut mieux que
 * diagnostiquer en direct.
 */
export function PreJoinScreen({
  room,
  canManage,
  onJoin,
}: {
  room: RoomDto;
  canManage: boolean;
  onJoin: (selection: DeviceSelection) => void;
}) {
  // Un participant démarre sans droit de publication (voir livekit-token.service.ts) :
  // lui demander sa caméra ici ne ferait qu'afficher une invite navigateur pour
  // un périphérique qu'il ne pourra pas publier. Le test de SORTIE, lui, reste
  // utile pour tout le monde — c'est même le seul qui compte pour un auditeur.
  const canUseMic = canManage || !room.micLocked;
  const canUseCamera = canManage || !room.cameraLocked;

  const [selection, setSelection] = useState<DeviceSelection>(loadStoredDevices);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permission, setPermission] = useState<"pending" | "granted" | "denied" | "skipped">(
    "pending"
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [echoState, setEchoState] = useState<EchoState>("idle");
  const [echoResult, setEchoResult] = useState<"ok" | "ko" | null>(null);
  const [tonePlaying, setTonePlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  // Le niveau du micro est écrit directement dans le style du DOM plutôt que
  // dans un état React : à 60 images/seconde, un setState provoquerait un rendu
  // complet de l'écran à chaque trame pour animer une simple barre.
  const meterRef = useRef<HTMLDivElement>(null);

  const pick = useCallback((kind: keyof DeviceSelection, deviceId: string) => {
    localStorage.setItem(STORAGE_PREFIX + kind, deviceId);
    setSelection((prev) => ({ ...prev, [kind]: deviceId }));
    // Le test précédent portait sur l'ancien périphérique : le garder affiché
    // laisserait croire que la nouvelle configuration a été vérifiée.
    setEchoResult(null);
  }, []);

  // Acquisition de l'aperçu. Réexécuté à chaque changement de micro/caméra —
  // l'ancien flux est arrêté par le nettoyage, sans quoi la caméra resterait
  // allumée (voyant compris) pour chaque périphérique essayé.
  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;

    function acquire(useStored: boolean) {
      return navigator.mediaDevices.getUserMedia({
        audio: canUseMic
          ? {
              ...(useStored && selection.audioinput
                ? { deviceId: { exact: selection.audioinput } }
                : {}),
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : false,
        video: canUseCamera
          ? useStored && selection.videoinput
            ? { deviceId: { exact: selection.videoinput } }
            : true
          : false,
      });
    }

    async function setup() {
      if (!canUseMic && !canUseCamera) {
        setPermission("skipped");
        return;
      }

      const hasStored = Boolean(selection.audioinput || selection.videoinput);
      try {
        acquired = await acquire(true);
      } catch {
        // Un périphérique mémorisé au cours précédent peut avoir été débranché
        // depuis : `deviceId: exact` échoue alors, et sans ce repli l'écran
        // annoncerait "accès refusé" — accusant le navigateur d'un refus qui
        // n'a jamais eu lieu — alors que le micro intégré répond parfaitement.
        if (cancelled) return;
        if (!hasStored) {
          setPermission("denied");
          return;
        }
        try {
          acquired = await acquire(false);
        } catch {
          if (!cancelled) setPermission("denied");
          return;
        }
        if (cancelled) {
          acquired.getTracks().forEach((t) => t.stop());
          return;
        }
        // On réaligne la sélection sur ce qui a RÉELLEMENT été ouvert : sans ça
        // les listes déroulantes resteraient sur un identifiant fantôme, et le
        // prochain cours rejouerait le même échec.
        const actual: DeviceSelection = {};
        for (const track of acquired.getTracks()) {
          const kind = track.kind === "audio" ? "audioinput" : "videoinput";
          const deviceId = track.getSettings().deviceId;
          if (deviceId) {
            actual[kind] = deviceId;
            localStorage.setItem(STORAGE_PREFIX + kind, deviceId);
          }
        }
        setSelection((prev) => ({ ...prev, ...actual }));
      }

      if (cancelled) {
        acquired?.getTracks().forEach((t) => t.stop());
        return;
      }
      setStream(acquired);
      setPermission("granted");
    }

    setup();
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
    };
  }, [canUseMic, canUseCamera, selection.audioinput, selection.videoinput]);

  // Les libellés des périphériques ne sont renseignés qu'une fois la permission
  // accordée — énumérer avant ne donnerait qu'une liste d'entrées anonymes.
  useEffect(() => {
    if (permission === "pending") return;
    const refresh = () => navigator.mediaDevices.enumerateDevices().then(setDevices).catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [permission]);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  // Vumètre : sans retour visuel, un micro muet par le matériel (interrupteur du
  // casque, entrée coupée par l'OS) est indiscernable d'un micro qui marche.
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track) return;

    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;

    function tick() {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      if (meterRef.current) {
        meterRef.current.style.width = `${Math.min(100, Math.round(peak * 140))}%`;
      }
      frame = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      ctx.close().catch(() => {});
    };
  }, [stream]);

  // Dirige un élément audio vers le haut-parleur choisi. setSinkId n'existe pas
  // partout (Firefox ne l'expose que derrière une préférence, Safari pas du
  // tout) : l'échec est sans gravité, le son sort alors sur la sortie par défaut.
  async function routeToSelectedOutput(el: HTMLAudioElement) {
    const sinkable = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (selection.audiooutput && typeof sinkable.setSinkId === "function") {
      await sinkable.setSinkId(selection.audiooutput).catch(() => {});
    }
  }

  // Test de SORTIE seule : le seul disponible pour un participant dont le micro
  // est verrouillé, et pourtant le plus important pour lui — il vient écouter.
  async function playTestTone() {
    setTonePlaying(true);
    const ctx = new AudioContext();
    try {
      const destination = ctx.createMediaStreamDestination();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = TEST_TONE_HZ;
      // Rampes courtes aux deux extrémités : un signal carré brutal produit un
      // "clac" désagréable dans un casque.
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + TEST_TONE_MS / 1000);
      oscillator.connect(gain).connect(destination);

      const el = new Audio();
      el.srcObject = destination.stream;
      await routeToSelectedOutput(el);
      await el.play();
      oscillator.start();

      await new Promise((resolve) => setTimeout(resolve, TEST_TONE_MS));
      oscillator.stop();
      el.pause();
    } catch {
      // Lecture refusée (politique d'autoplay) : rien à signaler, l'utilisateur
      // vient de cliquer, il réessaiera.
    } finally {
      await ctx.close().catch(() => {});
      setTonePlaying(false);
    }
  }

  // Test d'écho : on enregistre quelques secondes puis on les rejoue. Se
  // réentendre prouve d'un coup toute la chaîne — micro capté, périphérique
  // attendu, sortie audible — là où un vumètre ne valide que l'entrée.
  function runEchoTest() {
    const track = stream?.getAudioTracks()[0];
    if (!track || typeof MediaRecorder === "undefined") return;

    setEchoResult(null);
    setEchoState("recording");

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(new MediaStream([track]));
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      const el = new Audio(url);
      el.onended = () => {
        URL.revokeObjectURL(url);
        setEchoState("verdict");
      };
      await routeToSelectedOutput(el);
      setEchoState("playing");
      await el.play().catch(() => {
        URL.revokeObjectURL(url);
        setEchoState("verdict");
      });
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, ECHO_TEST_DURATION_MS);
  }

  function handleJoin() {
    stream?.getTracks().forEach((t) => t.stop());
    onJoin(selection);
  }

  const echoTestAvailable =
    permission === "granted" && canUseMic && typeof MediaRecorder !== "undefined";

  return (
    <div className="prejoin-screen">
      <div className="prejoin-card">
        <div className="prejoin-header">
          <h2>{room.title}</h2>
          <p>Vérifiez votre matériel avant d'entrer</p>
        </div>

        <div className="prejoin-body">
          <div className="prejoin-preview">
            {stream && canUseCamera ? (
              <video ref={videoRef} autoPlay playsInline muted className="prejoin-video" />
            ) : (
              <div className="prejoin-preview-empty">
                <VideoOff size={34} />
                <span>
                  {permission === "denied"
                    ? "Accès aux périphériques refusé"
                    : canUseCamera
                      ? "Caméra en cours d'ouverture…"
                      : "Caméra verrouillée par l'animateur"}
                </span>
              </div>
            )}

            {canUseMic && permission === "granted" && (
              <div className="prejoin-meter" title="Niveau de votre micro">
                <Mic size={14} />
                <div className="prejoin-meter-track">
                  <div ref={meterRef} className="prejoin-meter-fill" />
                </div>
              </div>
            )}
          </div>

          <div className="prejoin-controls">
            {permission === "denied" && (
              <div className="prejoin-alert">
                <AlertTriangle size={16} />
                <span>
                  Le navigateur a refusé l'accès au micro et à la caméra. Autorisez-les dans la barre
                  d'adresse, puis rechargez la page.
                </span>
              </div>
            )}

            {canUseCamera && (
              <DeviceSelect
                kind="videoinput"
                label="Caméra"
                icon={<Camera size={14} />}
                devices={devices}
                value={selection.videoinput}
                onChange={(id) => pick("videoinput", id)}
              />
            )}

            {canUseMic ? (
              <DeviceSelect
                kind="audioinput"
                label="Microphone"
                icon={<Mic size={14} />}
                devices={devices}
                value={selection.audioinput}
                onChange={(id) => pick("audioinput", id)}
              />
            ) : (
              <div className="prejoin-locked">
                <MicOff size={14} />
                Micro verrouillé par l'animateur — il pourra vous donner la parole en séance.
              </div>
            )}

            <DeviceSelect
              kind="audiooutput"
              label="Haut-parleur"
              icon={<Volume2 size={14} />}
              devices={devices}
              value={selection.audiooutput}
              onChange={(id) => pick("audiooutput", id)}
            />

            <div className="prejoin-tests">
              <button className="btn btn-ghost" onClick={playTestTone} disabled={tonePlaying}>
                <Play size={14} />
                {tonePlaying ? "Lecture…" : "Tester le son"}
              </button>

              {echoTestAvailable && (
                <button
                  className="btn btn-ghost"
                  onClick={runEchoTest}
                  disabled={echoState === "recording" || echoState === "playing"}
                >
                  <RefreshCw size={14} />
                  {echoState === "recording"
                    ? "Parlez…"
                    : echoState === "playing"
                      ? "Réécoute…"
                      : "Test d'écho"}
                </button>
              )}
            </div>

            {echoState === "recording" && (
              <p className="prejoin-hint">
                Dites quelques mots, ils vous seront rejoués dans {ECHO_TEST_DURATION_MS / 1000}{" "}
                secondes.
              </p>
            )}

            {echoState === "verdict" && echoResult === null && (
              <div className="prejoin-verdict">
                <span>Vous êtes-vous entendu clairement ?</span>
                <div className="prejoin-verdict-actions">
                  <button className="btn btn-primary" onClick={() => setEchoResult("ok")}>
                    <Check size={14} />
                    Oui
                  </button>
                  <button className="btn btn-ghost" onClick={() => setEchoResult("ko")}>
                    Non
                  </button>
                </div>
              </div>
            )}

            {echoResult === "ok" && (
              <div className="prejoin-alert prejoin-alert-ok">
                <Check size={16} />
                <span>Votre matériel est prêt.</span>
              </div>
            )}

            {echoResult === "ko" && (
              <div className="prejoin-alert">
                <Headphones size={16} />
                <span>
                  Essayez un autre microphone ou haut-parleur ci-dessus, puis relancez le test. Si
                  d'autres appareils sont dans la même pièce que vous, un casque reste la seule
                  solution fiable contre l'écho.
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="prejoin-footer">
          <button className="btn btn-primary prejoin-join" onClick={handleJoin}>
            <Video size={16} />
            Rejoindre la session
          </button>
        </div>
      </div>
    </div>
  );
}
