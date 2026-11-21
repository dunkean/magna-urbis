//! Scoped conversion counters for regression tests.
use std::cell::RefCell;

thread_local! {
    static COUNTS: RefCell<Option<[usize; 4]>> = const { RefCell::new(None) };
}

pub(crate) fn record_conversion(index: usize) {
    COUNTS.with(|slot| {
        if let Some(counts) = slot.borrow_mut().as_mut() {
            counts[index] += 1;
        }
    });
}

/// Measure conversions on the current thread. Counts are polygons, simplified
/// validations, raw validations, and raw fallbacks, in that order.
pub fn measure_conversions<T>(run: impl FnOnce() -> T) -> (T, [usize; 4]) {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            COUNTS.with(|slot| {
                slot.replace(None);
            });
        }
    }

    COUNTS.with(|slot| {
        let mut counts = slot.borrow_mut();
        assert!(counts.is_none(), "No nested measurement");
        *counts = Some([0; 4]);
    });
    let guard = Reset;
    let result = run();
    let counts = COUNTS.with(|slot| slot.borrow().expect("Active scoped counters"));
    drop(guard);
    (result, counts)
}
