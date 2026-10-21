import { houseMaterialColor, type HouseMaterialCatalogue } from '../../../rust/bridge/houseRender';
import type { MaterialSlots } from '../../../rust/bridge/housesContract';
import type { ArchitectureFunction } from '../../../rust/bridge/urbanArchitecture';

export type UrbanBuildingStyle = 'geometric' | 'cartographic';
export type UrbanBuildingDiagnostic = 'none' | 'uses' | 'height' | 'access';
export interface UrbanBuildingAppearance { style: UrbanBuildingStyle; diagnostic: UrbanBuildingDiagnostic }
export interface BuildingPaint { wall: string; roof: string; edge: string; courtyard: string }
export const URBAN_FUNCTION_LABELS: Record<ArchitectureFunction, string> = {
  domestic: 'Habitat', mixed: 'Habitat et boutique', workshop: 'Atelier', warehouse: 'Entrepôt', collective: 'Établissement collectif', open_space: 'Espace ouvert',
};
const useColors: Record<ArchitectureFunction, string> = { domestic: '#cbaa77', mixed: '#d5ad5d', workshop: '#bb8367', warehouse: '#9899a1', collective: '#a99abc', open_space: '#a3b77e' };
export function urbanFunctionColor(fn: string): string {
  if (fn === 'refusal') return '#bb4541';
  return useColors[fn as ArchitectureFunction] ?? (['market', 'common'].includes(fn) ? useColors.open_space : '#b8b8ac');
}

/** Appearance only. Native material references and physical heights stay in the scene. */
export function buildingPaint(materials: MaterialSlots | undefined, fn: ArchitectureFunction, height: number, appearance: UrbanBuildingAppearance, materialId?: string, catalogue: HouseMaterialCatalogue = {materials: []}): BuildingPaint {
  let wall = houseMaterialColor(catalogue, materialId ?? (materials?.coating || materials?.infill || materials?.frame || ''));
  let roof = houseMaterialColor(catalogue, materialId ?? materials?.cladding ?? '');
  if (appearance.diagnostic === 'uses') wall = roof = useColors[fn];
  if (appearance.diagnostic === 'height') {
    const t = Math.max(0, Math.min(1, height / 24));
    wall = roof = `rgb(${Math.round(112 + 100 * t)},${Math.round(175 - 82 * t)},${Math.round(188 - 53 * t)})`;
  }
  return { wall, roof, edge: '#393a31', courtyard: '#f4efdf' };
}
