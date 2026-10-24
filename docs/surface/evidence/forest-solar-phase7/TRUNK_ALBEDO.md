# Trunk colour concern: strict current-consumer control

The V15 review correctly flagged a grey/brown trunk difference in the historical
albedo microprobe PNG pair. Those runs did not retain before/after native-source
snapshots. The exact earlier diagnostic override could not be recovered; its
trunk region must not be treated as a controlled production comparison. The
original PNGs and review are preserved.

A new paired control uses the **same current high MultiMesh production shader**,
same camera/transforms and the old/corrected source products. It adds only
`unshaded`, hides leaf surfaces and leaves ALBEDO, texture samplers, factors and
UV code untouched. [Trunk/branches before](trunk-before.png) and
[after](trunk-after.png) are identical pixel-for-pixel. The imported branch and
trunk texture formats, bytes, factors and UV transforms also match; only the
leaf texture differs. [proof.json](proof.json), `trunkGpu`, contains the report
and explicit texture-hash encoding used by this diagnostic.

CPU GLB inspection additionally shows separate base-colour images: branch
texture1/image1, leaf texture4/image4 and trunk texture7/image7. The producer
fix changes only the leaf image's buffer view, retaining all original BIN bytes
and every other image view. The trunk does not share the replaced atlas.

This closes the **current producer/consumer trunk regression hypothesis** for
the tested source product. It does not reconstruct the old untracked override,
prove arbitrary material/lighting parity or silently repair historical evidence.
No production colour gain or trunk colour change was added for this audit.
