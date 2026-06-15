export type ContourShapeMethod = "i1" | "i2" | "i3";

export type ContourShapeParams = {
  method: ContourShapeMethod;
  contourThreshold: number;
  shapeWeight: number;
  areaWeight: number;
  centroidWeight: number;
  emptyPenalty: number;
};

export const DEFAULT_CONTOUR_SHAPE_PARAMS: ContourShapeParams = {
  method: "i1",
  contourThreshold: 96,
  shapeWeight: 0.65,
  areaWeight: 0.2,
  centroidWeight: 0.15,
  emptyPenalty: 100,
};

type ContourShapeFeatures = {
  area: number;
  centroidX: number;
  centroidY: number;
  spreadX: number;
  spreadY: number;
  diagonal: number;
};

type ForegroundPredicate = (value: number) => boolean;

export function getContourShapeScore(
  left: Uint8ClampedArray,
  right: Uint8ClampedArray,
  width: number,
  height: number,
  params: ContourShapeParams,
  isForeground: ForegroundPredicate,
) {
  const leftShape = getContourShapeFeatures(left, width, height, isForeground);
  const rightShape = getContourShapeFeatures(right, width, height, isForeground);

  if (leftShape.area === 0 || rightShape.area === 0) {
    return leftShape.area === rightShape.area ? 0 : clampScore(params.emptyPenalty);
  }

  const areaScore = (Math.abs(leftShape.area - rightShape.area) / Math.max(leftShape.area, rightShape.area, 1)) * 100;
  const centroidScore =
    (Math.hypot(leftShape.centroidX - rightShape.centroidX, leftShape.centroidY - rightShape.centroidY) / Math.max(1, leftShape.diagonal)) * 100;
  const shapeScore =
    ((Math.abs(leftShape.spreadX - rightShape.spreadX) + Math.abs(leftShape.spreadY - rightShape.spreadY)) /
      Math.max(1, leftShape.spreadX + leftShape.spreadY + rightShape.spreadX + rightShape.spreadY)) *
    200;
  const methodBias = params.method === "i2" ? 1.15 : params.method === "i3" ? 0.9 : 1;

  return clampScore(
    getWeightedScore([
      [shapeScore * methodBias, params.shapeWeight],
      [areaScore, params.areaWeight],
      [centroidScore, params.centroidWeight],
    ]),
  );
}

function getContourShapeFeatures(alpha: Uint8ClampedArray, width: number, height: number, isForeground: ForegroundPredicate): ContourShapeFeatures {
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const weight = isForeground(alpha[y * width + x] ?? 0) ? 1 : 0;

      if (weight === 0) {
        continue;
      }

      area += weight;
      sumX += x * weight;
      sumY += y * weight;
      sumXX += x * x * weight;
      sumYY += y * y * weight;
    }
  }

  const centroidX = area > 0 ? sumX / area : width / 2;
  const centroidY = area > 0 ? sumY / area : height / 2;
  const spreadX = area > 0 ? Math.sqrt(Math.max(0, sumXX / area - centroidX * centroidX)) : 0;
  const spreadY = area > 0 ? Math.sqrt(Math.max(0, sumYY / area - centroidY * centroidY)) : 0;

  return {
    area,
    centroidX,
    centroidY,
    spreadX,
    spreadY,
    diagonal: Math.hypot(width, height),
  };
}

function getWeightedScore(items: [score: number, weight: number][]) {
  let total = 0;
  let weightTotal = 0;

  items.forEach(([score, weight]) => {
    const safeWeight = Number.isFinite(weight) ? Math.max(0, weight) : 0;

    if (safeWeight <= 0) {
      return;
    }

    total += score * safeWeight;
    weightTotal += safeWeight;
  });

  return weightTotal > 0 ? total / weightTotal : 100;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 100));
}
