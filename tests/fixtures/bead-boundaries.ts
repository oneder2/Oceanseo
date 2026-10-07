export function boundaryScene() {
  const width = 64,
    height = 64;
  const colors = [
    [192, 76, 60],
    [64, 120, 176],
    [208, 188, 112],
  ];
  const data = new Uint8ClampedArray(width * height * 4),
    seams: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let rgb = x < 32 ? colors[0] : y < 32 ? colors[1] : colors[2];
      if (x === 31) {
        const other = y < 32 ? colors[1] : colors[2];
        rgb = colors[0].map((n, c) => (n + other[c]) / 2);
        seams.push(y * width + x);
      }
      if (y === 31 && x >= 32) {
        rgb = colors[1].map((n, c) => (n + colors[2][c]) / 2);
        seams.push(y * width + x);
      }
      if (x === 31 && y === 31)
        rgb = colors[0].map((n, c) => (n + colors[1][c] + colors[2][c]) / 3);
      if (x === 12 && y > 4 && y < 60) rgb = [8, 8, 8];
      if (x === 44 && y === 16) rgb = [255, 255, 255];
      data.set([...rgb, 255], (y * width + x) * 4);
    }
  return { width, height, data, seams, colors };
}

// A hard four-colour diagonal at high resolution: target-grid footprints
// intersect multiple regions, but the source contains no transition colours.
export function diagonalScene() {
  const width = 257,
    height = 257;
  const colors = [
    [220, 60, 50],
    [35, 90, 165],
    [235, 208, 80],
    [70, 155, 85],
  ];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rgb = colors[(x > y ? 1 : 0) + (x + y > 254 ? 2 : 0)];
      data.set([...rgb, 255], (y * width + x) * 4);
    }
  return { width, height, data, colors };
}
