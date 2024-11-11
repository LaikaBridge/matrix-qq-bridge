use std::{collections::HashMap, io::Cursor};

use image::ImageReader;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn calc_dominant_color(img: &[u8]) -> Result<Box<[u8]>, String> {
    let data = ImageReader::new(Cursor::new(img))
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|e| e.to_string())?;

    let mut histogram = HashMap::new();
    for (_, _, p) in data.into_rgb8().enumerate_pixels() {
        let color16 = p.0.map(|x| ((x as u32 * 15) / 255) as u8);
        *histogram.entry(color16).or_insert(0u32) += 1u32;
    }

    let mut histogram: Vec<_> = histogram.into_iter().collect();
    histogram.sort_unstable_by_key(|([r, g, b], count)| {
        (r.max(g).max(b) - r.min(g).min(b)) as u32 * count
    });
    Ok(histogram.last().copied().unwrap_or_default().0.into())
}
