port-params DONE. Report: web/out/fix-v7/port-params/result.md. Four inspected sheets + summary.json (18 combinations), all three default geometries exactly match harbour-opts archives.

Default numeric values: portDetachment=1, portShelter=0. Native default omissions in bridge must remain. Legacy shelteredHarbour=true maps to shelter 1 when no explicit numeric value; explicit 0 overrides.

Wall contract: layout.structure.portDistricts[] contains { district, role:"port", quarters, shapes }, exact quarter shapes after nucleus carve. Already consumed by wall-params. Hooks in quarters.rs add the dry extension before street ribbons / block cuts, update allocated/reserve, and split long port land into short blocks. Defaults bypass this path.

Tests: 13 harbour + 1 exact P33/P14 test; 3 web; TypeScript; dev example build; 18 witness validations with no wet ordinary streets, unchanged centres and port needs, valid masks outside nucleus. No engine/Vite changes, no commit. Supervisor rebuild and 2D/3D reshoot remain.
