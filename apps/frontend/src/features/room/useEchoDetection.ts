import { useEffect, useRef, useState } from "react";
import { useLocalParticipant, useParticipants } from "@livekit/components-react";

// Échantillonnage de l'activité vocale. 500 ms : assez fin pour distinguer un
// vrai échange (alternance) d'un écho (superposition permanente), assez large
// pour ne pas peser sur le rendu.
const SAMPLE_INTERVAL_MS = 500;
// Fenêtre glissante de 20 s (40 échantillons) — un écho s'installe et dure,
// contrairement à un simple chevauchement de politesse en début de phrase.
const WINDOW_SAMPLES = 40;
// Il faut au moins 8 s de superposition cumulée dans la fenêtre pour alerter.
const MIN_OVERLAP_SAMPLES = 16;
// ...et la parole locale doit être très majoritairement simultanée à celle d'un
// autre : un participant qui parle aussi de son côté (vraie discussion) produit
// beaucoup d'échantillons "moi seul", un micro qui réémet le son des
// haut-parleurs voisins n'en produit quasiment aucun.
const OVERLAP_DOMINANCE_RATIO = 3;

/**
 * Détecte un écho acoustique probable : le micro local capte le son sortant des
 * haut-parleurs d'un appareil voisin (deux appareils dans la même pièce), ce que
 * l'annulation d'écho du navigateur ne PEUT PAS corriger — elle ne connaît que
 * le signal joué par son propre haut-parleur, jamais celui du voisin.
 *
 * Signal utilisé : la superposition durable entre "je parle" et "quelqu'un
 * d'autre parle". En cours magistral, un étudiant ne parle quasiment jamais en
 * même temps que l'enseignant pendant 8 s cumulées ; en revanche un micro qui
 * réémet les haut-parleurs d'à côté est détecté "parlant" exactement quand
 * l'autre parle. Faux positif possible (vraie discussion croisée animée), d'où
 * une simple suggestion refermable, jamais une action automatique.
 */
export function useEchoDetection(enabled: boolean): boolean {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [echoLikely, setEchoLikely] = useState(false);

  // Historique lu/écrit dans l'intervalle : une ref évite de relancer le timer
  // (et donc de perdre la fenêtre) à chaque échantillon.
  const samplesRef = useRef<{ overlap: boolean; localOnly: boolean }[]>([]);
  // État de parole relu à chaque rendu, mais JAMAIS mis en dépendance de
  // l'effet : useParticipants() renvoie un nouveau tableau à chaque changement
  // de isSpeaking, donc en dépendance il détruirait et recréerait l'intervalle
  // en boucle — qui n'atteindrait jamais ses 500 ms et n'échantillonnerait rien.
  const speakingRef = useRef({ local: false, remote: false });
  speakingRef.current = {
    local: localParticipant.isSpeaking,
    remote: participants.some((p) => !p.isLocal && p.isSpeaking),
  };

  useEffect(() => {
    if (!enabled) {
      samplesRef.current = [];
      setEchoLikely(false);
      return;
    }

    const interval = setInterval(() => {
      const { local: localSpeaking, remote: remoteSpeaking } = speakingRef.current;

      samplesRef.current.push({
        overlap: localSpeaking && remoteSpeaking,
        localOnly: localSpeaking && !remoteSpeaking,
      });
      if (samplesRef.current.length > WINDOW_SAMPLES) samplesRef.current.shift();

      const overlap = samplesRef.current.filter((s) => s.overlap).length;
      const localOnly = samplesRef.current.filter((s) => s.localOnly).length;
      setEchoLikely(overlap >= MIN_OVERLAP_SAMPLES && overlap > localOnly * OVERLAP_DOMINANCE_RATIO);
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled]);

  return echoLikely;
}
