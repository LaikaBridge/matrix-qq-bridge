use napi::{
  Error,
  bindgen_prelude::{Buffer, FromNapiValue, ToNapiValue},
  sys,
};

#[derive(Clone)]
pub struct ByteBuffer(pub Vec<u8>);

use std::fmt::Debug;
impl Debug for ByteBuffer {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.debug_struct("ByteBuffer")
      .field("len", &self.0.len())
      .finish_non_exhaustive()
  }
}
impl FromNapiValue for ByteBuffer {
  unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self, Error> {
    let buffer = unsafe { Buffer::from_napi_value(env, napi_val)? };
    Ok(ByteBuffer(buffer.as_ref().to_vec()))
  }
}

impl ToNapiValue for ByteBuffer {
  unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value, Error> {
    unsafe { Buffer::to_napi_value(env, val.0.into()) }
  }
}
