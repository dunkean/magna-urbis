//! Global allocator of the shared-memory build (`threads` feature).
//!
//! std's wasm32 allocator with atomics is dlmalloc behind one spin lock (the
//! main thread may not block): with a rayon pool the allocation-heavy urban
//! kernels spend their time spinning on it and stop scaling. Blocks up to 64 KiB are
//! recycled through per-thread free lists, so most allocations and frees
//! never take the lock. Results do not depend on the allocator.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::UnsafeCell;
use std::ptr::null_mut;

const STEP: usize = 16;
/// Size classes 16, 32, ... 1024 bytes, then powers of two up to 64 KiB;
/// alignment up to 16.
const SMALL: usize = 64;
const CLASSES: usize = SMALL + 6;
/// Bytes a thread keeps per size class before frees go back to dlmalloc.
const CACHE_BYTES: usize = 128 * 1024;

struct Cache {
    heads: [*mut u8; CLASSES],
    counts: [u32; CLASSES],
}
thread_local! {
    static CACHE: UnsafeCell<Cache> = const {
        UnsafeCell::new(Cache { heads: [null_mut(); CLASSES], counts: [0; CLASSES] })
    };
}

pub struct ThreadCachingAlloc;

#[inline]
fn class(layout: &Layout) -> Option<usize> {
    let size = layout.size().max(1);
    if layout.align() > STEP {
        return None;
    }
    if size <= SMALL * STEP {
        return Some((size - 1) / STEP);
    }
    // 2 KiB -> SMALL, 4 KiB -> SMALL + 1, ... 64 KiB -> SMALL + 5.
    let class = SMALL + (size.next_power_of_two().trailing_zeros() as usize - 11);
    (class < CLASSES).then_some(class)
}
#[inline]
fn class_size(class: usize) -> usize {
    if class < SMALL {
        (class + 1) * STEP
    } else {
        2048 << (class - SMALL)
    }
}
#[inline]
fn class_layout(class: usize) -> Layout {
    // SAFETY: non-zero size multiple of 16, power-of-two alignment.
    unsafe { Layout::from_size_align_unchecked(class_size(class), STEP) }
}

unsafe impl GlobalAlloc for ThreadCachingAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let Some(c) = class(&layout) else {
            return unsafe { System.alloc(layout) };
        };
        let cached = CACHE
            .try_with(|cache| {
                let cache = unsafe { &mut *cache.get() };
                let head = cache.heads[c];
                if !head.is_null() {
                    // The first word of a free block links to the next one.
                    cache.heads[c] = unsafe { *(head as *mut *mut u8) };
                    cache.counts[c] -= 1;
                }
                head
            })
            .unwrap_or(null_mut());
        if cached.is_null() {
            unsafe { System.alloc(class_layout(c)) }
        } else {
            cached
        }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        let Some(c) = class(&layout) else {
            return unsafe { System.dealloc(ptr, layout) };
        };
        let kept = CACHE
            .try_with(|cache| {
                let cache = unsafe { &mut *cache.get() };
                if cache.counts[c] >= 2
                    && (cache.counts[c] as usize + 1) * class_size(c) > CACHE_BYTES
                {
                    return false;
                }
                unsafe { *(ptr as *mut *mut u8) = cache.heads[c] };
                cache.heads[c] = ptr;
                cache.counts[c] += 1;
                true
            })
            .unwrap_or(false);
        if !kept {
            unsafe { System.dealloc(ptr, class_layout(c)) }
        }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if class(&layout).is_none() {
            // Fresh dlmalloc memory may skip the memset.
            return unsafe { System.alloc_zeroed(layout) };
        }
        let ptr = unsafe { self.alloc(layout) };
        if !ptr.is_null() {
            unsafe { std::ptr::write_bytes(ptr, 0, layout.size()) };
        }
        ptr
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        // SAFETY (caller contract): new_size is valid for layout.align().
        let new_layout = unsafe { Layout::from_size_align_unchecked(new_size, layout.align()) };
        match (class(&layout), class(&new_layout)) {
            // Both large: dlmalloc may grow in place.
            (None, None) => unsafe { System.realloc(ptr, layout, new_size) },
            // Same small class: the block already has room.
            (Some(a), Some(b)) if a == b => ptr,
            _ => {
                let next = unsafe { self.alloc(new_layout) };
                if !next.is_null() {
                    unsafe {
                        std::ptr::copy_nonoverlapping(ptr, next, layout.size().min(new_size));
                        self.dealloc(ptr, layout);
                    }
                }
                next
            }
        }
    }
}
