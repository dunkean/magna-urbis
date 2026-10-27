import { savedLocale } from './shellLocale';
type Translation = [string,string,string,string];
// Stable atlas IDs, with French retained in the native catalogue.
const labels: Record<string, Translation> = {
 'FP-ROUND':['Circular','圆形','Circular','Circular'],'FP-OVAL':['Oval','椭圆形','Oval','Oval'],'FP-SQUARE':['Square','方形','Cuadrada','Quadrada'],'FP-RECT':['Rectangular','矩形','Rectangular','Retangular'],'FP-LONG':['Very elongated','细长形','Muy alargada','Muito alongada'],'FP-L':['L-shaped','L 形','En L','Em L'],'FP-U':['U-shaped','U 形','En U','Em U'],'FP-COMPLEX':['Composite / additive','组合 / 加法','Compuesta / aditiva','Composta / aditiva'],'FP-COURT':['Courtyard ring','庭院环形','Anillo alrededor de patio','Anel ao redor de pátio'],'FP-POLYGON':['Polygonal','多边形','Poligonal','Poligonal'],'FP-TOWER':['Narrow tower','狭窄塔楼','Torre estrecha','Torre estreita'],'FP-APSIDAL':['Apsidal end','半圆后殿端','Extremo absidal','Extremidade absidal'],'FP-TRICONCH':['Trefoil plan','三叶形平面','Planta trilobulada','Planta trilobada'],'FP-CROSS':['Cross-shaped','十字形','En cruz','Em cruz'],'FP-TERRACE':['Stacked terraces','层叠台地','Terrazas superpuestas','Terraços sobrepostos'],'FP-ELLIPTICAL-RING':['Elliptical ring','椭圆环','Anillo elíptico','Anel elíptico'],'FP-ROCKCUT':['Rock-cut','岩凿','Excavada en roca','Escavada na rocha'],'FP-MULTICELL':['Adjacent cells','相邻单元','Celdas adyacentes','Células adjacentes'],'FP-CLUSTER-ROUND':['Round hut cluster','圆屋群','Grupo de chozas redondas','Grupo de cabanas redondas'],'FP-IRREGULAR':['Irregular curved footprint','不规则曲线占地','Huella curva irregular','Implantação curva irregular'],
 'RF-CONE':['Conical','圆锥形','Cónica','Cônico'],'RF-GABLE':['Gable','双坡屋顶','Dos aguas','Duas águas'],'RF-HIP':['Hipped','四坡屋顶','Cuatro aguas','Quatro águas'],'RF-FLAT':['Flat terrace','平顶','Azotea plana','Terraço plano'],'RF-SHED':['Lean-to','单坡屋顶','Cobertizo','Telhado de uma água'],'RF-DOME':['Dome / hemisphere','穹顶 / 半球','Cúpula / hemisferio','Cúpula / hemisfério'],'RF-THATCH-VAULT':['Vegetal barrel roof','植物筒拱屋顶','Bóveda vegetal','Abóbada vegetal'],'RF-VAULT':['Barrel vault','筒拱','Bóveda de cañón','Abóbada de berço'],'RF-CROSSVAULT':['Groin vault','交叉拱','Bóveda de arista','Abóbada de aresta'],'RF-STEP':['Stepped volumes','阶梯体量','Volúmenes escalonados','Volumes escalonados'],'RF-EAVES':['Deep eaves','深檐','Grandes aleros','Beirais amplos'],'RF-CURVED':['Upturned roof edges','翘檐屋顶','Cubierta de bordes alzados','Telhado com bordas erguidas'],'RF-TIERED':['Superimposed roofs','重叠屋顶','Cubiertas superpuestas','Telhados sobrepostos'],'RF-REED-HIP':['Steep vegetal hip roof','陡坡植物四坡屋顶','Cadera vegetal pronunciada','Telhado vegetal de quatro águas íngreme'],'RF-TENT':['Conical textile covering','圆锥形织物覆盖','Cubierta textil cónica','Cobertura têxtil cônica'],'RF-SADDLE':['Saddle / raised ends','鞍形 / 翘起端部','Silla / extremos alzados','Sela / extremidades erguidas'],'RF-GAMBREL':['Broken double slope','折坡双坡屋顶','Dos vertientes quebradas','Duas águas quebradas'],'RF-DOME-CONE':['Dome on drum','鼓座穹顶','Cúpula sobre tambor','Cúpula sobre tambor'],'RF-STEEP-STEP':['Stepped gable','阶梯山墙','Hastial escalonado','Empena escalonada'],'RF-MULTIPAV':['Nested roofs','嵌套屋顶','Cubiertas encajadas','Telhados encaixados'],'RF-SNOW':['Snow vault','雪拱顶','Bóveda de nieve','Abóbada de neve'],'RF-SHELL':['Vegetal shell','植物壳形屋顶','Cubierta vegetal','Cobertura vegetal'],
};
const descriptions: Record<string, Translation> = {
 'FP-ROUND':['Polygonal disc; radius, oriented opening, optional ring.','多边形圆盘；半径、定向开口、可选环形。','Disco poligonal; radio, abertura orientada y anillo opcional.','Disco poligonal; raio, abertura orientada e anel opcional.'],
 'FP-OVAL':['Ellipse, usually with marked longitudinal orientation.','椭圆，通常有明显纵向方向。','Elipse, generalmente con orientación longitudinal marcada.','Elipse, geralmente com orientação longitudinal marcada.'],
 'FP-SQUARE':['Four orthogonal walls, optional canopy.','四面正交墙，可选雨棚。','Cuatro muros ortogonales, alero opcional.','Quatro paredes ortogonais, cobertura opcional.'],
 'FP-RECT':['Configurable ratio, common in dwellings and halls.','比例可配置，常用于住宅和大厅。','Proporción configurable, habitual en viviendas y salas.','Proporção configurável, comum em moradias e salões.'],
 'FP-LONG':['Longhouse, hall, basilica; repeated bays.','长屋、大厅、巴西利卡；重复开间。','Casa larga, sala, basílica; tramos repetidos.','Casa longa, salão, basílica; vãos repetidos.'],
 'FP-L':['Two wings, courtyard open on two sides.','两翼，庭院两侧开放。','Dos alas, patio abierto por dos lados.','Duas alas, pátio aberto em dois lados.'],
 'FP-U':['Three wings framing a courtyard.','三翼围绕庭院。','Tres alas enmarcan un patio.','Três alas enquadram um pátio.'],
 'FP-COMPLEX':['Union of several rectangles, joined or separate.','多个相连或分离矩形的组合。','Unión de varios rectángulos, juntos o separados.','União de vários retângulos, juntos ou separados.'],
 'FP-COURT':['Solid footprint minus central void.','实体占地减去中央空隙。','Huella maciza menos vacío central.','Implantação maciça menos vazio central.'],
 'FP-POLYGON':['Five to twelve sides, dwellings and towers.','五至十二边，用于住宅和塔楼。','De cinco a doce lados, viviendas y torres.','De cinco a doze lados, moradias e torres.'],
 'FP-TOWER':['Square, round or polygonal footprint; tall elevation.','方形、圆形或多边形占地；高度较大。','Huella cuadrada, redonda o poligonal; gran altura.','Implantação quadrada, redonda ou poligonal; grande altura.'],
 'FP-APSIDAL':['Rectangle plus semicircular end.','矩形加半圆形端部。','Rectángulo con extremo semicircular.','Retângulo com extremidade semicircular.'],
 'FP-TRICONCH':['Central volume plus three apses.','中央体量加三个半圆后殿。','Volumen central más tres ábsides.','Volume central mais três absides.'],
 'FP-CROSS':['Intersection of perpendicular volumes.','垂直体量的交叉。','Intersección de volúmenes perpendiculares.','Interseção de volumes perpendiculares.'],
 'FP-TERRACE':['Nested diminishing polygons, axial stairs.','嵌套递减多边形，轴向楼梯。','Polígonos decrecientes encajados, escalera axial.','Polígonos decrescentes encaixados, escada axial.'],
 'FP-ELLIPTICAL-RING':['Dwellings and outbuildings around an enclosure.','住宅和附属建筑围绕围合区域。','Viviendas y anexos alrededor de un recinto.','Moradias e anexos ao redor de um recinto.'],
 'FP-ROCKCUT':['Void subtracted from terrain rather than a placed object.','从地形中减去的空腔，而非放置的物体。','Vacío sustraído del terreno en vez de objeto colocado.','Vazio subtraído do terreno em vez de objeto colocado.'],
 'FP-MULTICELL':['Repeated small compact rooms and courtyards.','重复的小型紧凑房间和庭院。','Repetición de pequeñas habitaciones compactas y patios.','Repetição de pequenos cômodos compactos e pátios.'],
 'FP-CLUSTER-ROUND':['Three to twelve discs inside an enclosure.','围合内三至十二个圆盘。','De tres a doce discos dentro de un recinto.','De três a doze discos dentro de um recinto.'],
 'FP-IRREGULAR':['Construction adapted to terrain and rocks.','适应地形和岩石的建筑。','Construcción adaptada al terreno y las rocas.','Construção adaptada ao terreno e às rochas.'],
 'RF-CONE':['Eaves radius, pitch, apex, thatch.','檐口半径、坡度、顶点、茅草。','Radio del alero, pendiente, punta y paja.','Raio do beiral, inclinação, ponta e palha.'],
 'RF-GABLE':['Ridge direction, pitch, overhangs, gables.','屋脊方向、坡度、出檐、山墙。','Dirección de cumbrera, pendiente, aleros y hastiales.','Direção da cumeeira, inclinação, beirais e empenas.'],
 'RF-HIP':['Pitches, hip ridges, ridge height.','坡度、斜脊、屋脊高度。','Pendientes, limatesas y altura de cumbrera.','Inclinações, rincões e altura da cumeeira.'],
 'RF-FLAT':['Parapet, access, water drainage.','女儿墙、通道、排水。','Pretil, acceso y desagüe.','Parapeito, acesso e drenagem.'],
 'RF-SHED':['Single slope; secondary buildings.','单坡；附属建筑。','Una vertiente; edificios secundarios.','Uma água; edifícios secundários.'],
 'RF-DOME':['Radius, possible oculus, covering.','半径、可选圆顶开口、覆盖物。','Radio, posible óculo y cubierta.','Raio, possível óculo e cobertura.'],
 'RF-THATCH-VAULT':['Curved roof over a flexible frame.','柔性框架上的弧形屋顶。','Techo curvo sobre estructura flexible.','Telhado curvo sobre estrutura flexível.'],
 'RF-VAULT':['Vault axis, closed or open ends.','拱轴，封闭或开放端部。','Eje de bóveda, extremos cerrados o abiertos.','Eixo da abóbada, extremidades fechadas ou abertas.'],
 'RF-CROSSVAULT':['Orthogonal intersection.','正交交叉。','Cruce ortogonal.','Cruzamento ortogonal.'],
 'RF-STEP':['Terraces / plan reductions at each level.','每层的台地 / 平面收分。','Terrazas / reducción de planta por nivel.','Terraços / redução de planta por nível.'],
 'RF-EAVES':['Overhang and peripheral gallery.','悬挑与外围廊道。','Vuelo y galería perimetral.','Balanço e galeria periférica.'],
 'RF-CURVED':['Curved pitch, raised hip ridges, tiles; not universal in Asia.','曲线坡面、上翘斜脊、瓦片；并非亚洲普遍特征。','Pendiente curva, limatesas alzadas, tejas; no universal en Asia.','Inclinação curva, rincões erguidos, telhas; não é universal na Ásia.'],
 'RF-TIERED':['Two to five pavilions with diminishing footprints.','两个至五个占地递减的亭阁。','De dos a cinco pabellones de huella decreciente.','De dois a cinco pavilhões de implantação decrescente.'],
 'RF-REED-HIP':['Tall thatched volume, wide overhang.','高大茅草体量，宽出檐。','Gran volumen de paja, alero ancho.','Alto volume de palha, amplo beiral.'],
 'RF-TENT':['Poles, canvas/felt, demountable assembly.','杆、帆布 / 毡，可拆卸结构。','Postes, lona/fieltro, montaje desmontable.','Postes, lona/feltro, montagem desmontável.'],
 'RF-SADDLE':['Longitudinal curve, saddle ridge.','纵向曲线，鞍形屋脊。','Curva longitudinal, cumbrera en silla.','Curva longitudinal, cumeeira em sela.'],
 'RF-GAMBREL':['Rare / chronologically filtered before the modern period.','罕见 / 近代以前按年代筛选。','Poco frecuente / filtrada cronológicamente antes de la época moderna.','Rara / filtrada cronologicamente antes da época moderna.'],
 'RF-DOME-CONE':['Circular/polygonal drum, dome.','圆形 / 多边形鼓座，穹顶。','Tambor circular/poligonal y cúpula.','Tambor circular/poligonal e cúpula.'],
 'RF-STEEP-STEP':['Stepped façade profile.','阶梯状立面轮廓。','Perfil de fachada escalonado.','Perfil de fachada escalonado.'],
 'RF-MULTIPAV':['Several orthogonal volumes, multiple junctions.','多个正交体量，多个连接处。','Varios cuerpos ortogonales y múltiples uniones.','Vários corpos ortogonais e múltiplas junções.'],
 'RF-SNOW':['Seasonal Arctic dwelling.','北极季节性住宅。','Vivienda ártica estacional.','Moradia ártica sazonal.'],
 'RF-SHELL':['Large curved thatch sheet over timber/bamboo arches.','木 / 竹拱上的大型曲面茅草覆盖。','Gran superficie curva de paja sobre arcos de madera/bambú.','Grande superfície curva de palha sobre arcos de madeira/bambu.'],
};
function translate(map:Record<string,Translation>,id:string,fallback:string):string {
 const locale=typeof window==='undefined'?'fr':savedLocale(); if(locale==='fr')return fallback;
 const i=(['en','zh','es','pt'] as const).indexOf(locale);return i>=0?map[id]?.[i]??fallback:fallback;
}
export const houseGeometryLabel=(id:string,fallback:string):string=>translate(labels,id,fallback);
export const houseGeometryDescription=(id:string,fallback:string):string=>translate(descriptions,id,fallback);
