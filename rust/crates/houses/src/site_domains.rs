//! Memoize only the two immutable rights cuts of one plan_one invocation.
//! Pointer keys identify borrowed, live Surface objects; they are never
//! dereferenced and never survive the scope. Other boolean calls are unchanged.
use super::*;
use std::{cell::RefCell, marker::PhantomData};

type Key = (usize, usize);
#[derive(Default)]
struct Memo { cuts: Vec<(Key, Option<Surface>)>, hits: usize, misses: usize }
thread_local! { static MEMO: RefCell<Memo> = RefCell::new(Memo::default()); }
fn key(a: &Surface, b: &Surface) -> Key { (a as *const Surface as usize, b as *const Surface as usize) }

pub(crate) struct Scope<'a> { previous: Memo, _inputs: PhantomData<(&'a Surface, std::rc::Rc<()>)> }
impl<'a> Scope<'a> {
    pub(crate) fn open(buildable: &'a Surface, cadastral: &'a Surface, reserves: &'a Surface) -> Self {
        let cuts = if std::env::var_os("HOUSES_NO_SITE_DOMAIN_CACHE").is_some() { vec![] }
            else { vec![(key(buildable, reserves), None), (key(cadastral, reserves), None)] };
        Self { previous: MEMO.with(|memo| memo.replace(Memo { cuts, ..Memo::default() })), _inputs: PhantomData }
    }
}
impl Drop for Scope<'_> {
    fn drop(&mut self) {
        let current = MEMO.with(|memo| memo.replace(std::mem::take(&mut self.previous)));
        if std::env::var_os("HOUSES_SITE_DOMAIN_STATS").is_some() {
            eprintln!("site-domains hits={} misses={}", current.hits, current.misses);
        }
    }
}
pub(super) fn get(a: &Surface, b: &Surface) -> Option<Surface> {
    MEMO.with(|memo| {
        let mut memo = memo.borrow_mut();
        let result = memo.cuts.iter().find(|(k, _)| *k == key(a, b)).and_then(|(_, value)| value.clone());
        if result.is_some() { memo.hits += 1; }
        result
    })
}
pub(super) fn store(a: &Surface, b: &Surface, result: &Surface) {
    MEMO.with(|memo| {
        let mut memo = memo.borrow_mut();
        if let Some((_, slot)) = memo.cuts.iter_mut().find(|(k, _)| *k == key(a, b)) {
            *slot = Some(result.clone());
            memo.misses += 1;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_rights_cuts_are_exact_and_nested_scopes_restore_their_owner() {
        let buildable=rectangle(-0.0, 1.2, 37.7, 41.8);
        let cadastral=rectangle(-5.0, -4.0, 80.0, 90.0);
        let reserves=rectangle(4.2, 5.7, 11.3, 17.9);
        let expected=difference(&buildable, &reserves);
        let _scope=Scope::open(&buildable, &cadastral, &reserves);
        let first=difference(&buildable, &reserves);
        assert_eq!(serde_json::to_vec(&first).unwrap(), serde_json::to_vec(&expected).unwrap());
        assert!(get(&buildable, &reserves).is_some());
        {
            let other=rectangle(100.0, 200.0, 300.0, 400.0);
            let _nested=Scope::open(&other, &cadastral, &reserves);
            assert!(get(&buildable, &reserves).is_none());
            difference(&other, &reserves);
        }
        assert_eq!(serde_json::to_vec(&difference(&buildable, &reserves)).unwrap(), serde_json::to_vec(&expected).unwrap());
    }
    #[test]
    fn unregistered_mutable_surfaces_are_never_cached() {
        let buildable=rectangle(0.0, 0.0, 20.0, 20.0);
        let cadastral=buildable.clone(); let reserves=rectangle(1.0,1.0,2.0,2.0);
        let _scope=Scope::open(&buildable, &cadastral, &reserves);
        let mut trial=buildable.clone();
        difference(&trial, &reserves);
        assert!(get(&trial, &reserves).is_none());
        trial[0].outer[0].x=-8.0;
        let result=difference(&trial, &reserves);
        assert_eq!(result, from_geo(&to_geo(&trial).difference(&to_geo(&reserves))));
    }
}
