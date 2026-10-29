import { GENERATION_STAGES, erosionBiome, isCompactProcedural, PROCEDURAL_TUNING_LIMITS, type GenerationStage, type ProceduralRecipe, type GenerationStageInfo } from '../../../rust/bridge/terrainGenerationRecipe';
import type { TerrainData, TerrainSettings } from '../../../rust/bridge/terrain';
import './proceduralInspector.css';
interface Bindings {
    read(): TerrainSettings | undefined;
    getRecipe(): ProceduralRecipe;
    setRecipe(recipe: ProceduralRecipe): void;
    apply(settings: TerrainSettings, height: Float32Array): void;
    run(until?:GenerationStage,all?:boolean):void;
    command(command:'next'|'all'|'cancel'):void;
    maskState():{enabled:boolean;editing:boolean;available:boolean};
    editMask():void;
    toggleMask(enabled:boolean):void;
}
export interface ProceduralInspector {
    begin(settings:TerrainSettings,stepped:boolean):void;
    update(stage:GenerationStageInfo,height?:Float32Array):void;
    complete(terrain:TerrainData):void;
    error(message:string):void;
    syncSource(active:boolean):void;
    toggle():void;
    editMask():void;
}
export function mountProceduralInspector(bindings: Bindings): ProceduralInspector {
    const terrainStage = document.getElementById('reliefStage') as HTMLDetailsElement;
    const terrainAnchor = document.createComment('terrain-stage');
    terrainStage.before(terrainAnchor);
    const maskStage=document.createElement('details');maskStage.className='custom-mask-step';maskStage.dataset.stage='customMask';
    const dialog = document.createElement('section');
    dialog.className = 'procedural-inspector';dialog.id='proceduralPipeline';dialog.hidden=true;
    dialog.innerHTML = `<header><strong>Pipeline procédural · 19 étapes</strong><button data-open-mask>Custom mask</button><button data-open-coasts>Paramètres de côte</button><button data-close>Masquer les étapes</button></header><p class="intro">Ces réglages pilotent aussi le bouton Générer. Le pas à pas utilise le backend choisi et affiche chaque relief sur la carte principale. ▶ exécute l’étape et ses dépendances ; pour Custom mask, il active le dessin sur la carte.</p><div class="inspector-actions"><button data-start>Démarrer pas à pas</button><button data-next>Étape suivante</button><button data-all>Tout calculer</button><button data-stop>Annuler</button><button data-keep disabled>Garder cette étape</button></div><p data-status role="status">Pipeline de la génération principale.</p><output data-metrics></output><section class="inspector-stages"></section>`;
    terrainStage.after(dialog);
    const prepareAnchor = document.createComment('pipeline:prepare');
    dialog.querySelector('.inspector-stages')!.append(prepareAnchor);
    const rows = new Map<GenerationStage, HTMLElement>();
    const stageLabels = new Map(GENERATION_STAGES.map(([id, title]) => [id, title]));
    const stateLabels: Record<string, string> = { waiting: 'en attente', running: 'en cours', done: 'terminé', skipped: 'désactivé / sans effet' };
    let recipe = structuredClone(bindings.getRecipe()), running = false, last: Float32Array | undefined, lastSettings: TerrainSettings | undefined;
    let visible=false,sourceActive=false;
    const status = dialog.querySelector<HTMLElement>('[data-status]')!, metrics = dialog.querySelector<HTMLOutputElement>('[data-metrics]')!, keep = dialog.querySelector<HTMLButtonElement>('[data-keep]')!;
    const targets:{host:HTMLElement;id:string}[]=[],moved:{node:Element;anchor:Comment}[]=[];
    const move=(host:HTMLElement,id:string)=>{targets.push({host,id});};
    const setVisible=(show:boolean)=>{
        visible=show;dialog.hidden=!show;
        if(show){prepareAnchor.after(terrainStage);terrainStage.after(maskStage);terrainStage.dataset.stage='prepare';terrainStage.open=true;}
        if(show&&!moved.length){for(const {host,id} of targets){const element=document.getElementById(id);if(!element)continue;const node=element.closest('.terrain-help-row')??element.closest('label')??element;const anchor=document.createComment(`pipeline:${id}`);node.before(anchor);host.append(node);moved.push({node,anchor});}}
        // Help wrappers are installed after mounting; restore them with their live control.
        if(!show){for(const {node,anchor} of moved)anchor.replaceWith(node.closest('.terrain-help-row')??node);moved.length=0;terrainAnchor.after(terrainStage);terrainStage.after(maskStage);delete terrainStage.dataset.stage;terrainStage.open=true;if(running)bindings.command('all');}
        body('prepare').hidden=!show;
        terrainStage.querySelector<HTMLElement>('[data-pipeline-time]')!.hidden=!show;
        terrainStage.querySelector<HTMLElement>('.pipeline-stage-actions')!.hidden=!show;
    };
    const cancel=()=>{if(running)bindings.command('cancel');running=false;};
    const markEdited=()=>{cancel();last=undefined;keep.disabled=true;for(const row of rows.values())row.dataset.state='stale';status.textContent='Paramètres modifiés : la prochaine exécution utilisera ces réglages.';};
    const changed=()=>{markEdited();const preset=document.getElementById('proceduralPreset') as HTMLSelectElement|null;if(preset)recipe.preset=preset.value as 'classic'|'compact';bindings.setRecipe(structuredClone(recipe));const phasor=document.getElementById('proceduralPhasor') as HTMLInputElement|null;if(phasor)phasor.checked=recipe.enabled?.phasor??isCompactProcedural(bindings.read()??{});refreshProfile();};
    function value(path: string): unknown { let v: any = recipe; for (const key of path.split('.'))
        v = v?.[key]; return v; }
    function write(path: string, v: unknown) { const keys = path.split('.'); let at: any = recipe; for (const key of keys.slice(0, -1))
        at = at[key] ??= {}; if (v === undefined)
        delete at[keys.at(-1)!];
    else
        at[keys.at(-1)!] = v; changed(); }
    function number(host: HTMLElement, path: string, label: string, min: number, max: number, step: number) { const row = document.createElement('label'); row.textContent = label + ' '; const input = document.createElement('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.dataset.proceduralParam = path; input.placeholder = 'Défaut moteur / biome'; input.value = value(path) === undefined ? '' : String(value(path)); const commit=()=>{const next=input.value===''?undefined:Number(input.value);if(value(path)!==next)write(path,next);};input.oninput=()=>{if(input.value&&!input.checkValidity())markEdited();else commit();}; input.onchange = () => { if (input.value && !input.checkValidity()) {
        input.reportValidity();
        return;
    } commit(); }; row.append(input); host.append(row); }
    function check(host: HTMLElement, path: string, label: string, fallback: boolean) { const row = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = (value(path) ?? fallback) as boolean; input.dataset.proceduralParam = path; input.onchange = () => write(path, input.checked); row.append(input, label); host.append(row); return row; }
    function draw(height:Float32Array){last=height;keep.disabled=false;let lo=Infinity,hi=-Infinity;for(const h of height){lo=Math.min(lo,h);hi=Math.max(hi,h);}metrics.textContent=`Carte principale · ${Math.sqrt(height.length)}² · ${lo.toFixed(3)} → ${hi.toFixed(3)} m`;}
    function start(until?:GenerationStage,all=false){bindings.run(until,all);}
    for (const [index, [id, title, optional]] of GENERATION_STAGES.entries()) {
        const row = id === 'prepare' ? terrainStage : document.createElement('details');
        const params = document.createElement('div');params.className='stage-parameters';
        if(id==='prepare'){
            const time=document.createElement('output');time.dataset.pipelineTime='';time.hidden=true;
            row.querySelector('summary')!.append(time);params.hidden=true;
            row.querySelector(':scope > .stage-controls')!.before(params);
        }else{
            row.dataset.stage = id;
            row.innerHTML = `<summary><span class="pipeline-stage-title">${index + 2}. ${title}</span><output data-pipeline-time></output></summary>`;
            row.append(params);
        }
        row.querySelector('.pipeline-stage-title')?.setAttribute('title',title);
        const actions=document.createElement('span');actions.className='pipeline-stage-actions';actions.hidden=id==='prepare';
        let toggle:HTMLLabelElement;
        if (optional) {
            toggle=check(actions, `enabled.${id}`, '', id === 'phasor' ? isCompactProcedural(bindings.read() ?? {}) : id === 'ridged' || id === 'surface' ? !isCompactProcedural(bindings.read() ?? {}) || id === 'surface' && bindings.read()?.relief === 'canyon' : true);
            toggle.title=`Activer ou désactiver : ${title}`;
        } else {
            toggle=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=true;checkbox.disabled=true;toggle.append(checkbox);actions.append(toggle);toggle.title=`Étape obligatoire : ${title}`;
            const text = document.createElement('small');
            text.textContent = 'Obligatoire : dépendance du pipeline.';
            params.append(text);
        }
        toggle.className='pipeline-stage-toggle';toggle.querySelector('input')!.setAttribute('aria-label',toggle.title);
        const run = document.createElement('button');
        run.type='button';run.textContent='▶';run.dataset.runStage=id;
        run.title=id==='prepare'?'Générer le terrain avec tous les réglages actuels':`Exécuter jusqu’à « ${title} » (dépendances incluses)`;run.setAttribute('aria-label',run.title);
        run.onclick = () => id==='prepare'?start(undefined,true):start(id);
        actions.append(run);actions.addEventListener('click',event=>event.stopPropagation());
        row.querySelector('summary')!.insertBefore(actions,row.querySelector('[data-pipeline-time]'));
        rows.set(id, row);
        if(id!=='prepare')dialog.querySelector('.inspector-stages')!.append(row);
    }
    const body = (id: GenerationStage) => rows.get(id)!.querySelector<HTMLElement>('.stage-parameters')!;
    maskStage.innerHTML='<summary><span class="pipeline-stage-title">2. Custom mask</span><span class="pipeline-stage-actions"><label class="pipeline-stage-toggle" title="Utiliser le masque personnalisé"><input type="checkbox" aria-label="Utiliser le masque personnalisé" data-mask-enabled></label><button type="button" data-run-stage="customMask" title="Dessiner le masque sur la carte" aria-label="Dessiner le masque sur la carte">▶</button></span><output data-mask-state></output></summary><div class="stage-parameters"><p>Dessinez directement sur la carte principale. Le calque laisse le relief visible sous les couleurs. Décocher conserve le dessin et utilise le relief automatique.</p></div>';
    maskStage.querySelector('.stage-parameters')!.append(document.getElementById('terrainSketchEditor')!);
    const maskToggle=maskStage.querySelector<HTMLInputElement>('[data-mask-enabled]')!,maskPlay=maskStage.querySelector<HTMLButtonElement>('[data-run-stage]')!;
    maskStage.querySelector('.pipeline-stage-actions')!.addEventListener('click',event=>event.stopPropagation());
    maskToggle.onchange=()=>{cancel();bindings.toggleMask(maskToggle.checked);syncMask();};
    maskPlay.onclick=()=>{cancel();bindings.editMask();syncMask();};
    function syncMask(){const state=bindings.maskState();maskToggle.checked=state.enabled;maskToggle.disabled=maskPlay.disabled=!state.available;const label=maskStage.querySelector<HTMLOutputElement>('[data-mask-state]')!;label.textContent=!state.available?'—':state.editing?'dessin':state.enabled?'actif':'auto';label.title=!state.available?'Indisponible pour ce relief':state.editing?'Dessin sur la carte':state.enabled?'Masque personnalisé actif':'Relief automatique · dessin conservé';}
    maskStage.addEventListener('terrain-mask-state',syncMask);
    function openMask(){maskStage.open=true;maskStage.style.scrollMarginTop=`${visible?dialog.querySelector<HTMLElement>('.inspector-actions')!.offsetHeight+12:12}px`;maskStage.scrollIntoView({block:'start'});maskPlay.click();}
    const mapSettings=document.createElement('section');mapSettings.className='pipeline-map-settings';
    mapSettings.innerHTML='<div class="pipeline-map-size"><strong>Taille de la carte</strong><output data-map-size></output><div data-size-input></div><div class="pipeline-size-presets" role="group" aria-label="Tailles de carte"></div><small>Côté en mètres · carte carrée · de 0,5 à 100 km.</small></div><div class="pipeline-map-controls"></div>';
    body('prepare').prepend(mapSettings);
    const width=document.getElementById('width') as HTMLInputElement;
    const mapSize=mapSettings.querySelector<HTMLOutputElement>('[data-map-size]')!;
    const sizeButtons:HTMLButtonElement[]=[];
    function refreshSize(){const side=Number(width.value)/1000;mapSize.textContent=width.value&&width.validity.valid?`${side.toLocaleString('fr-FR')} × ${side.toLocaleString('fr-FR')} km`:'Dimensions à renseigner';for(const button of sizeButtons)button.setAttribute('aria-pressed',String(Number(button.dataset.size)===Number(width.value)));}
    for(const km of [5,10,25,50]){const button=document.createElement('button');button.type='button';button.dataset.size=String(km*1000);button.textContent=`${km} km`;button.onclick=()=>{width.value=String(km*1000);width.dispatchEvent(new Event('input',{bubbles:true}));width.dispatchEvent(new Event('change',{bubbles:true}));};sizeButtons.push(button);mapSettings.querySelector('.pipeline-size-presets')!.append(button);}
    width.addEventListener('input',refreshSize);width.addEventListener('change',refreshSize);refreshSize();
    move(mapSettings.querySelector<HTMLElement>('[data-size-input]')!,'width');
    const mainSettings=mapSettings.querySelector<HTMLElement>('.pipeline-map-controls')!;
    body('prepare').append(document.createTextNode('Les multiplicateurs d’érosion se combinent avec le profil climatique affiché.'));
    check(body('prepare'), 'biome', 'Le biome pilote les forces d’érosion', false);
    body('prepare').append(document.createTextNode(' Tropical : hydraulique forte + incision a posteriori ; aride : hydraulique faible + transport éolien. Froid : relaxation renforcée, sans simulation glaciaire.'));
    const profileInfo = document.createElement('output');
    body('prepare').append(profileInfo);
    function refreshProfile() { const s = bindings.read(); profileInfo.textContent = !recipe.biome ? 'Influence climatique désactivée.' : s ? `Profil ${s.climate} : eau ×${erosionBiome(s).water.toFixed(2)}, thermique ×${erosionBiome(s).thermal.toFixed(2)}, fluvial ${erosionBiome(s).posterior.toFixed(2)}, vent ${erosionBiome(s).wind} passes à ${erosionBiome(s).transport.toFixed(2)} m/passe.` : 'Réglages incomplets'; }
    refreshProfile();
    number(body('grids'), 'regionalN', 'Grille régionale (côté)', 64, 640, 1);
    number(body('grids'), 'surfaceN', 'Grille de surface hors marge', 64, 1024, 1);
    number(body('initialize'), 'noiseScale', 'Échelle du bruit régional ×', .25, 4, .05);
    number(body('initialize'), 'crest', 'Force des crêtes', 0, 1.5, .05);
    number(body('regional'), 'uplift', 'Soulèvement ×', 0, 4, .05);
    check(body('regional'), 'regionalThermal', 'Relaxation thermique dans les cycles', true);
    check(body('regional'), 'regionalDiffusion', 'Diffusion dans les cycles', true);
    const locations: Record<string, GenerationStage> = { iterations: 'regional', incision: 'regional', incisionSlope: 'regional', fill: 'regional', carve: 'regional', finalCarve: 'regionalFinish', talus: 'regional', thermal: 'regional', diffusion: 'regional', detail: 'ridged', warp: 'reconstruct' };
    for (const key of Object.keys(PROCEDURAL_TUNING_LIMITS)) {
        move(body(locations[key] ?? 'surface'), `er_${key}`);
        const input = document.getElementById(`er_${key}`) as HTMLInputElement | null;
        const v = (recipe.erosionTuning as Record<string, number> | undefined)?.[key];
        if (input && v !== undefined)
            input.value = String(v);
    }
    body('regional').append(document.createTextNode('Ordre de chaque cycle : soulèvement → drainage, bassins et seuils → accumulation → incision implicite → thermique → diffusion. Le routage est requis par l’incision ; les solveurs restent validés jusqu’à convergence.'));
    for (const id of ['terrainMethod', 'seed', 'randomSeed', 'proceduralPreset', 'relief', 'motifSize', 'environment', 'mountainMix', 'erosion', 'climate', 'climTemperature', 'climTemperatureStd', 'climPrecipitation', 'climPrecipitationCv', 'generationCompute', 'compute'])
        move(mainSettings, id);
    move(dialog.querySelector<HTMLElement>('.inspector-actions')!,'generate');
    move(body('grids'), 'phasorQuality');
    move(body('phasor'), 'phasorIntensity');
    const coastSettings=document.createElement('section');coastSettings.className='pipeline-coast-settings';body('coasts').prepend(coastSettings);
    move(coastSettings, 'coastControl');
    move(body('hydrology'), 'hydroControls');
    move(body('render'), 'style');
    body('amplitude').append(document.createTextNode('Percentile 99 puis amplitude de la famille.'));
    body('normalize').append(document.createTextNode('Percentile 1 à 1 m ; plancher de 0,3 m avant les côtes.'));
    body('phasor').append(document.createTextNode('Intensité et qualité : contrôles Phasor du terrain. Le détail final n’est pas une érosion.'));
    const reconstruction = document.createElement('select');
    reconstruction.dataset.proceduralParam = 'reconstruction';
    for (const [v, label] of [['default', 'Reconstruction du moteur'], ['cubic', 'Bicubique bornée'], ['bspline', 'B-spline positive']])
        reconstruction.add(new Option(label, v));
    reconstruction.value = recipe.reconstruction ?? 'default';
    reconstruction.onchange = () => write('reconstruction', reconstruction.value);
    body('reconstruct').append(reconstruction);
    const mode = document.createElement('select');
    mode.dataset.proceduralParam = 'posterior.mode';
    for (const [v, label] of [['', 'Défaut biome'], ['none', 'Aucun'], ['erosion', 'Érosion fluviale'], ['breach', 'Ouverture des dépressions'], ['both', 'Érosion + ouverture']])
        mode.add(new Option(label, v));
    mode.value = String(recipe.posterior?.mode ?? '');
    mode.onchange = () => write('posterior.mode', mode.value || undefined);
    body('posterior').append(mode);
    number(body('posterior'), 'posterior.strength', 'Force fluviale CPU', 0, 5, .1);
    number(body('posterior'), 'posterior.maxDepth', 'Profondeur maximale d’ouverture m', 0, 100, 1);
    number(body('posterior'), 'posterior.maxLength', 'Longueur maximale d’ouverture m', 0, 2000, 10);
    number(body('coasts'), 'coastIterations', 'Cycles d’érosion côtière', 0, 100, 1);
    number(body('coasts'), 'coastIncision', 'Incision côtière ×', 0, 10, .05);
    number(body('coasts'), 'coastThermal', 'Thermique côtière ×', 0, 10, .05);
    number(body('coasts'), 'coastDiffusion', 'Diffusion côtière ×', 0, 10, .05);
    number(body('wind'), 'wind.iterations', 'Passes éoliennes', 0, 100, 1);
    number(body('wind'), 'wind.azimuth', 'Direction vers laquelle souffle le vent °', 0, 360, 5);
    number(body('wind'), 'wind.transport', 'Transport maximal m/passe', 0, 5, .05);
    body('wind').append(document.createTextNode('Transport conservatif entre voisins, exposition et abri par la pente. Modèle morphologique de surface meuble ; pas une simulation atmosphérique.'));
    body('coasts').append(document.createTextNode('Les directions marines et le mode île / archipel se règlent ici. Les îles apparaissent lorsque tous les côtés sont marins.'));
    body('sampling').append(document.createTextNode('Aperçu 512² ; source physique 1024².'));
    body('hydrology').append(document.createTextNode('Les paramètres du panneau Hydrologie restent la source de vérité : moteur, conditionnement, lacs, incision des lits et climat.'));
    body('render').append(document.createTextNode('Affichage dans la carte principale, avec le style du bench. Le résultat final devient le terrain courant.'));
    dialog.querySelector<HTMLButtonElement>('[data-start]')!.onclick = () => start();
    dialog.querySelector<HTMLButtonElement>('[data-next]')!.onclick = () => { if (running)
        bindings.command('next');
    else
        start(); };
    dialog.querySelector<HTMLButtonElement>('[data-all]')!.onclick = () => { if (running)
        bindings.command('all');
    else
        start(undefined, true); };
    dialog.querySelector<HTMLButtonElement>('[data-stop]')!.onclick = () => { cancel(); status.textContent = 'Génération annulée ; ressources libérées après l’opération en cours.'; };
    keep.onclick = () => { if (last && lastSettings) {
        cancel();
        bindings.apply(lastSettings, last);

    } };
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick = () => setVisible(false);
    dialog.querySelector<HTMLButtonElement>('[data-open-mask]')!.onclick=openMask;
    dialog.querySelector<HTMLButtonElement>('[data-open-coasts]')!.onclick=()=>{const row=rows.get('coasts') as HTMLDetailsElement;row.open=true;row.style.scrollMarginTop=`${dialog.querySelector<HTMLElement>('.inspector-actions')!.offsetHeight+12}px`;row.scrollIntoView({block:'start'});};
    dialog.addEventListener('click', event => { if ((event.target as Element).closest('#coastControl'))
        changed(); });
    const inputs=new WeakMap<Element,string>();
    const externalChange=(field:HTMLInputElement)=>{if (field.id.startsWith('er_') && recipe.erosionTuning)
        delete (recipe.erosionTuning as Record<string, number>)[field.id.slice(3)]; changed(); const compact = isCompactProcedural(bindings.read() ?? {}); for (const id of ['phasor', 'ridged', 'surface'] as const)
        if (recipe.enabled?.[id] === undefined) {
            const control = dialog.querySelector<HTMLInputElement>(`[data-procedural-param="enabled.${id}"]`);
            if (control)
                control.checked = id === 'phasor' ? compact : !compact || id === 'surface' && bindings.read()?.relief === 'canyon';
        } };
    const fingerprint=(field:HTMLInputElement)=>field.type==='checkbox'?String(field.checked):field.value;
    dialog.addEventListener('input',event=>{const field=event.target as HTMLInputElement;if(!dialog.contains(field)||field.tagName==='SELECT'||field.dataset.proceduralParam||field.closest('[data-stage="customMask"]'))return;inputs.set(field,fingerprint(field));externalChange(field);});
    dialog.addEventListener('change',event=>{const field=event.target as HTMLInputElement;if(!dialog.contains(field)||field.dataset.proceduralParam)return;if(field.closest('[data-stage="customMask"]')){syncMask();return;}if(inputs.get(field)===fingerprint(field))return;externalChange(field);});
    setVisible(false);syncMask();
    return {
        begin(settings,stepped){lastSettings=settings;running=true;last=undefined;keep.disabled=true;for(const row of rows.values()){row.dataset.state='';const time=row.querySelector<HTMLOutputElement>('[data-pipeline-time]')!;time.textContent='';time.title='';}status.textContent=stepped?'Génération principale · pas à pas':'Génération principale · calcul complet';},
        update(m,height){const row=rows.get(m.stage);if(row){row.dataset.state=m.status;const time=row.querySelector<HTMLOutputElement>('[data-pipeline-time]')!;time.textContent=m.elapsedMs===undefined?(m.paused?'pause':m.status==='running'?'en cours':''):m.elapsedMs<1000?`${m.elapsedMs.toFixed(1)} ms`:`${(m.elapsedMs/1000).toFixed(2)} s`;time.title=[m.paused?'en pause':stateLabels[m.status],m.detail,m.elapsedMs===undefined?'':`${m.elapsedMs.toFixed(1)} ms`].filter(Boolean).join(' · ');}status.textContent=m.paused?`En pause avant « ${stageLabels.get(m.stage)} » · Étape suivante ou Tout calculer pour poursuivre.`:`${stageLabels.get(m.stage)} · ${stateLabels[m.status]}${m.detail?' · '+m.detail:''}`;if(height)draw(height);},
        complete(terrain){running=false;for(const row of rows.values())if(!row.dataset.state){row.dataset.state='cached';const time=row.querySelector<HTMLOutputElement>('[data-pipeline-time]')!;time.textContent='cache';time.title='Conservé · non recalculé';}status.textContent='Pipeline terminé · résultat appliqué à la carte principale.';draw(terrain.field?.data??terrain.height);},
        error(message){running=false;status.textContent=message;},
        syncSource(active){recipe=structuredClone(bindings.getRecipe());for(const [id,row] of rows){const checkbox=row.querySelector<HTMLInputElement>(`[data-procedural-param="enabled.${id}"]`);if(checkbox)checkbox.checked=recipe.enabled?.[id]??(id==='phasor'?isCompactProcedural(bindings.read()??{}):id==='ridged'||id==='surface'?!isCompactProcedural(bindings.read()??{})||id==='surface'&&bindings.read()?.relief==='canyon':true);}if(active!==sourceActive){sourceActive=active;setVisible(active);}refreshProfile();refreshSize();syncMask();},
        toggle(){if(sourceActive)setVisible(!visible);},editMask:openMask
    };
}
