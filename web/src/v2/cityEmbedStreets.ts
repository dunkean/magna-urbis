import type { Street } from '../../../rust/bridge/urban';

/** Access paths appear at the scale of the studio. In the iframe they obscure entrances and the public street grid. */
const SERVICE_WAYS = new Set(['lane', 'close', 'track', 'wall-lane', 'private']);

export const cityEmbedShowsStreet = ({ role }: Pick<Street, 'role'>): boolean => !SERVICE_WAYS.has(role);
