from pathlib import Path
from textwrap import dedent

path = Path("app/buzz-map-app.tsx")
text = path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"Missing {label} anchor")
    text = text.replace(old, new, 1)


def replace_range(start_marker: str, end_marker: str, replacement: str, label: str, include_end: bool = False) -> None:
    global text
    try:
        start = text.index(start_marker)
        end = text.index(end_marker, start)
    except ValueError as error:
        raise SystemExit(f"Missing {label} range anchor") from error
    if include_end:
        end += len(end_marker)
    text = text[:start] + replacement + text[end:]


invite_import = dedent('''\
import {
  buildInviteCrewText,
  buildInviteCrewUrl,
  buildStoryCardUrl,
} from "../src/lib/invite-the-crew";
''')
analytics_import = invite_import + dedent('''\
import {
  createReferralId,
  referralContext,
  trackConversion,
  type ConversionEventName,
} from "../src/lib/conversion-analytics";
''')
if 'from "../src/lib/conversion-analytics"' not in text:
    replace_once(invite_import, analytics_import, "Invite the Crew import")

select_block = dedent('''\
  const selectVenue = useCallback((id: string) => {
    const venue = venues.find(item => String(item.id) === String(id));
    if (!venue) return;
    setSelected(venue);
    setVoteMessage("");
    setWatchMessage("");
    const context = referralContext(window.location.href);
    void trackConversion({
      eventName: "venue_view",
      venueId: venue.id,
      referralId: context.referralId,
      source: context.isInvite ? "invite-the-crew" : "buzz-map",
      truthMode: venue.activity?.scoreMode || "forecast",
      metadata: {
        entry: context.isInvite ? "shared-link" : "map",
        selectedFilter: active,
      },
    }, session?.access_token);
    if (validVenue(venue)) mapRef.current?.easeTo({ center: coordinates(venue), zoom: Math.max(13.2, mapRef.current.getZoom()), duration: 500 });
  }, [venues, active, session?.access_token]);
  selectedRef.current = selectVenue;
''')
replace_range(
    '  const selectVenue = useCallback((id: string) => {',
    '  selectedRef.current = selectVenue;',
    select_block.rstrip(),
    "venue selection",
    include_end=True,
)

deep_link_block = dedent('''\
  useEffect(() => {
    if (deepLinkHandledRef.current || !venues.length) return;
    const params = new URLSearchParams(window.location.search);
    const venueId = params.get("venue");
    if (!venueId || !venues.some(venue => String(venue.id) === venueId)) return;
    deepLinkHandledRef.current = true;
    const context = referralContext(window.location.href);
    if (context.isInvite) {
      void trackConversion({
        eventName: "shared_link_open",
        venueId,
        referralId: context.referralId,
        source: context.source,
        truthMode: context.truthMode,
        metadata: { entry: "shared-link" },
      }, session?.access_token);
    }
    selectVenue(venueId);
    if (params.get("invite") === "1") {
      setShareMessage("This place is ready to share. Tap Invite the Crew to open your phone’s share sheet.");
    }
  }, [venues, selectVenue, session?.access_token]);
''')
replace_range(
    '  useEffect(() => {\n    if (deepLinkHandledRef.current || !venues.length) return;',
    '  }, [venues, selectVenue]);',
    deep_link_block.rstrip(),
    "deep-link tracking",
    include_end=True,
)

favorite_block = dedent('''\
  function toggleFavorite(event: ReactMouseEvent, venue: Venue) {
    event.stopPropagation();
    const adding = !favoriteIds.has(venue.id);
    setFavoriteIds(current => {
      const next = new Set(current);
      next.has(venue.id) ? next.delete(venue.id) : next.add(venue.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
    if (adding) {
      void trackConversion({
        eventName: "favorite_add",
        venueId: venue.id,
        source: "buzz-map",
        truthMode: venue.activity?.scoreMode || "forecast",
        metadata: { selectedFilter: active },
      }, session?.access_token);
    }
  }
''')
replace_range(
    '  function toggleFavorite(event: ReactMouseEvent, venue: Venue) {',
    '\n\n  async function enableNotifications()',
    favorite_block.rstrip(),
    "favorite analytics",
)

watch_block = dedent('''\
  async function toggleWatch(venue: Venue) {
    const next = new Set(watchedIds);
    const removing = next.has(venue.id);
    removing ? next.delete(venue.id) : next.add(venue.id);
    setWatchedIds(next);
    localStorage.setItem(VENUE_ALERTS_KEY, JSON.stringify([...next].map(venueId => ({ venueId, threshold: 80 }))));
    if (removing) {
      setWatchMessage("Alert removed for this place.");
      return;
    }
    void trackConversion({
      eventName: "watch_add",
      venueId: venue.id,
      source: "buzz-map",
      truthMode: venue.activity?.scoreMode || "forecast",
      metadata: { notification: true },
    }, session?.access_token);
    await enableNotifications();
  }
''')
replace_range(
    '  async function toggleWatch(venue: Venue) {',
    '\n\n  function inviteVenue',
    watch_block.rstrip(),
    "watch analytics",
)

