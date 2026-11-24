/** English source and French copy shared by file controls and worker diagnostics. */
const rows: readonly (readonly [string, string])[] = [
  ['Save map', 'Enregistrer la carte'],
  ['Save map · .muproj', 'Enregistrer la carte · .muproj'],
  ['Export complete project (JSON)', 'Exporter le projet complet (JSON)'],
  ['Binary .muproj, complete JSON, or seeds + settings. Projects retain the elevation grids.', 'Fichier binaire .muproj, JSON complet ou graines + réglages. Les projets conservent les grilles d’altitude.'],
  ['The binary project retains the exact map, settings and edits in a compressed file.', 'Le projet binaire conserve la carte exacte, les réglages et les modifications dans un fichier compressé.'],
  ['The JSON project is a readable interchange format. Use Save map for a smaller file.', 'Le projet JSON est un format d’échange lisible. Utilisez Enregistrer la carte pour un fichier plus petit.'],
  ['65,536-level PNG with its elevation range, ready to import again. Save map retains the exact FP32 grids.', 'PNG à 65 536 niveaux avec sa plage d’altitudes, prêt à être réimporté. Enregistrer la carte conserve les grilles FP32 exactes.'],
  ['Binary project is too large (2 GiB compressed maximum).', 'Projet binaire trop volumineux (2 Gio compressés maximum).'],
  ['Project is too large after decompression (1.5 GiB maximum).', 'Projet trop volumineux après décompression (1,5 Gio maximum).'],
  ['JSON project is too large (256 MiB maximum). Use a .muproj file for large maps.', 'Projet JSON trop volumineux (256 Mio maximum). Utilisez un fichier .muproj pour les grandes cartes.'],
  ['Invalid binary project magic or unsupported format version.', 'Signature de projet binaire invalide ou version du format non prise en charge.'],
  ['Invalid or truncated gzip project data.', 'Données gzip du projet invalides ou tronquées.'],
  ['Invalid or truncated project skeleton.', 'Structure du projet invalide ou tronquée.'],
  ['Invalid binary project array reference.', 'Référence de tableau du projet binaire invalide.'],
  ['Invalid or truncated binary project block.', 'Bloc du projet binaire invalide ou tronqué.'],
  ['Unexpected trailing binary project data.', 'Données inattendues à la fin du projet binaire.'],
  ['Unsupported binary project array type.', 'Type de tableau du projet binaire non pris en charge.'],
  ['Project structure is too complex.', 'Structure du projet trop complexe.'],
  ['Gzip compression is unavailable in this runtime.', 'La compression gzip est indisponible dans cet environnement.'],
  ['Gzip decompression is unavailable in this runtime.', 'La décompression gzip est indisponible dans cet environnement.'],
];
export const projectFileMessages = Object.fromEntries(rows.map(([en, fr]) => [en, { en, fr }]));
