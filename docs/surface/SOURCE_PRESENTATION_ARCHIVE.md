# Source presentation and live job styles

The live producer used to write the current mapper job's presentation into
`packet.source.presentation`. Source metadata can archive that exact path as a
null placeholder with separate bytes. Overwriting it made a complete
`restoreSurfaceSource(packet.source)` fail, even while the attachment bytes and
physical source data remained intact.

Future packets preserve `source` as the reversible source projection. The current
job style is emitted only in the existing `packet.presentation` namespace, already
preferred by the native presentation adapter. The worker's prepared source keeps
its default mapper profile separately, so the authored default remains available
even when the original source presentation was archived. Source presentation may
also be an unrelated opaque editor value; it is preserved rather than replaced.

No source-archive or physical schema/algorithm version changes. The archive bytes,
water rasters, geometry, native materials, terrain, context, candidates, supports,
IDs and physical versions remain unchanged. Style changes do not rebuild the
canonical environment. Complete first packets and compact known-scene packets
continue using the existing source/scene handshake; compact metadata must be
joined to its matching first scene before restoring the whole original source.

Regression tests exercise the actual decor preparation, live binary session,
worker processor, MUFSURF1 encoder/decoder and complete source restoration. They
check a different per-job style, an archived authored default, known-scene merging,
unchanged archive bytes, exact source values/types and bit-identical packet data
apart from the top-level presentation across style-only jobs. These are authored
CPU integration fixtures, not fresh neural/GPU evidence.

Previously affected packets remain historical negative compatibility evidence.
`restoreSurfaceSource` still strictly rejects an occupied attachment target.
There is no generic normalization, guessed null replacement or automatic repair
in this change. Any future recovery of such an old packet would need an explicit
packet-aware API that separately returns the original source and job presentation
with strict provenance guards; no such recovery API is claimed here.

This is a restoration/style compatibility fix. It does not explain or fix the
independently measured browser/Worker latency.
