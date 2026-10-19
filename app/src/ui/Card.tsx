import { useState } from "react";
import type { ReactNode } from "react";
import { track } from "../logic/analytics.ts";
import {
  cardActions, cardFacts, cardFields, cardUpdated, displayUrl, hrefFor, mapsLink,
  parseStructure, telHref,
} from "../logic/card.ts";
import type { CardAction, CardField } from "../logic/card.ts";
import { metresBetween } from "../logic/data.ts";
import type { LngLat } from "../logic/places.ts";
import type { FactIcon, Model, Site } from "../logic/types.ts";
import { siteUrl } from "./useSiteCard.ts";

/** Past this many days since a site's update, the card says it may be out of date.
 *  null turns the warning off, leaving only the date. */
const STALE_DAYS: number | null = null;
const METRES_PER_MILE = 1609.344;

interface CardProps {
  feature: Site;
  model: Model;
  lang: string;
  /** Where the reader searched for, or null. The card says how far the site is. */
  origin?: LngLat | null;
  /** A line under the name, such as what kind of site it is. */
  meta?: ReactNode;
  /** Beside the distance, such as whether the site is open now. */
  status?: ReactNode;
  /** The Hours row's value, when the app works it out rather than reading one field. */
  hours?: ReactNode;
}

/**
 * One site's card: always exactly one record. In order: the name; the app's `meta` line;
 * its `status` and, after a search, how far the site is; the buttons; the address and the
 * fact rows, each beside its icon; the longer fields under headings; and when the site
 * was last updated, with a link to the card itself. What the buttons, facts and sections
 * are is config.json's (see logic/card.ts); anything a site does not have is left out
 * rather than shown empty.
 *
 * Every visible string is its own element — see the language rule at the top of App.tsx.
 */
export function Card({ feature, model, lang, origin = null, meta, status, hours }: CardProps) {
  const p = feature.properties;
  const org = model.orgById.get(p.org_id) || {};
  const { config } = model;
  const facts = cardFacts(config, p, org);
  const sections = cardFields(config, p, org);
  const miles = origin
    ? Math.max(0.1, metresBetween(origin, feature.geometry.coordinates) / METRES_PER_MILE)
    : null;

  return (
    <div className="site-card">
      <h2 id="card-title" tabIndex={-1}>{p.org}</h2>
      {meta && <p className="card-meta">{meta}</p>}
      {(status || miles !== null) && (
        <div className="card-status">
          {status}
          {miles !== null && (
            <span className="card-distance">
              <span>{miles.toFixed(1)}</span>{" "}<span aria-hidden="true">mi</span>
              <span className="visually-hidden">miles</span>{" "}<span>away</span>
            </span>
          )}
        </div>
      )}

      <Buttons feature={feature} actions={cardActions(config, p, org)}
               directions={mapsLink(config, feature, org)} />

      <dl className="card-facts">
        <Fact icon="pin" label="Address"><span>{p.address}</span></Fact>
        {hours && <Fact icon="clock" label="Hours">{hours}</Fact>}
        {facts.map((fact) => (
          <Fact key={fact.key} icon={fact.icon} label={fact.label}>
            <FieldValue field={fact} feature={feature} />
          </Fact>
        ))}
      </dl>

      {sections.map((section) => (
        <section key={section.key} className="card-section">
          <h3>{section.label}</h3>
          <FieldValue field={section} feature={feature} block />
        </section>
      ))}

      <div className="card-foot">
        <Updated date={cardUpdated(config, p, org, model.generated)} lang={lang} />
        <CopyLink key={p.id} id={p.id} />
      </div>
    </div>
  );
}

/**
 * The buttons under the name, side by side: `actions` from config.json, then Directions.
 *
 * These are what a resident opening a card is most likely to have come for, so they come
 * before everything describing the site. A phone number is the button's text, with "Call"
 * for a screen reader: the number stays visible and copyable on a desktop, where `tel:`
 * does nothing. Directions opens Google Maps on the place (see mapsLink in
 * logic/card.ts), from which a route is one tap.
 */
