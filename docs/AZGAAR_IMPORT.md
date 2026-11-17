# Importing an Azgaar FMG burg

Magna Urbis can build a town from a burg of [Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) (FMG).
In the V2 page, open **Open a code or link**, paste one of the inputs below and click **Load recipe**.
The imported town starts a fresh recipe: one town, on a map sized for its population.

## Accepted inputs

| Input | How to get it in FMG | What it carries |
|---|---|---|
| **Export script result** (recommended) | In Magna Urbis, click **Copy the Azgaar export script**. In FMG, press F12, paste the script into the console and press Enter, then type the burg name or id (the burg open in the Burg editor is proposed). The result is copied to the clipboard; paste it into Magna Urbis. | Everything below, including biome, precipitation, river, coast side and the culture's name base and type. |
| **Burgs overview CSV row** | Burgs overview → **Download** (CSV). Copy the header line and the burg's line, or the burg's line alone. | Name, population, culture name, type, elevation, temperature, capital, port, citadel, walls, plaza, temple, shanty town, preview link. |
| **Watabou link** | Burg editor → open the city preview, copy the watabou city or village generator URL. | Name, population, seed, river, coast side, walls, citadel, plaza, temple, shanty town, farms, road hub. |

A line without its header is read with FMG's column order; current FMG and the classic site (azgaar.github.io) are recognised by their number of columns.
The export script only reads the page (`pack`, `grid`, and `options` or the classic globals when present). It sends nothing over the network.

## What is mapped

- **Culture**: the culture's FMG name base (German, Arabic, Elven, …) chooses the Magna Urbis culture and toponym language. The default FMG culture names are also recognised.
- **Culture type**: Naval adds a port on a sea coast (or a coast when none is known); River adds a river when none is known; Nomadic and Hunting loosen the town; Highland raises the relief when the elevation is unknown. Lake has no effect yet.
- **Biome and climate**: the FMG biome gives the Magna Urbis biome and climate zone (Hot desert → desert, Cold desert → steppe zone, Savanna → savanna, Grassland → steppe or temperate by rain, forests → temperate, continental or Mediterranean by temperature, Taiga → nordic, Tundra and Glacier → arctic, Wetland → wetland). Without a biome, the zone comes from temperature and rain. Towns above 1,500 m in a temperate, continental or Mediterranean zone get the alpine zone.
- **Temperature and precipitation** become custom climate values: temperature brought to sea level with FMG's 6.5 °C per km, precipitation in mm per year (FMG's cell value × 100, as FMG shows it).
- **Elevation**: under 250 m flat, under 1,000 m hills, above that mountains (a valley for a river town).
- **River, coast, buildings, population**: as in the source; the watabou seed is kept when FMG provides one.
