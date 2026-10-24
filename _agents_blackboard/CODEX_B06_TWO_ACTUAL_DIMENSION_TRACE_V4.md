# Two actual B06 traces - V4 compiler-only correction

V3 failed compilation before execution: E0277, ParentPlanBatch is Serialize-only. V3 and its root proof remain intact. V4 freeze `web/out/houses-single-growth-b06-trace-workspace-v4/implementation-freeze-b06-trace-v4.json`, SHA `4335331be190ccac35be1614a000f504b5902464b5d0936a1e899dc02fd069c0`.

Only `b06_restored_replay_trace.rs` changes among267 files. New proof-local ExpectedNonParentBatch derives Deserialize over existing typed refusal/open/material children and scalar counts; it ignores the decimal parent views. Physical authority remains every pinned native archive payload/checksum in exact parent order. No Deserialize was added to product DTOs, no codec/runtime/observation/guard/source/seed/site/need/budget changed. Both old golden failures remain visible. Trace-plan byte-identical SHA02ea2ef4fbf5745a8480095cf0fe268d0387e9d8d8254d1ddd1d459e2649248c.

Root-only command and new target/out paths are in V4 DELIVERY.md. Same ignored test `single_growth_b06_actual_0012_0100_exact_prefix_dimension_trace`. No build/test/native/product by author. Causal question remains the first actual aspect/rights/terrain/anchor/budget refusal for0012/a2848c... and0100/74af988d...; no new candidate or heuristic.
