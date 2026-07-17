import { RecordingStatus } from "@prisma/client";

// Fichier séparé (plutôt que défini dans recordings.service.ts) pour que
// RecordingsService et EgressReconciliationService puissent tous les deux
// l'importer sans dépendance circulaire entre les deux fichiers de service —
// RecordingsService.list() a besoin d'injecter EgressReconciliationService
// (réconciliation à la lecture) tout en restant lu par elle.
//
// Un enregistrement traverse STARTING (requête envoyée à LiveKit, egress pas
// encore confirmé actif) -> ACTIVE (confirmé par webhook egress_active) ->
// ENDING (arrêt demandé, fichier en cours de finalisation/upload) -> READY.
// Ces 3 états comptent comme "en cours" pour bloquer un double démarrage,
// autoriser l'arrêt, ou empêcher la suppression.
export const RECORDING_IN_PROGRESS_STATUSES: RecordingStatus[] = [
  RecordingStatus.STARTING,
  RecordingStatus.ACTIVE,
  RecordingStatus.ENDING,
];
