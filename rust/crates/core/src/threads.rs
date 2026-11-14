//! Process start-up policy for the native generator threads.
//!
//! Windows applies EcoQoS (execution-speed throttling) to windowless background processes such
//! as the engine: their threads are steered to the efficiency cores of hybrid CPUs at low clocks,
//! and a 1M-inhabitant town ran twice slower with the efficiency cores allowed than without.
//! `configure` turns that throttling off for the process, which recovers the speed and keeps the
//! efficiency cores useful (measured faster than performance cores only), and sizes rayon's global
//! pool to the allowed logical processors minus a reserve for the desktop. Results never depend
//! on the thread count (see `urban::par`).
//!
//! `MAGNA_CORES=performance` also restricts the process to the performance cores its affinity
//! allows (highest efficiency class; never widened; left unchanged when the intersection is empty
//! or the machine has one class). An explicit `RAYON_NUM_THREADS` or `URBAN_THREADS` keeps its
//! thread count. Systems other than Windows keep their affinity and scheduling unchanged.

/// What `configure` found and applied, for the start-up log line.
#[derive(Clone, Debug)]
pub struct Applied {
    /// Logical processors in the system (Windows processor group 0), 0 when unknown.
    pub logical: usize,
    /// Logical processors of the highest efficiency class (all of them on a single-class machine).
    pub performance: usize,
    /// Process affinity before and after (0 when unknown).
    pub mask_before: u64,
    pub mask_after: u64,
    /// Rayon global pool size, and whether it came from the environment.
    pub threads: usize,
    pub threads_from_env: bool,
    /// Whether Windows execution-speed throttling (EcoQoS) was turned off for the process.
    pub throttling_off: bool,
}

impl std::fmt::Display for Applied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "[threads] {} performance of {} logical cores; affinity {:#X} -> {:#X}; {} rayon threads{}; power throttling {}",
            self.performance,
            self.logical,
            self.mask_before,
            self.mask_after,
            self.threads,
            if self.threads_from_env { " (from environment)" } else { "" },
            if self.throttling_off { "off" } else { "unchanged" },
        )
    }
}

/// Applies the policy once, at process start, before rayon's global pool is used. `reserve`
/// logical processors are left to the rest of the machine.
pub fn configure(reserve: usize) -> Applied {
    let performance_only = std::env::var("MAGNA_CORES").is_ok_and(|v| v.trim().eq_ignore_ascii_case("performance"));
    let (logical, performance_mask) = sys::performance_mask();
    let mask_before = sys::process_mask();
    let mut mask_after = mask_before;
    // Never widen an affinity set on purpose; leave it when no performance core is allowed.
    if performance_only && performance_mask != 0 && mask_before != 0 {
        let wanted = mask_before & performance_mask;
        if wanted != 0 && wanted != mask_before && sys::set_process_mask(wanted) {
            mask_after = wanted;
        }
    }
    let throttling_off = sys::disable_power_throttling();
    let env_threads = |name: &str| std::env::var(name).ok().and_then(|v| v.trim().parse::<usize>().ok()).filter(|n| *n > 0);
    let (threads, threads_from_env) = match (env_threads("RAYON_NUM_THREADS"), env_threads("URBAN_THREADS")) {
        // rayon reads RAYON_NUM_THREADS itself.
        (Some(n), _) => (n, true),
        (None, Some(n)) => {
            let _ = rayon::ThreadPoolBuilder::new().num_threads(n).build_global();
            (n, true)
        }
        (None, None) => {
            let allowed = if mask_after != 0 {
                mask_after.count_ones() as usize
            } else {
                std::thread::available_parallelism().map_or(2, |n| n.get())
            };
            let n = allowed.saturating_sub(reserve).max(1);
            let _ = rayon::ThreadPoolBuilder::new().num_threads(n).build_global();
            (n, false)
        }
    };
    Applied {
        logical,
        performance: if performance_mask != 0 { performance_mask.count_ones() as usize } else { logical },
        mask_before,
        mask_after,
        threads,
        threads_from_env,
        throttling_off,
    }
}

