import type { Decor } from './decor';
import type { Building3dScene } from '../render/urbanBuildingGeometry';
import { decorToSurfaceInput } from '../surface/adapters/magna';
import { occupationFromMagnaScene } from '../surface/adapters/occupation';
import { magnaRoads, magnaUrbanIdentity, magnaUrbanPacket } from '../surface/adapters/magnaUrban';
import type { PreparedSurfaceWorkerSource } from '../surface/workerProtocol';
import { archiveSurfaceSource } from '../surface/adapters/sourceArchive';
import { assertSurfaceRegistrationBinding, type SurfaceRegistrationBinding } from '../surface/registrationBinding';
import { magnaSurfacePresentation } from '../surface/presentation';

export interface SurfaceDecorWorkerSource { decor: Decor; scene?: Building3dScene; providerId: string; registrationBinding?: SurfaceRegistrationBinding }

/** Runs inside the compiler worker: occupation rasters and urban geometry export do not block the UI. */
export function prepareSurfaceDecorWorkerSource(value: unknown): PreparedSurfaceWorkerSource {
  const payload = value as SurfaceDecorWorkerSource;
  if (!payload?.decor?.raster || typeof payload.providerId !== 'string' || !payload.providerId.length) throw new Error('Invalid retained surface worker source');
  const { decor, scene } = payload;
  const registrationBinding = payload.registrationBinding && { ...payload.registrationBinding };
  if (registrationBinding) assertSurfaceRegistrationBinding(registrationBinding, { width: decor.raster.width, n: decor.raster.n, data: decor.raster.height });
  const input = decorToSurfaceInput(decor);
  const roads = magnaRoads(decor);
  const buildings = scene ?? { buildings: [] };
  input.occupation = occupationFromMagnaScene(input.terrain, buildings, roads, input.occupation);
  const urban = magnaUrbanPacket(decor, buildings, 0, 0, undefined, 'binary');
  const prepared: PreparedSurfaceWorkerSource & { registrationBinding?: SurfaceRegistrationBinding; urbanId: string } = {
    input, providerId: registrationBinding?.providerId ?? payload.providerId, registrationBinding,
    urban, urbanId: magnaUrbanIdentity(urban), sourceMetadata: archiveSurfaceSource({ meta: decor.meta, registrationBinding,
      presentation: magnaSurfacePresentation(decor.meta.query) }),
  };
  return prepared;
}
