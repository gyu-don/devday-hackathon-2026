export type FloorPoint = { x: number; z: number };
export const playerHome: FloorPoint = { x: -1.75, z: 2.5 };
const STEP = 0.25;

// Furniture footprints include the resident's radius so paths cannot clip their edges.
export function canWalk(point: FloorPoint) {
  const inRoom = Math.abs(point.x) <= 4 && Math.abs(point.z) <= 3;
  const inShelf = point.x >= -4.3 && point.x <= -1.05 && point.z < -2.35;
  const inSofa = point.x > 0.25 && point.z < -1.25;
  const inTable = Math.hypot(point.x - 0.1, point.z) < 1.3;
  const inBasket = Math.hypot(point.x - 3.45, point.z - 1.9) < 0.85;
  const inBin = Math.hypot(point.x + 3.5, point.z - 1.85) < 0.72;
  const inPlant = Math.hypot(point.x - 3.8, point.z + 0.4) < 0.65;
  return inRoom && !inShelf && !inSofa && !inTable && !inBasket && !inBin && !inPlant;
}

export function findWalkPath(from: FloorPoint, target: FloorPoint): FloorPoint[] {
  const points: FloorPoint[] = [];
  for (let x = -4; x <= 4; x += STEP) {
    for (let z = -3; z <= 3; z += STEP) {
      const point = { x, z };
      const walkable = canWalk(point);
      if (walkable) points.push(point);
    }
  }
  const distance = (a: FloorPoint, b: FloorPoint) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  const start = points.reduce(
    (best, point) => (distance(point, from) < distance(best, from) ? point : best),
    points[0]!,
  );
  const key = (point: FloorPoint) => `${point.x},${point.z}`;
  const available = new Map(points.map((point) => [key(point), point]));
  const previous = new Map<string, FloorPoint | null>([[key(start), null]]);
  const queue = [start];
  let goal = start;
  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index]!;
    const closer = distance(point, target) < distance(goal, target);
    if (closer) goal = point;
    for (const [dx, dz] of [
      [STEP, 0],
      [-STEP, 0],
      [0, STEP],
      [0, -STEP],
    ]) {
      const next = available.get(key({ x: point.x + dx!, z: point.z + dz! }));
      const unvisited = next && !previous.has(key(next));
      if (!unvisited || !next) continue;
      previous.set(key(next), point);
      queue.push(next);
    }
  }
  const route: FloorPoint[] = [];
  let point: FloorPoint | null = goal;
  while (point) {
    route.push(point);
    point = previous.get(key(point)) ?? null;
  }
  return route.reverse();
}
