import Jimp from "jimp";
const colors = {
    "🔴": rgb2lab([221, 46, 68]),
    "🔵": rgb2lab([85, 172, 238]),
    "🟠": rgb2lab([244, 144, 12]),
    "🟡": rgb2lab([253, 203, 88]),
    "🟢": rgb2lab([120, 177, 89]),
    "🟣": rgb2lab([170, 142, 214]),
    "🟤": rgb2lab([193, 105, 79]),
    "⚫": rgb2lab([49, 55, 61]),
    "⚪": rgb2lab([230, 231, 232]),
};

//converse rgb to lab
function rgb2lab(rgb: number[]): number[] {
    let r = rgb[0] / 255,
        g = rgb[1] / 255,
        b = rgb[2] / 255,
        x,
        y,
        z;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
    y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
    z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function cie94(labA: number[], labB: number[]) {
    var deltaL = labA[0] - labB[0];
    var deltaA = labA[1] - labB[1];
    var deltaB = labA[2] - labB[2];
    var c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
    var c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
    var deltaC = c1 - c2;
    var deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
    deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
    var sc = 1.0 + 0.045 * c1;
    var sh = 1.0 + 0.015 * c1;
    var deltaLKlsl = deltaL / 1.0;
    var deltaCkcsc = deltaC / sc;
    var deltaHkhsh = deltaH / sh;
    var i =
        deltaLKlsl * deltaLKlsl +
        deltaCkcsc * deltaCkcsc +
        deltaHkhsh * deltaHkhsh;
    return i < 0 ? 0 : Math.sqrt(i);
}

export async function sampleColor(imgArray: Uint8Array) {
    const img = await Jimp.read(Buffer.from(imgArray));
    let colorCount: Record<string, number> = {};
    for (let x = 0; x < img.getWidth(); x++) {
        for (let y = 0; y < img.getHeight(); y++) {
            const color = img.getPixelColor(x, y);
            const { r, g, b, a } = Jimp.intToRGBA(color);
            const color256 = [r, g, b].map(
                (x) => x * (a / 255) + 255 * (1 - a / 255),
            );
            const color16 = color256.map((x) => Math.round((x / 255) * 15));
            colorCount[JSON.stringify(color16)] =
                (colorCount[JSON.stringify(color16)] ?? 0) + 1;
        }
    }
    const rgb16 = Object.entries(colorCount)
        .map((kv) => {
            const [k, count] = kv;
            const [r, g, b]: number[] = JSON.parse(k);
            return {
                color16: [r, g, b],
                weight:
                    /* chroma */ (Math.max(r, g, b) - Math.min(r, g, b)) *
                    count,
            };
        })
        .sort((a, b) => a.weight - b.weight)
        .reverse()[0].color16;
    const lab = rgb2lab(rgb16.map((x) => (x / 15) * 255));
    return Object.entries(colors).sort(
        (a, b) => cie94(a[1] as number[], lab) - cie94(b[1] as number[], lab),
    )[0][0] as string;
}
