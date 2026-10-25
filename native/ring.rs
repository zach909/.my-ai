//! Fixed-capacity circular buffer that overwrites its oldest entry when full,
//! with the same head / tail / size bookkeeping as `InfiniteZipLoop`.

pub struct Ring<T> {
    slots: Vec<Option<T>>,
    head: usize, // next write position
    tail: usize, // oldest valid entry
    size: usize,
}

impl<T> Ring<T> {
    /// A capacity of 0 is raised to 1 so a write always has somewhere to go.
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Ring { slots: (0..capacity).map(|_| None).collect(), head: 0, tail: 0, size: 0 }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    pub fn len(&self) -> usize {
        self.size
    }

    pub fn is_empty(&self) -> bool {
        self.size == 0
    }

    /// Store `item`. When the ring is full the oldest entry is dropped and
    /// returned.
    pub fn push(&mut self, item: T) -> Option<T> {
        let dropped = if self.size == self.slots.len() {
            let old = self.slots[self.tail].take();
            self.tail = (self.tail + 1) % self.slots.len();
            old
        } else {
            self.size += 1;
            None
        };
        self.slots[self.head] = Some(item);
        self.head = (self.head + 1) % self.slots.len();
        dropped
    }

    /// Oldest to newest.
    pub fn iter(&self) -> impl Iterator<Item = &T> + '_ {
        let cap = self.slots.len();
        (0..self.size).filter_map(move |i| self.slots[(self.tail + i) % cap].as_ref())
    }

    /// The `n` newest entries, oldest first.
    pub fn recent(&self, n: usize) -> Vec<&T> {
        let skip = self.size.saturating_sub(n);
        self.iter().skip(skip).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_without_dropping() {
        let mut r = Ring::new(3);
        assert!(r.push(1).is_none());
        assert!(r.push(2).is_none());
        assert_eq!(r.len(), 2);
        assert_eq!(r.iter().copied().collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn overwrites_oldest_when_full() {
        let mut r = Ring::new(3);
        for i in 1..=3 {
            r.push(i);
        }
        assert_eq!(r.push(4), Some(1));
        assert_eq!(r.push(5), Some(2));
        assert_eq!(r.len(), 3);
        assert_eq!(r.iter().copied().collect::<Vec<_>>(), vec![3, 4, 5]);
    }

    #[test]
    fn never_grows_past_capacity() {
        let mut r = Ring::new(4);
        for i in 0..1000 {
            r.push(i);
        }
        assert_eq!(r.len(), 4);
        assert_eq!(r.capacity(), 4);
        assert_eq!(r.iter().copied().collect::<Vec<_>>(), vec![996, 997, 998, 999]);
    }

    #[test]
    fn recent_returns_newest_oldest_first() {
        let mut r = Ring::new(5);
        for i in 0..8 {
            r.push(i);
        }
        assert_eq!(r.recent(2), vec![&6, &7]);
        assert_eq!(r.recent(99).len(), 5);
    }

    #[test]
    fn zero_capacity_still_works() {
        let mut r = Ring::new(0);
        r.push('a');
        assert_eq!(r.push('b'), Some('a'));
        assert_eq!(r.len(), 1);
    }
}
