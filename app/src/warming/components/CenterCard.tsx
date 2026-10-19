import { useState } from "react";
import { track } from "../../logic/analytics.ts";
import { displayUrl, hrefFor, mapsLink, telHref } from "../../logic/card.ts";
import { metresBetween } from "../../logic/data.ts";
import type { LngLat } from "../../logic/places.ts";
import type { Site } from "../../logic/types.ts";
import { CategoryIcon } from "../../ui/CategoryIcon.tsx";
import { siteUrl } from "../../ui/useSiteCard.ts";
import { centerDetails, centerKind, centerStatus } from "../logic/centers.ts";
import { clockTime, minutesOf } from "../logic/hours.ts";
import { OpenStatusLine } from "./OpenStatusLine.tsx";
import { useNycMinute } from "./useNycMinute.ts";

/** Past this many days since a center's update, the card says it may be out of date.
 *  null turns the warning off, leaving only the date. */
const STALE_DAYS: number | null = null;
const METRES_PER_MILE = 1609.344;

interface CenterCardProps {
  feature: Site;
  /** Where the reader searched for, or null. The card says how far the center is. */
  origin: LngLat | null;
  lang: string;
}

/**
 * One warming center's card, inside the block's SiteDialog. In order: the name; its kind,
 * wheelchair access and pets; whether it is open, and how far it is after a search;
 * buttons to call it and for directions on Google Maps; its address, hours and website; how
 * to get in; and when it was last updated, with a link to the card itself. Anything the
 * data does not have is left out rather than shown empty. Every visible string is its own
 * element (see App.tsx in ui/).
 */
export function CenterCard({ feature, origin, lang }: CenterCardProps) {
  const p = feature.properties;
  const details = centerDetails(feature);
  const kind = centerKind(feature);
  const status = centerStatus(feature, useNycMinute());
  const maps = mapsLink({}, feature, {});
  const miles = origin
    ? Math.max(0.1, metresBetween(origin, feature.geometry.coordinates) / METRES_PER_MILE)
    : null;

  return (
    <div className="center-card">
      <h2 id="card-title" tabIndex={-1}>{p.org}</h2>

      <p className="card-meta">
        {kind && (
          <span className="card-meta-item">
            <CategoryIcon color={kind.color} glyph={kind.glyph} />
            <span>{kind.label}</span>
          </span>
        )}
        {details.wheelchair && (
          <span className="card-meta-item"><WheelchairIcon /><span>Wheelchair accessible</span></span>
        )}
        {details.pets && (
          <span className="card-meta-item"><PawIcon /><span>Pets allowed</span></span>
        )}
      </p>

      {(status || miles !== null) && (
        <div className="card-status">
          {status && <OpenStatusLine status={status} />}
          {miles !== null && (
            <span className="card-distance">
              <span>{miles.toFixed(1)}</span>{" "}<span aria-hidden="true">mi</span>
              <span className="visually-hidden">miles</span>{" "}<span>away</span>
            </span>
          )}
        </div>
      )}

      <div className="card-buttons">
        {details.phone && (
          <a className="card-button" href={telHref(details.phone)}
             onClick={() => track("map_action_click", { org_id: p.org_id, site_id: p.id, action: "phone" })}>
            <PhoneIcon />
            <span className="visually-hidden">Call</span>{" "}
            <span className="phone">{details.phone}</span>
          </a>
        )}
        {maps && (
          <a className="card-button" href={maps} target="_blank" rel="noopener"
             onClick={() => track("map_open_in_maps_click", { org_id: p.org_id, site_id: p.id })}>
            <DirectionsIcon />
            <span>Directions</span>
            <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        )}
      </div>

      <dl className="card-facts">
        <div className="card-fact">
          <PinIcon />
          <div>
            <dt>Address</dt>
            <dd><span>{p.address}</span>, <span>NY</span></dd>
          </div>
        </div>
        <Hours opens={details.opens} closes={details.closes} />
        {details.website && (
          <div className="card-fact">
            <GlobeIcon />
            <div>
              <dt>Website</dt>
              <dd>
                <a href={hrefFor(details.website)} target="_blank" rel="noopener"
                   onClick={() => track("map_action_click", {
                     org_id: p.org_id, site_id: p.id, action: "website",
                   })}>
                  <span>{displayUrl(details.website)}</span>
                  <span className="visually-hidden">(opens in a new tab)</span>
                </a>
              </dd>
            </div>
          </div>
        )}
      </dl>

      {details.instructions && (
        <section className="card-section">
          <h3>How to get in</h3>
          <p>{details.instructions}</p>
        </section>
      )}

      <div className="card-foot">
        <Updated date={details.updated} lang={lang} />
        <CopyLink key={p.id} id={p.id} />
      </div>
    </div>
  );
}

