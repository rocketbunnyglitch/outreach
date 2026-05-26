/**
 * Walking-distance clustering for venue grouping.
 *
 * Goal: given a list of venues (each with lat/lng), return groups of
 * venues that are within walking distance of each other. The operator
 * then picks a group and saves it as a middle_venue_group.
 *
 * Algorithm: greedy radius-based clustering, NOT DBSCAN.
 *
 *   1. Sort venues geographically (by longitude, then latitude)
 *   2. Pick the first unassigned venue → it seeds a new cluster
 *   3. Find every unassigned venue within `radiusMeters` of the seed
 *   4. Add them to the seed's cluster
 *   5. Repeat from step 2 until every venue is assigned
 *
 * Why greedy over DBSCAN:
 *   - The operator wants HUMAN-readable groupings, not statistical density
 *   - At ~5-30 venues per city, the difference is invisible
 *   - Greedy is deterministic — same input → same output, which makes the
 *     UI predictable
 *   - DBSCAN's "noise" concept doesn't apply (we want every venue grouped)
 *
 * Distance calculation: PostGIS-quality haversine in JS. We could push the
 * distance check to Postgres via ST_DWithin but pulling all venues once
 * + clustering in JS keeps the round-trip count at 1 even for very dense
 * cities.
 */

export interface VenueForClustering {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /**
   * Optional address — surfaced in the UI but not used for clustering.
   * Distance-based only.
   */
  address?: string | null;
  /** Existing venue_event status if this venue is already in a campaign. */
  status?: string | null;
}

export interface VenueCluster {
  /** Stable index 0..N, used as a UI key when there's no DB ID yet. */
  id: number;
  /** Centroid: average of member lat/lng — used to anchor map markers. */
  centroidLat: number;
  centroidLng: number;
  /** Venues in this cluster, sorted alphabetically. */
  venues: VenueForClustering[];
  /** Max pairwise distance in meters (the cluster's "diameter"). */
  diameterMeters: number;
}

/**
 * Haversine distance between two lat/lng points, in meters.
 * Earth radius: 6,371,000m (mean).
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Cluster venues by walking distance.
 *
 * Default radius is 400m — about 5 minutes' walk. Tuneable from the UI.
 * Returns clusters sorted by size (largest first) so the most useful
 * candidates surface at the top of the list.
 */
export function clusterVenuesByWalkingDistance(
  venues: VenueForClustering[],
  radiusMeters = 400,
): VenueCluster[] {
  if (venues.length === 0) return [];

  // Sort geographically so seeds get picked in a predictable left-to-right
  // sweep. Stable across runs because we tiebreak on id.
  const sorted = [...venues].sort((a, b) => {
    if (a.longitude !== b.longitude) return a.longitude - b.longitude;
    if (a.latitude !== b.latitude) return a.latitude - b.latitude;
    return a.id.localeCompare(b.id);
  });

  const assigned = new Set<string>();
  const clusters: VenueCluster[] = [];

  for (const seed of sorted) {
    if (assigned.has(seed.id)) continue;

    // Start a new cluster anchored on this seed.
    const members: VenueForClustering[] = [seed];
    assigned.add(seed.id);

    for (const other of sorted) {
      if (assigned.has(other.id)) continue;
      const d = haversineMeters(seed.latitude, seed.longitude, other.latitude, other.longitude);
      if (d <= radiusMeters) {
        members.push(other);
        assigned.add(other.id);
      }
    }

    // Compute centroid + diameter for the UI
    const centroidLat = members.reduce((sum, v) => sum + v.latitude, 0) / members.length;
    const centroidLng = members.reduce((sum, v) => sum + v.longitude, 0) / members.length;

    let diameter = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (!a || !b) continue;
        const d = haversineMeters(a.latitude, a.longitude, b.latitude, b.longitude);
        if (d > diameter) diameter = d;
      }
    }

    clusters.push({
      id: clusters.length,
      centroidLat,
      centroidLng,
      venues: members.sort((a, b) => a.name.localeCompare(b.name)),
      diameterMeters: Math.round(diameter),
    });
  }

  // Sort: largest cluster first (most useful as a middle group), then by
  // diameter ascending (tighter clusters preferred at equal size).
  return clusters.sort((a, b) => {
    if (b.venues.length !== a.venues.length) return b.venues.length - a.venues.length;
    return a.diameterMeters - b.diameterMeters;
  });
}

/**
 * Convenience: format a meter value for human display.
 *   123 → "123m"
 *   1234 → "1.2km"
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
