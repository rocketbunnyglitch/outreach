"use client";

/**
 * Mounts live presence (cursors + avatar stack) for one city sheet.
 * Drop-in: renders the avatar stack inline where placed, plus a
 * fixed-overlay cursor layer. Dormant-safe until the /ws sidecar is live.
 */

import {
  PresenceAvatars,
  PresenceCursors,
  useMeetingMode,
  usePresence,
} from "../../_components/presence";

export function CityPresence({
  cityCampaignId,
  viewerName,
}: {
  cityCampaignId: string;
  viewerName: string;
}) {
  const { peers } = usePresence(`city:${cityCampaignId}`, viewerName);
  const [meetingMode] = useMeetingMode();
  return (
    <>
      <PresenceAvatars peers={peers} />
      {meetingMode && <PresenceCursors peers={peers} />}
    </>
  );
}
