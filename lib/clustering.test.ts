import {
  type VenueForClustering,
  clusterVenuesByWalkingDistance,
  formatDistance,
  haversineMeters,
} from "@/lib/clustering";
import { describe, expect, it } from "vitest";

// Pure geo helpers from lib/clustering.ts -- no DB / network / server-only,
// safe to import directly. These lock in the haversine math, the human
// distance formatting, and the walking-distance clustering behavior the
// middle-group map planner depends on.

const venue = (
  id: string,
  name: string,
  latitude: number,
  longitude: number,
): VenueForClustering => ({ id, name, latitude, longitude });

describe("haversineMeters", () => {
  it("returns zero for identical points", () => {
    expect(haversineMeters(43.65, -79.38, 43.65, -79.38)).toBe(0);
  });

  it("is symmetric (a->b equals b->a)", () => {
    const ab = haversineMeters(43.65, -79.38, 43.66, -79.39);
    const ba = haversineMeters(43.66, -79.39, 43.65, -79.38);
    expect(Math.abs(ab - ba)).toBeLessThan(1e-6);
  });

  it("computes a known short distance within tolerance", () => {
    // ~111.2m per 0.001 deg of latitude near the equator.
    const d = haversineMeters(0, 0, 0.001, 0);
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(113);
  });
});

describe("formatDistance", () => {
  it("formats sub-kilometer values in rounded meters", () => {
    expect(formatDistance(123)).toBe("123m");
    expect(formatDistance(123.6)).toBe("124m");
    expect(formatDistance(0)).toBe("0m");
  });

  it("formats kilometer values with one decimal place", () => {
    expect(formatDistance(1000)).toBe("1.0km");
    expect(formatDistance(1234)).toBe("1.2km");
  });
});

describe("clusterVenuesByWalkingDistance", () => {
  it("returns an empty array for no venues", () => {
    expect(clusterVenuesByWalkingDistance([])).toEqual([]);
  });

  it("groups nearby venues and isolates a far-away one", () => {
    // Two venues ~30m apart, one ~3km away.
    const venues = [
      venue("a", "Alpha Bar", 43.65, -79.38),
      venue("b", "Beta Pub", 43.6502, -79.3801),
      venue("c", "Faraway Club", 43.68, -79.41),
    ];
    const clusters = clusterVenuesByWalkingDistance(venues, 400);

    expect(clusters.length).toBe(2);
    // Largest cluster first: the pair.
    expect(clusters[0]?.venues.map((v) => v.id).sort()).toEqual(["a", "b"]);
    expect(clusters[1]?.venues.map((v) => v.id)).toEqual(["c"]);
  });

  it("sorts member venues alphabetically by name", () => {
    const venues = [
      venue("z", "Zebra Lounge", 43.65, -79.38),
      venue("a", "Anchor Tap", 43.6501, -79.38),
    ];
    const [cluster] = clusterVenuesByWalkingDistance(venues, 400);
    expect(cluster?.venues.map((v) => v.name)).toEqual(["Anchor Tap", "Zebra Lounge"]);
  });

  it("assigns every venue to exactly one cluster", () => {
    const venues = [
      venue("a", "A", 43.65, -79.38),
      venue("b", "B", 43.6501, -79.3801),
      venue("c", "C", 43.7, -79.5),
      venue("d", "D", 43.7001, -79.5001),
    ];
    const clusters = clusterVenuesByWalkingDistance(venues, 400);
    const assigned = clusters.flatMap((c) => c.venues.map((v) => v.id)).sort();
    expect(assigned).toEqual(["a", "b", "c", "d"]);
  });
});
