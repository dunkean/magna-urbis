/** First presentation follows each town's actual geometry, independently of generation completion and style changes. */
import type { World } from '../gen/types';
import { nativeCityRecords } from './nativeProducts';

export class TownFirstDisplay {
  private readonly presented = new WeakSet<object>();

  private source(world: World, key: string): object | undefined {
    const native = nativeCityRecords(world)?.[key];
    if (native?.layouts?.length) return native.scene ?? native.programmePartitions ?? native.partitions ?? native.layouts;
    const town = world.settlements?.find(place => place.key === key);
    return town?.main ? world.urban : town?.urban;
  }

  pending(world: World | undefined | null, key: string): boolean {
    const source = world && this.source(world, key);
    return !!source && !this.presented.has(source);
  }

  notePresented(world: World): void {
    for (const town of world.settlements ?? []) {
      const source = this.source(world, town.key);
      if (source) this.presented.add(source);
    }
  }
}
