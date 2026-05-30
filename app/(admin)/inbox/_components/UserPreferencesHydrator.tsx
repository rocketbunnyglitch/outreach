import { getUserPreferences } from "@/lib/user-preferences";

/**
 * UserPreferencesHydrator — server component that reads the
 * current operator's preferences and emits a small inline
 * <script> setting the data-attributes on <html> BEFORE the
 * client paints. Avoids the flash of default-density between
 * server render and hydration on devices where localStorage
 * doesn't yet carry the value (first visit on a new device,
 * incognito, etc).
 *
 * Renders nothing visible. The script tag is inline + tiny so
 * the cost is negligible. It also primes localStorage so the
 * existing InboxDensityToggle hydration finds the right value
 * and the active pill renders correctly.
 *
 * Mount inside any route that wants the prefs applied (the
 * inbox shell, settings, anywhere the density CSS hooks fire).
 *
 * No-op when the user has no preferences row yet (the toggle
 * defaults still apply).
 */
export async function UserPreferencesHydrator({ userId }: { userId: string }) {
  const prefs = await getUserPreferences(userId);
  if (!prefs) return null;

  // Build the inline script. Whitelist values via a switch on the
  // server so we never inject arbitrary text into <script>.
  const lines: string[] = [];
  if (prefs.inboxDensity) {
    const safe = ["compact", "default", "comfortable"].includes(prefs.inboxDensity)
      ? prefs.inboxDensity
      : null;
    if (safe) {
      lines.push(`document.documentElement.setAttribute('data-inbox-density', '${safe}');`);
      lines.push(`try { localStorage.setItem('inbox-density', '${safe}'); } catch(e) {}`);
    }
  }
  if (prefs.inboxReadingPane) {
    const safe = ["right", "bottom", "none"].includes(prefs.inboxReadingPane)
      ? prefs.inboxReadingPane
      : null;
    if (safe) {
      lines.push(`document.documentElement.setAttribute('data-inbox-reading-pane', '${safe}');`);
      lines.push(`try { localStorage.setItem('inbox-reading-pane', '${safe}'); } catch(e) {}`);
    }
  }
  if (lines.length === 0) return null;

  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: built from a strict allow-list of enum values; no user-supplied strings reach the script body
      dangerouslySetInnerHTML={{
        __html: lines.join("\n"),
      }}
    />
  );
}
