export interface Camera {
  x: number;
  y: number;
  cell: number;
}
export interface Viewport {
  width: number;
  height: number;
}
export function fitCamera(
  width: number,
  height: number,
  viewport: Viewport,
): Camera {
  const cell = Math.max(
    1,
    Math.min(
      36,
      (viewport.width - 88) / width,
      (viewport.height - 76) / height,
    ),
  );
  return {
    cell,
    x: Math.max(44, (viewport.width - width * cell) / 2),
    y: Math.max(38, (viewport.height - height * cell) / 2),
  };
}
export function resizeCamera(
  camera: Camera,
  before: Viewport,
  after: Viewport,
): Camera {
  return {
    ...camera,
    x: camera.x + (after.width - before.width) / 2,
    y: camera.y + (after.height - before.height) / 2,
  };
}
export function zoomCamera(
  camera: Camera,
  factor: number,
  x: number,
  y: number,
): Camera {
  const cell = Math.max(1, Math.min(72, camera.cell * factor)),
    ratio = cell / camera.cell;
  return { cell, x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio };
}