invite_and_share_block = dedent('''\
  function inviteVenue(venue: Venue, referralId?: string | null) {
    return {
      id: venue.id,
      name: venue.name,
      city: venue.city || venue.area?.shortName || null,
      latitude: venue.lat,
      longitude: venue.lng,
      status: statusFor(venue),
      trend: venue.activity?.trendLabel || null,
      mode: venue.activity?.scoreMode || "forecast",
      referralId,
    };
  }

  function trackVenueConversion(
    venue: Venue,
    eventName: ConversionEventName,
    channel?: string,
    referralId?: string | null,
    metadata?: Record<string, string | number | boolean>,
  ) {
    void trackConversion({
      eventName,
      venueId: venue.id,
      referralId,
      source: "invite-the-crew",
      channel,
      truthMode: venue.activity?.scoreMode || "forecast",
      metadata,
    }, session?.access_token);
  }

  async function copyInviteLink(
    venue: Venue,
    referralId = createReferralId(),
    trackAttempt = true,
    fallback = false,
  ) {
    const details = inviteVenue(venue, referralId);
    const link = buildInviteCrewUrl(window.location.origin, details);
    if (trackAttempt) trackVenueConversion(venue, "share_attempt", "copy", referralId, { entry: "copy-link" });
    try {
      await navigator.clipboard.writeText(link);
      setShareMessage("Invite link copied.");
    } catch {
      window.prompt("Copy this Buzz invite link", link);
      setShareMessage("Copy the link above and send it to the crew.");
    }
    trackVenueConversion(venue, "copy_link", "copy", referralId, { fallback });
  }

  function textCrew(venue: Venue) {
    const referralId = createReferralId();
    const details = inviteVenue(venue, referralId);
    const link = buildInviteCrewUrl(window.location.origin, details);
    const body = `${buildInviteCrewText(details)} ${link}`;
    trackVenueConversion(venue, "share_attempt", "sms", referralId, { entry: "text-crew" });
    trackVenueConversion(venue, "sms_open", "sms", referralId, { result: "opened" });
    window.location.href = `sms:?&body=${encodeURIComponent(body)}`;
    setShareMessage("Opening your messages app…");
  }

  async function storyCardFile(venue: Venue) {
    const details = inviteVenue(venue);
    const response = await fetch(buildStoryCardUrl(window.location.origin, details));
    if (!response.ok) throw new Error("Could not generate the Story card");
    const blob = await response.blob();
    const fileName = `buzz-${venue.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "venue"}.png`;
    return new File([blob], fileName, { type: "image/png" });
  }

  async function downloadStoryCard(venue: Venue) {
    const referralId = createReferralId();
    trackVenueConversion(venue, "share_attempt", "story-download", referralId, { entry: "save-story" });
    setSharing(true);
    try {
      const file = await storyCardFile(venue);
      const objectUrl = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      trackVenueConversion(venue, "story_download", "story-download", referralId, { result: "saved" });
      setShareMessage("Story graphic saved. Post it anywhere your crew hangs out.");
    } catch (shareError) {
      trackVenueConversion(venue, "share_fallback", "story-download", referralId, { result: "error" });
      setShareMessage(shareError instanceof Error ? shareError.message : "Could not save the Story graphic");
    } finally {
      setSharing(false);
    }
  }

  async function shareWithCrew(venue: Venue) {
    const referralId = createReferralId();
    const details = inviteVenue(venue, referralId);
    const link = buildInviteCrewUrl(window.location.origin, details);
    const text = buildInviteCrewText(details);
    trackVenueConversion(venue, "share_attempt", "web-share", referralId, { entry: "invite-the-crew" });
    setSharing(true);
    setShareMessage("Generating the crew card…");
    try {
      const file = await storyCardFile(venue);
      const canShareFile = typeof navigator.canShare === "function" && navigator.canShare({ files: [file] });
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: `${venue.name} on Buzz`,
          text,
          url: link,
          ...(canShareFile ? { files: [file] } : {}),
        });
        trackVenueConversion(venue, "share_complete", "web-share", referralId, { shareFile: canShareFile, result: "shared" });
        setShareMessage("Shared with the crew.");
      } else {
        trackVenueConversion(venue, "share_fallback", "copy", referralId, { fallback: true });
        await copyInviteLink(venue, referralId, false, true);
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        trackVenueConversion(venue, "share_cancel", "web-share", referralId, { result: "cancelled" });
        setShareMessage("");
      } else {
        trackVenueConversion(venue, "share_fallback", "copy", referralId, { fallback: true, result: "error" });
        await copyInviteLink(venue, referralId, false, true);
      }
    } finally {
      setSharing(false);
    }
  }

''')
replace_range(
    '  function inviteVenue(venue: Venue) {',
    '  async function useMyLocation()',
    invite_and_share_block,
    "Invite the Crew analytics",
)

path.write_text(text)
