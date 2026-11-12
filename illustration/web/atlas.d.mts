export function neighbourView(job: any, direction: string): { cx: number; cy: number; scale: number };
export function mountBattlemapAtlas(options: {
  host: HTMLElement;
  requestNeighbour(parent: any, direction: string, neighbours: string[], server: string): Promise<{job:any;blob:Blob}>;
  requestMosaic?(jobs: string[], server: string): Promise<{url:string;filename:string;width:number;height:number;tiles:number}>;
  getRelated?(job: any, server: string): Promise<{jobs:any[]}>;
  onCurrent?(job:any,server:string):void;
  onStatus(message:string,error?:boolean):void;
}): {setRoot(job:any,blob:Blob,server:string):Promise<void>;move(direction:string):Promise<void>;current():{job:any;server:string}|undefined;dispose():void};