function Buttons({ feature, actions, directions }: {
  feature: Site; actions: CardAction[]; directions: string | null;
}) {
  const p = feature.properties;
  if (!actions.length && !directions) return null;
  return (
    <div className="card-buttons">
      {actions.map((action) => (
        <a key={action.key} className="card-button" href={action.href}
           target={action.external ? "_blank" : undefined}
           rel={action.external ? "noopener" : undefined}
           onClick={() => track("map_action_click", {
             org_id: p.org_id, site_id: p.id, action: action.key,
           })}>
          {action.as === "tel" ? (
            <>
              <Icon name="phone" size={20} />
              <span className="visually-hidden">{action.label}</span>{" "}
              <span className="phone">{action.detail}</span>
            </>
          ) : (
            <>
              <Icon name="globe" size={20} />
              <span>{action.label}</span>
              {action.external && <span className="visually-hidden">(opens in a new tab)</span>}
            </>
          )}
        </a>
      ))}
      {directions && (
        <a className="card-button" href={directions} target="_blank" rel="noopener"
           onClick={() => track("map_open_in_maps_click", { org_id: p.org_id, site_id: p.id })}>
          <Icon name="directions" size={20} />
          <span>Directions</span>
          <span className="visually-hidden">(opens in a new tab)</span>
        </a>
      )}
    </div>
  );
}

/** One fact row: the icon, then the label over its value. */
function Fact({ icon, label, children }: {
  icon: FactIcon | "pin"; label: string; children: ReactNode;
}) {
  return (
    <div className="card-fact">
      <Icon name={icon} size={22} className="card-fact-icon" />
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

/** One field's value: a link, or text broken into paragraphs and lists. `block` sets a
 *  single line as a paragraph, for a section rather than a fact row. */
function FieldValue({ field, feature, block = false }: {
  field: CardField; feature: Site; block?: boolean;
}) {
  const { as, value } = field;
  const p = feature.properties;
  if (as === "url") {
    return (
      <a href={hrefFor(value)} target="_blank" rel="noopener"
         onClick={() => track("map_action_click", { org_id: p.org_id, site_id: p.id, action: field.key })}>
        <span>{displayUrl(value)}</span>
        <span className="visually-hidden">(opens in a new tab)</span>
      </a>
    );
  }
  if (as === "tel") return <a href={telHref(value)}><span>{value}</span></a>;

  const s = parseStructure(value);
  const list = (items: string[]) => (
    <ul>{items.map((item, i) => <li key={i}><span>{item}</span></li>)}</ul>
  );
  if (s.kind === "intro-list") return <><p><span>{s.intro}</span></p>{list(s.items)}</>;
  if (s.kind === "paragraphs") return s.items.map((line, i) => <p key={i}><span>{line}</span></p>);
  if (s.kind === "list") return list(s.items);
  return block ? <p><span>{s.text}</span></p> : <span>{s.text}</span>;
}

/** "Updated Oct 4, 2026", and past STALE_DAYS, when set, a warning to call first. */
function Updated({ date, lang }: { date: string; lang: string }) {
  const [now] = useState(() => Date.now());   // read once: the threshold is in days
  const day = date ? new Date(`${date}T12:00:00`) : null;
  if (!day || Number.isNaN(day.valueOf())) return <p className="card-updated" />;
  const stale = STALE_DAYS !== null && (now - day.valueOf()) / 86_400_000 > STALE_DAYS;
  return (
    <p className={stale ? "card-updated stale" : "card-updated"}>
      {stale && <Icon name="warning" size={14} />}
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
        <Icon name="link" size={16} />
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

type IconName = FactIcon | "pin" | "directions" | "link" | "warning";

/** The card's icons, on a 24-unit square. Decorative: the text beside each says what it
 *  means. */
function Icon({ name, size, className }: { name: IconName; size: number; className?: string }) {
  return (
    <svg className={className} aria-hidden="true" viewBox="0 0 24 24" width={size} height={size}>
      {ICONS[name]}
    </svg>
  );
}

const ICONS: Record<IconName, ReactNode> = {
  pin: (
    <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
          fill="currentColor" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M12 7v5.5l3.5 2" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3 12h18M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  phone: (
    <path fill="currentColor"
          d="M6.6 3h2.8l1.6 4.2-2.1 1.5a11.5 11.5 0 0 0 6.4 6.4l1.5-2.1 4.2 1.6v2.8a2.1 2.1 0 0 1-2.2 2.1A16.4 16.4 0 0 1 4.5 5.2 2.1 2.1 0 0 1 6.6 3z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" fill="currentColor" />
      <path d="M12 11v6M12 7.5v.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
  // A turn arrow in a diamond, the road sign for directions.
  directions: (
    <>
      <path d="M12 2.2 21.8 12 12 21.8 2.2 12z" fill="currentColor" />
      <path d="M9 15.5v-3.5a1 1 0 0 1 1-1h5M13 8.5l2.5 2.5-2.5 2.5" fill="none" stroke="#ffffff"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  link: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </g>
  ),
  warning: (
    <>
      <path d="M12 2.5 22.5 21h-21z" fill="currentColor" />
      <path d="M12 9.5v5M12 17.5v.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
    </>
  ),
};
