//! Hyperdimensional vector kernels, same semantics as `hyperdim_thinking.py`.

#[derive(Debug, PartialEq)]
pub struct DimensionMismatch {
    pub left: usize,
    pub right: usize,
}

fn check(a: &[f64], b: &[f64]) -> Result<(), DimensionMismatch> {
    if a.len() == b.len() {
        Ok(())
    } else {
        Err(DimensionMismatch { left: a.len(), right: b.len() })
    }
}

pub fn norm(a: &[f64]) -> f64 {
    a.iter().map(|x| x * x).sum::<f64>().sqrt()
}

/// Scale to unit length; a zero vector is returned unchanged.
pub fn normalized(a: &[f64]) -> Vec<f64> {
    let n = norm(a);
    if n > 1e-12 {
        a.iter().map(|x| x / n).collect()
    } else {
        a.to_vec()
    }
}

/// Elementwise multiply.
pub fn bind(a: &[f64], b: &[f64]) -> Result<Vec<f64>, DimensionMismatch> {
    check(a, b)?;
    Ok(a.iter().zip(b).map(|(x, y)| x * y).collect())
}

/// Inverse of `bind`; components of `b` near zero give 0.0.
pub fn unbind(a: &[f64], b: &[f64]) -> Result<Vec<f64>, DimensionMismatch> {
    check(a, b)?;
    Ok(a.iter().zip(b).map(|(x, y)| if y.abs() > 1e-9 { x / y } else { 0.0 }).collect())
}

/// Weighted elementwise mean, renormalised. `weights` of `None` means all 1.0.
/// Returns `None` when `vectors` is empty.
pub fn bundle(vectors: &[&[f64]], weights: Option<&[f64]>) -> Option<Result<Vec<f64>, DimensionMismatch>> {
    let first = *vectors.first()?;
    for v in vectors {
        if let Err(e) = check(first, v) {
            return Some(Err(e));
        }
    }
    let ones;
    let w = match weights {
        Some(w) => w,
        None => {
            ones = vec![1.0; vectors.len()];
            &ones
        }
    };
    let total: f64 = w.iter().sum();
    let total = if total == 0.0 { 1.0 } else { total };
    let mut acc = vec![0.0; first.len()];
    for (vec, wt) in vectors.iter().zip(w) {
        for (slot, x) in acc.iter_mut().zip(vec.iter()) {
            *slot += x * wt;
        }
    }
    for slot in acc.iter_mut() {
        *slot /= total;
    }
    Some(Ok(normalized(&acc)))
}

/// Cyclic shift right by `k` (any integer, negative shifts left).
pub fn permute(a: &[f64], k: i64) -> Vec<f64> {
    let n = a.len();
    if n == 0 {
        return Vec::new();
    }
    let k = k.rem_euclid(n as i64) as usize;
    let mut out = Vec::with_capacity(n);
    out.extend_from_slice(&a[n - k..]);
    out.extend_from_slice(&a[..n - k]);
    out
}

pub fn cosine_similarity(a: &[f64], b: &[f64]) -> Result<f64, DimensionMismatch> {
    check(a, b)?;
    let dot: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let denom = norm(a) * norm(b);
    Ok(if denom > 1e-12 { dot / denom } else { 0.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn bind_then_unbind_round_trips() {
        let a = [0.5, -2.0, 3.0];
        let b = [2.0, 4.0, -1.0];
        let back = unbind(&bind(&a, &b).unwrap(), &b).unwrap();
        assert!(back.iter().zip(&a).all(|(x, y)| close(*x, *y)));
    }

    #[test]
    fn unbind_zero_component_is_zero() {
        assert_eq!(unbind(&[1.0, 2.0], &[0.0, 2.0]).unwrap(), vec![0.0, 1.0]);
    }

    #[test]
    fn mismatch_is_reported() {
        assert_eq!(bind(&[1.0], &[1.0, 2.0]), Err(DimensionMismatch { left: 1, right: 2 }));
        assert!(cosine_similarity(&[1.0], &[1.0, 2.0]).is_err());
    }

    #[test]
    fn bundle_is_unit_length_and_weighted() {
        let a = [1.0, 0.0];
        let b = [0.0, 1.0];
        let even = bundle(&[&a, &b], None).unwrap().unwrap();
        assert!(close(norm(&even), 1.0));
        assert!(close(even[0], even[1]));
        let skew = bundle(&[&a, &b], Some(&[3.0, 1.0])).unwrap().unwrap();
        assert!(skew[0] > skew[1]);
        assert!(bundle(&[], None).is_none());
    }

    #[test]
    fn permute_matches_python_shift() {
        // python: a[-k:] + a[:-k]
        assert_eq!(permute(&[1.0, 2.0, 3.0, 4.0], 1), vec![4.0, 1.0, 2.0, 3.0]);
        assert_eq!(permute(&[1.0, 2.0, 3.0, 4.0], 5), vec![4.0, 1.0, 2.0, 3.0]);
        assert_eq!(permute(&[1.0, 2.0, 3.0, 4.0], -1), vec![2.0, 3.0, 4.0, 1.0]);
        assert_eq!(permute(&[1.0, 2.0, 3.0], 0), vec![1.0, 2.0, 3.0]);
        assert!(permute(&[], 3).is_empty());
    }

    #[test]
    fn cosine_basics() {
        assert!(close(cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]).unwrap(), 1.0));
        assert!(close(cosine_similarity(&[1.0, 0.0], &[0.0, 1.0]).unwrap(), 0.0));
        assert!(close(cosine_similarity(&[1.0, 0.0], &[-1.0, 0.0]).unwrap(), -1.0));
        assert_eq!(cosine_similarity(&[0.0, 0.0], &[1.0, 0.0]).unwrap(), 0.0);
    }
}
