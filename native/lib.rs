//! NeuroClaw native kernels. Rust standard library only (no crates, no Cargo):
//! the repo takes no third-party code, so this is built with plain `rustc`
//! through `node scripts/build-native.mjs`.
//!
//! Each module mirrors an existing kernel so the two can be checked against
//! each other:
//!   - `hdmath` mirrors the vector operations in `asi_core/hyperdim_thinking.py`
//!   - `ring` mirrors the overwrite-oldest buffer in `InfiniteZipLoop`
//!     (`models && skills/core/zip-io.ts`)

pub mod hdmath;
pub mod ring;
