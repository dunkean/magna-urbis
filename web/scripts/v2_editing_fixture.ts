import { writeFile, mkdir } from 'node:fs/promises';
import { defaultSettings } from '../src/v2/settings';
import { serializeProject } from '../src/v2/project';
import type { World } from '../src/gen/types';

const settings=defaultSettings();
settings.extent=1000;settings.runtime={backend:'rust',compute:'cpu',source:'procedural'};
settings.appearance={renderer:'classic',style:'parchment'};
const grid=(value:number)=>({w:20,h:20,cell:50,data:new Float32Array(400).fill(value)});
const world:World={seed:settings.options.seed,mapSize:1000,options:settings.options,stats:{},
  terrain:{height:grid(20),slope:grid(0),flow:grid(1),seaLevel:0,seaFraction:0,coastline:[],lakes:[],
    water:new Uint8Array(400),receiver:new Int32Array(400).fill(-1),filled:new Float32Array(400).fill(20),downSide:'S',seaSide:null,
    rivers:[{id:1,path:[{x:500,y:200},{x:500,y:900}],width:[10,12]},{id:2,host:1,mouth:'river',path:[{x:200,y:300},{x:500,y:500}],width:[4,5]},{id:3,path:[{x:800,y:100},{x:800,y:900}],width:[5,5]}]},
  roads:[{path:[{x:100,y:600},{x:900,y:600}],kind:'major',width:6}],
  names:{family:'english',town:'Editor fixture',entries:[{id:'river:1',text:'Main river',kind:'river',rank:0,anchor:{x:500,y:550},path:[{x:500,y:200},{x:500,y:900}]}]},
};
await mkdir('out/v2-editing',{recursive:true});
await writeFile('out/v2-editing/fixture.json',serializeProject(settings,world));
