export interface GPSPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  segment: number;
}
export function metersBetween(a: GPSPoint, b: GPSPoint) {
  const radians = (n: number) => (n * Math.PI) / 180;
  const lat = radians(b.latitude - a.latitude),
    lng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function summarizePoints(points: GPSPoint[]) {
  let distanceMeters = 0,
    gaps = 0,
    previous: GPSPoint | undefined;
  for (const point of points) {
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      point.accuracy < 0 ||
      point.accuracy > 50
    ) {
      previous = undefined;
      gaps++;
      continue;
    }
    if (previous) {
      const elapsed = (point.timestamp - previous.timestamp) / 1000;
      const distance = metersBetween(previous, point);
      if (
        point.segment !== previous.segment ||
        elapsed <= 0 ||
        elapsed > 120 ||
        distance / elapsed > 65
      )
        gaps++;
      else distanceMeters += distance;
    }
    previous = point;
  }
  return {
    distanceMeters: Math.round(distanceMeters),
    gaps,
    lastSample: points.at(-1)?.timestamp ?? null,
  };
}
/** Separate polylines prevent maps from visually bridging pauses or unreliable samples. */
export function routeSegments(points: GPSPoint[]): GPSPoint[][] {
  const segments: GPSPoint[][] = [];
  let current: GPSPoint[] = [];
  for (const point of points) {
    if (
      !Number.isFinite(point.latitude) ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.latitude) > 90 ||
      Math.abs(point.longitude) > 180 ||
      point.accuracy < 0 ||
      point.accuracy > 50
    ) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    const previous = current.at(-1);
    if (previous) {
      const seconds = (point.timestamp - previous.timestamp) / 1000;
      if (
        point.segment !== previous.segment ||
        seconds <= 0 ||
        seconds > 120 ||
        metersBetween(previous, point) / seconds > 65
      ) {
        segments.push(current);
        current = [];
      }
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}