#[cfg(windows)]
mod sys {
    use std::ffi::c_void;
    type Handle = *mut c_void;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentProcess() -> Handle;
        fn GetSystemCpuSetInformation(info: *mut u8, length: u32, returned: *mut u32, process: Handle, flags: u32) -> i32;
        fn GetProcessAffinityMask(process: Handle, process_mask: *mut usize, system_mask: *mut usize) -> i32;
        fn SetProcessAffinityMask(process: Handle, mask: usize) -> i32;
        fn SetProcessInformation(process: Handle, class: i32, info: *const c_void, size: u32) -> i32;
    }

    /// (logical processors, mask of the highest efficiency class) in processor group 0. The mask
    /// is 0 when the machine has one class only (nothing to restrict), more than one processor
    /// group, or the query fails.
    pub fn performance_mask() -> (usize, u64) {
        let mut length = 0u32;
        // SAFETY: a null buffer of length 0 only asks for the needed length.
        unsafe { GetSystemCpuSetInformation(std::ptr::null_mut(), 0, &mut length, std::ptr::null_mut(), 0) };
        if length == 0 {
            return (0, 0);
        }
        let mut buffer = vec![0u64; (length as usize).div_ceil(8)];
        // SAFETY: the buffer holds `length` bytes, 8-byte aligned.
        if unsafe { GetSystemCpuSetInformation(buffer.as_mut_ptr().cast(), length, &mut length, std::ptr::null_mut(), 0) } == 0 {
            return (0, 0);
        }
        // SAFETY: the buffer outlives the byte view and holds at least `length` bytes.
        let bytes = unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), length as usize) };
        // SYSTEM_CPU_SET_INFORMATION: Size u32 @0, Type u32 @4 (0 = CpuSetInformation),
        // Group u16 @12, LogicalProcessorIndex u8 @14, EfficiencyClass u8 @18.
        let mut cpus: Vec<(u8, u8)> = Vec::new();
        let mut offset = 0usize;
        while offset + 20 <= bytes.len() {
            let size = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
            if size < 20 {
                break;
            }
            let kind = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
            if kind == 0 {
                let group = u16::from_le_bytes(bytes[offset + 12..offset + 14].try_into().unwrap());
                if group != 0 || bytes[offset + 14] >= 64 {
                    return (0, 0);
                }
                cpus.push((bytes[offset + 14], bytes[offset + 18]));
            }
            offset += size;
        }
        let Some(top) = cpus.iter().map(|c| c.1).max() else { return (0, 0) };
        if cpus.iter().all(|c| c.1 == top) {
            return (cpus.len(), 0);
        }
        let mask = cpus.iter().filter(|c| c.1 == top).fold(0u64, |m, c| m | (1u64 << c.0));
        (cpus.len(), mask)
    }

    pub fn process_mask() -> u64 {
        let (mut process, mut system) = (0usize, 0usize);
        // SAFETY: plain out-parameters on the current process pseudo-handle.
        if unsafe { GetProcessAffinityMask(GetCurrentProcess(), &mut process, &mut system) } == 0 {
            return 0;
        }
        process as u64
    }

    pub fn set_process_mask(mask: u64) -> bool {
        // SAFETY: the mask is a subset of the current process affinity.
        unsafe { SetProcessAffinityMask(GetCurrentProcess(), mask as usize) != 0 }
    }

    /// Turns execution-speed throttling (EcoQoS, which Windows applies to windowless background
    /// processes and steers to efficiency cores) off for the whole process.
    pub fn disable_power_throttling() -> bool {
        #[repr(C)]
        struct PowerThrottlingState {
            version: u32,
            control_mask: u32,
            state_mask: u32,
        }
        const PROCESS_POWER_THROTTLING: i32 = 4;
        const EXECUTION_SPEED: u32 = 1;
        let state = PowerThrottlingState { version: 1, control_mask: EXECUTION_SPEED, state_mask: 0 };
        // SAFETY: a valid PROCESS_POWER_THROTTLING_STATE of the size given.
        unsafe {
            SetProcessInformation(
                GetCurrentProcess(),
                PROCESS_POWER_THROTTLING,
                (&state as *const PowerThrottlingState).cast(),
                std::mem::size_of::<PowerThrottlingState>() as u32,
            ) != 0
        }
    }
}

/// Other systems: no efficiency-class query yet, every core stays allowed.
#[cfg(not(windows))]
mod sys {
    pub fn performance_mask() -> (usize, u64) {
        (std::thread::available_parallelism().map_or(0, |n| n.get()), 0)
    }
    pub fn process_mask() -> u64 {
        0
    }
    pub fn set_process_mask(_mask: u64) -> bool {
        false
    }
    pub fn disable_power_throttling() -> bool {
        false
    }
}
