/** The current optional refinement registration uses a 12 MiB JSON upload. */
export const MAX_REFINEMENT_SOURCE_RESOLUTION = 1500;

export function assertRefinementRegistrationBudget(n: number): void {
  if (!Number.isInteger(n) || n < 1 || n > MAX_REFINEMENT_SOURCE_RESOLUTION)
    throw new Error(`Neural Earth : raffinement optionnel limité à ${MAX_REFINEMENT_SOURCE_RESOLUTION}² échantillons conservés ; la génération physique reste disponible.`);
}
