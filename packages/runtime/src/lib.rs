#![deny(clippy::all)]

use std::{collections::HashMap, io::Cursor};

use napi_derive::napi;

#[napi]
pub fn plus_100(input: u32) -> u32 {
  input + 100
}

use image::ImageReader;

#[napi]
pub fn calc_dominant_color_napi(img: &[u8]) -> napi::Result<Vec<u8>> {
  calc_dominant_color(img)
    .map_err(|err| napi::Error::new(napi::Status::GenericFailure, err.to_string()))
}

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
