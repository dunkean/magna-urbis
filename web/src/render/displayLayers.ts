/** Content visibility is separate from style tokens and diagnostic data. */
export const TERRAIN_LAYER_CONTROLS = [
  { id: 'showRelief', label: 'Fond de terrain', description: 'Surface du terrain, indépendante de l’eau.' },
  { id: 'showHypsometry', label: 'Couleur du terrain', description: 'Palette d’altitude ou matériaux du style.' },
  { id: 'showWater', label: 'Eau', description: 'Mer, lacs et rivières.' },
  { id: 'showLakes', label: 'Lacs', description: 'Sous-couche de l’eau : surfaces lacustres.' },
  { id: 'showOxbows', label: 'Anciens chenaux', description: 'Sous-couche de l’eau : bras morts et anciens chenaux.' },
  { id: 'showContours', label: 'Courbes de niveau', description: 'Lignes d’altitude du terrain.' },
  { id: 'showFrame', label: 'Cadre', description: 'Cadre de la carte.' },
] as const;

export const DISPLAY_VOCABULARY = {
  style: 'Couleurs et matériaux, sans modification de la géométrie.',
  layer: 'Élément de la carte dont on choisit la visibilité.',
  diagnostic: 'Visualisation de données de calcul, par-dessus la carte ou en remplacement de sa couleur.',
  mask: 'Donnée qui délimite ou pondère une opération de génération.',
} as const;
