import type { Layout, Parcel } from '../../../rust/bridge/urban';

const escape = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const area = (ring: { x: number; y: number }[]): number => Math.abs(ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length]; return sum + p.x * q.y - q.x * p.y;
}, 0)) / 2;
const uses: Record<string, string> = { plot: 'Terrain constructible', garden: 'Jardin voulu', place: 'Place', compound: 'Enclos / domaine', market: 'Marché', reserve: 'Réserve', common: 'Commun', residual: 'Résidu non constructible', court: 'Cour et circulation conservées' };
const accesses: Record<string, string> = { public: 'Rue publique', collective: 'Accès collectif', private: 'Accès privé', unserved: 'Sans desserte', reserved: 'Espace réservé', attached: 'Arrière-fond rattaché' };

/** Read the applied native parcel. No reconstruction from the diagnostic polygons. */
export function parcelInspectionHtml(parcel: Parcel, layout: Layout, ordinal: number): string {
  const block = layout.blocks[parcel.block], quarter = block && layout.quarters[block.quarter];
  const phase = layout.phases?.[block?.phase ?? quarter?.phase ?? 0];
  const surface = Math.max(0, area(parcel.shape.outer) - parcel.shape.holes.reduce((sum, ring) => sum + area(ring), 0));
  const rows: [string, string][] = [
    ['Résultat', uses[parcel.use] ?? parcel.use],
    ['Îlot / quartier', `${parcel.block + 1} / ${(block?.quarter ?? 0) + 1}`],
    ['Culture / recette', `${phase?.culture ?? layout.culture} · ${phase?.recipe ?? 'recette du quartier'}`],
    ['Surface cadastrale', `${surface.toFixed(1)} m²${parcel.shape.holes.length ? ` · ${parcel.shape.holes.length} exclusion(s)` : ''}`],
    ['Façade utile', parcel.access ? `${parcel.access.frontLength.toFixed(2)} m` : 'Non conservée dans cet ancien plan'],
    ['Desserte', parcel.access ? accesses[parcel.access.kind] ?? parcel.access.kind : 'Non qualifiée dans cet ancien plan'],
  ];
  if (parcel.id) rows.unshift(['Identité', parcel.id]);
  if (parcel.family) rows.push(['Famille foncière', parcel.family]);
  if (parcel.reason) rows.push(['Motif du résultat', parcel.reason]);
  if (parcel.provenance?.length) rows.push(['Origine', parcel.provenance.join(' · ')]);
  if (parcel.contacts?.length) rows.push(['Contacts qualifiés', `${parcel.contacts.length} · ${parcel.contacts.reduce((sum, c) => sum + c.length, 0).toFixed(2)} m`]);
  if (parcel.parentIds?.length) rows.push(['Parentage', parcel.parentIds.join(' · ')]);
  if (parcel.pressure !== undefined) rows.push(['Pression d’occupation', `${(parcel.pressure * 100).toFixed(0)} %`]);
  const admission = layout.programme?.cultures.find(c => c.culture === (phase?.culture ?? layout.culture))?.admissibility;
  if (admission) {
    rows.push(['Recette d’admission', admission.recipeId]);
    rows.push(['Gabarit minimal', `${admission.minFrontage.toFixed(2)} × ${admission.minDepth.toFixed(2)} m · ${admission.minArea.toFixed(1)} m²`]);
    rows.push(['Accès minimal', `${admission.minAccessWidth.toFixed(2)} m`]);
  }
  if (parcel.access?.street !== undefined && parcel.access.street !== null) {
    const street = layout.streets[parcel.access.street];
    if (street) rows.push(['Voie', `${accesses[parcel.access.kind] ?? parcel.access.kind} · ${street.role}`]);
  }
  return `<strong>Parcelle ${ordinal + 1}</strong><dl class="urban-inspection">${rows.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
}

export function appliedParcelAt(layouts: Layout[], partitions: { key: string; parcels: Parcel[] }[], index: number): { parcel: Parcel; layout: Layout } | undefined {
  let offset = 0;
  for (const partition of partitions) {
    if (index >= offset && index < offset + partition.parcels.length) {
      const layout = layouts.find(l => l.key === partition.key);
      return layout ? { parcel: partition.parcels[index - offset], layout } : undefined;
    }
    offset += partition.parcels.length;
  }
  return undefined;
}
