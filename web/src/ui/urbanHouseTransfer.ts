import type { PlacedBuilding, PlacementBatch } from '../../../rust/bridge/urbanArchitecture';
import { resolveArchivedPlan } from '../../../rust/bridge/compactPlanArchive';
import type { PlanArchiveScene } from '../../../rust/bridge/compactPlanArchive';
import { openBench } from './benchHistory';

let database: Promise<IDBDatabase> | undefined;
async function storeCase<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await (database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('magna-urban-house-cases', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('cases');
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  }));
  return new Promise((resolve, reject) => {
    const tx = db.transaction('cases', mode), result = request(tx.objectStore('cases'));
    tx.oncomplete = () => resolve(result.result); tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
export async function readUrbanHouseCase(id: string): Promise<PlacedBuilding> {
  const building = await storeCase<PlacedBuilding | undefined>('readonly', store => store.get(id));
  if (!building) throw new Error('Cas d’implantation absent de ce navigateur. Rouvrez le bâtiment depuis sa ville.');
  return building;
}
export async function openUrbanHouseCase(building: PlacedBuilding, scene?: PlanArchiveScene): Promise<void> {
  // Immutable copy of the resolved native plan; never a reverse edit of the city.
  const id = `placement-${crypto.randomUUID()}`;
  // The receiving page has no access to the city's archive registry. Store only
  // this selected resolved record, so a cold reload still opens the exact plan.
  const transferred = { ...building, resolved: await resolveArchivedPlan(building, scene) };
  await storeCase('readwrite', store => store.put(structuredClone(transferred), id));
  if (window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1') {
    window.parent.postMessage({ channel: 'magna-urban-workshop', type: 'open-house', id }, location.protocol === 'file:' ? '*' : location.origin);
  } else openBench('houses', new URLSearchParams({ placement: id }));
}