/** "8 AM – 10 PM, every day", or "Open 24 hours, 7 days a week". Nothing when the
 *  times cannot be read. */
function Hours({ opens, closes }: { opens?: string; closes?: string }) {
  const from = minutesOf(opens);
  const to = minutesOf(closes);
  if (from === null || to === null) return null;
  const allDay = to - from === 24 * 60 || from === to;
  return (
    <div className="card-fact">
      <ClockIcon />
      <div>
        <dt>Hours</dt>
        <dd>
          {allDay ? <span>Open 24 hours, 7 days a week</span> : (
            <>
              <span>{clockTime(from)}</span> – <span>{clockTime(to)}</span>,{" "}
              <span>every day</span>
            </>
          )}
        </dd>
      </div>
    </div>
  );
}

/** "Updated Oct 4, 2026", and past STALE_DAYS, when set, a warning to call first. */
function Updated({ date, lang }: { date?: string; lang: string }) {
  const [now] = useState(() => Date.now());   // read once: the threshold is in days
  const day = date ? new Date(`${date}T12:00:00`) : null;
  if (!day || Number.isNaN(day.valueOf())) return <p className="card-updated" />;
  const stale = STALE_DAYS !== null && (now - day.valueOf()) / 86_400_000 > STALE_DAYS;
  return (
    <p className={stale ? "card-updated stale" : "card-updated"}>
      {stale && (
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
          <path d="M8 1.5 15 14H1z" fill="currentColor" />
          <path d="M8 6v3.5M8 11.5v.5" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      <span>
        <span>Updated</span>{" "}
        <time dateTime={date}>
          {new Intl.DateTimeFormat(lang, { month: "short", day: "numeric", year: "numeric" })
            .format(day)}
        </time>
        {stale && <>{" — "}<span>This info may be out of date. Call before you go.</span></>}
      </span>
    </p>
  );
}

/** Copies the card's own address, ?site=<id>, and says it did. Inside an iframe that is
 *  the frame's address (see useSiteCard). */
function CopyLink({ id }: { id: string }) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(siteUrl(id).href);
      setResult("copied");
      track("map_copy_link", { site_id: id });
    } catch {
      setResult("failed");
    }
  }
  return (
    <>
      <button type="button" className="copy-link" onClick={copy}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
            <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
          </g>
        </svg>
        {result === "copied" ? <span>Link copied</span>
          : result === "failed" ? <span>Could not copy the link</span>
          : <span>Copy link</span>}
      </button>
      {/* The same outcome for a screen reader, which does not hear a button's label change. */}
      <span className="visually-hidden" role="status">
        {result === "copied" && <span>Link copied</span>}
        {result === "failed" && <span>Could not copy the link</span>}
      </span>
    </>
  );
}

// Icons. Decorative: the text beside each says what it means.

function WheelchairIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
      <circle cx="12.5" cy="3.8" r="2" fill="currentColor" />
      <path d="M11.5 7.5v6h5l2.5 5.5M11.5 10.5h4.5" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.6 10.6a6 6 0 1 0 7.9 8" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" />
    </svg>
  );
}

function PawIcon() {
  return (
    <svg className="card-meta-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"
         fill="currentColor">
      <ellipse cx="6" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="18" cy="10" rx="2.2" ry="2.8" />
      <ellipse cx="9.5" cy="5.5" rx="2.2" ry="2.8" />
      <ellipse cx="14.5" cy="5.5" rx="2.2" ry="2.8" />
      <path d="M12 11.5c-3 0-6 4.5-6 7a2.5 2.5 0 0 0 3.5 2.2c1.6-.6 3.4-.6 5 0A2.5 2.5 0 0 0 18 18.5c0-2.5-3-7-6-7z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path fill="currentColor"
            d="M6.6 3h2.8l1.6 4.2-2.1 1.5a11.5 11.5 0 0 0 6.4 6.4l1.5-2.1 4.2 1.6v2.8a2.1 2.1 0 0 1-2.2 2.1A16.4 16.4 0 0 1 4.5 5.2 2.1 2.1 0 0 1 6.6 3z" />
    </svg>
  );
}

/** A turn arrow in a diamond, the road sign for directions. */
function DirectionsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
      <path d="M12 2.2 21.8 12 12 21.8 2.2 12z" fill="currentColor" strokeLinejoin="round" />
      <path d="M9 15.5v-3.5a1 1 0 0 1 1-1h5M13 8.5l2.5 2.5-2.5 2.5" fill="none" stroke="#ffffff"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className="card-fact-icon" aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
            fill="currentColor" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg className="card-fact-icon" aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="card-fact-icon" aria-hidden="true" viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M12 7v5.5l3.5 2" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
