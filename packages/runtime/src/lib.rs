#![deny(clippy::all)]

pub mod qqbot;

use napi_derive::napi;
use std::{collections::HashMap, io::Cursor};
use time::macros::format_description;
use tracing_subscriber::{
  EnvFilter, Layer, fmt::time::UtcTime, layer::SubscriberExt, util::SubscriberInitExt,
};

#[napi]
pub fn plus_100(input: u32) -> u32 {
  input + 100
}

use image::ImageReader;

static INITIALIZE_ONCE: std::sync::Once = std::sync::Once::new();
#[napi]
pub fn initialize() -> bool {
  let mut initialized = false;
  INITIALIZE_ONCE.call_once(|| {
    initialized = true;
    let time_format = format_description!("[unix_timestamp precision:millisecond]");
    let timer = UtcTime::new(time_format);
    tracing_subscriber::registry()
      .with(
        tracing_subscriber::fmt::layer()
          .json()
          .with_timer(timer)
          .flatten_event(true)
          .with_filter(EnvFilter::from_default_env()),
      )
      .init();
  });
  initialized
}

#[napi]
pub fn calc_dominant_color(img: &[u8]) -> anyhow::Result<Vec<u8>> {
  let data = ImageReader::new(Cursor::new(img))
    .with_guessed_format()?
    .decode()?;

  let mut histogram = HashMap::new();
  for (_, _, p) in data.into_rgb8().enumerate_pixels() {
    let color16 = p.0.map(|x| ((x as u32 * 15) / 255) as u8);
    *histogram.entry(color16).or_insert(0u32) += 1u32;
  }

  let mut histogram: Vec<_> = histogram.into_iter().collect();
  histogram
    .sort_unstable_by_key(|([r, g, b], count)| (r.max(g).max(b) - r.min(g).min(b)) as u32 * count);
  Ok(histogram.last().copied().unwrap_or_default().0.into())
}
