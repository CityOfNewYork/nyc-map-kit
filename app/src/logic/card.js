/**
 * card.js — what a site's card says, as data.
 *
 * Which fields and buttons a card shows, the links they carry, and how a long field
 * value breaks into paragraphs and lists. The UI renders these; nothing here touches the
 * DOM, so every rule is testable on its own.
 */

/** A field's value for this site: from the site's own properties, or from its org. */
function read(ref, p, org) {
  return (ref.source === "org" ? (org || {})[ref.key] : p[ref.key]) || "";
}

/** A link for a website value that may or may not carry its scheme. */
export function hrefFor(value) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

/** A website value as a reader sees it: no scheme, no trailing slash. */
export function displayUrl(value) {
  return String(value).replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/**
 * A dial string from a number written for a human to read.
 *
 * 21 of the 185 sites carry an extension — "(212)766-9200 x2224". Stripping every
 * non-digit turns that into 21276692002224, which is not a phone number, and a phone
 * handed it will try to dial it anyway. RFC 3966 keeps the extension in its own field:
 * tel:2127669200;ext=2224.
 */
export function telHref(value) {
  const [main, ext] = String(value).split(/\s*(?:x|ext\.?|extension)\s*/i);
  const digits = String(main).replace(/[^\d+]/g, "");
  const extension = (ext || "").replace(/\D/g, "");
  return `tel:${digits}${extension ? `;ext=${extension}` : ""}`;
}

/**
 * The buttons in the row under the address, from `actions` in config.json, in order.
 * A field with no value for this site is left out. Each is
 * `{ key, label, as, value, href, detail, external }`: the label is the verb, the
 * detail is the information (the number, or the domain).
 */
export function cardActions(config, p, org) {
  const out = [];
  for (const action of config.actions || []) {
    const value = read(action, p, org);
    if (!value) continue;
    if (action.as === "tel") {
      out.push({ key: action.key, label: action.label, as: "tel", value,
                 href: telHref(value), detail: value, external: false });
    } else {
      out.push({ key: action.key, label: action.label, as: action.as, value,
                 href: hrefFor(value), detail: displayUrl(value), external: true });
    }
  }
  return out;
}

/**
 * The text to hand Google for this site, or null to fall back to its coordinate.
 *
 * It is the ADDRESS, and deliberately nothing else. There are three things this link
 * could carry, and they are not on a single scale of better:
 *
 *   coordinate     an unlabelled pin. Google has nothing to look up, so there is no
 *                  title, no hours, no Street View, no photo — a dot the resident has
 *                  to take on trust, which the map they are already looking at does
 *                  better than Google does.
 *   address        Google's card for that address: the pin, Street View, a Directions
 *                  button, and the businesses it knows are at that address. This is
 *                  the jump from nothing to something.
 *   name + address the organization's own Google profile — hours, photos, reviews —
 *                  WHEN the name matches something Google has at that address.
 *
 * The third was tried and removed. The name in this data is typed into a spreadsheet by
 * 75 different organizations and is never checked against Google's index, so prepending
 * it does not look up a place, it biases a text search. When it misses the usual result
 * is harmless — Google falls back to the address and you get the second row anyway — but
 * when it misses by matching a DIFFERENT BRANCH of the same organization, the resident is
 * sent to the wrong building with no sign anything went wrong. The risk is concentrated
 * rather than hypothetical: 20 of the addresses carry no ZIP, every one of them belongs to
 * an organization running several sites, and most belong to one organization whose 14 sites
 * share a single well-indexed listing — exactly the conditions where a name-biased search
 * lands confidently on the wrong branch. The extra hours-and-photos panel is not worth a
 * silent wrong address.
 *
 * The remaining cost is that Google re-geocodes the text with its own engine, so its pin
 * can disagree with ours, which came from NYC GeoSearch — the city's own address database,
 * and the more authoritative of the two for a NYC house number. Addresses Google reads
 * differently are corrected by hand in data/overrides.json, which writes a `maps_query`
 * onto just those features; it is absent everywhere else and so costs the payload nothing
 * for the 180 sites that do not need it.
 *
 * Which fields compose the query is config, like the rest of the card: `openInMaps.query`
 * is a list of field references, joined with commas — a dataset that keeps street, city and
 * state in separate columns lists all three. Setting `openInMaps` to `true` instead of an
 * object keeps the coordinate, which is the right choice for a dataset whose addresses are
 * too rough to hand to a global geocoder.
 */
export function mapsQuery(openInMaps, p, org) {
  const parts = (openInMaps || {}).query;
  if (!Array.isArray(parts)) return null;              // `true` => use the coordinate
  if (p.maps_query) return p.maps_query;               // hand fix from overrides.json

  const out = [];
  for (const part of parts) {
    const value = String(read(part, p, org)).trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out.join(", ") || null;
}

/**
 * The "Open in Google Maps" link for this site, or null when config.json turns it off.
 *
 * Google's documented Search URL. It used to be the Directions URL, which opens a
 * routing form already asking where you are coming from — a question the resident
 * has not been asked yet and may not want to answer. Showing them the place is the
 * smaller, more likely request; routing is one tap further on, inside the app that
 * is better at it than this block would be.
 *
 * A deep link either way, not an SDK: no key, no billing account, no third-party
 * script on the page.
 */
export function mapsLink(config, feature, org) {
  if (config.openInMaps === false) return null;
  const query = mapsQuery(config.openInMaps, feature.properties, org);
  const [lon, lat] = feature.geometry.coordinates;
  return "https://www.google.com/maps/search/?api=1&query="
    + encodeURIComponent(query || `${lat},${lon}`);
}

/**
 * The labelled fields below the buttons, from `card` in config.json, in order, as
 * `{ key, label, as, value }`. Empty fields are left out.
 *
 * The source's "DBA or Program Name" column is a mix of trading names, acronyms and
 * programme names, so it is shown as a labelled field rather than as a subtitle. 22
 * of the 185 records repeat the organization name in it; that is not a second name.
 */
export function cardFields(config, p, org) {
  const out = [];
  for (const field of config.card || []) {
    const value = read(field, p, org);
    if (!value) continue;
    if (field.key === "dba" && value.trim() === p.org.trim()) continue;
    out.push({ key: field.key, label: field.label, as: field.as, value });
  }
  return out;
}

/**
 * Turn one field's value into readable structure.
 *
 * The source strings carry their own shape and the card used to throw it away — a
 * semicolon-separated list and a five-line block of prose both arrived as one run-on
 * paragraph held together by `white-space: pre-line`. Both are hard to read for the same
 * reason: nothing tells the eye where one item ends and the next begins.
 *
 *   "a; b; c"                 -> a list, one item per line
 *   "intro:\nx\ny\nz"          -> a sentence, then a list
 *   "para one\npara two"       -> separate paragraphs
 *
 * No colour and no new type sizes involved — the readability comes from the line breaks
 * being real elements instead of characters inside one string.
 *
 * Returns one of:
 *   { kind: "intro-list", intro, items }   a sentence, then a list
 *   { kind: "paragraphs", items }
 *   { kind: "list", items }
 *   { kind: "text", text }
 */
export function parseStructure(value) {
  const lines = String(value).split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length > 1) {
    // A line ending in a colon is introducing what follows, so the rest is a list.
    if (lines[0].endsWith(":") && lines.length > 2) {
      return { kind: "intro-list", intro: lines[0], items: lines.slice(1) };
    }
    return { kind: "paragraphs", items: lines };
  }

  const parts = (lines[0] || "").split(";").map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1) return { kind: "list", items: parts };

  return { kind: "text", text: lines[0] || "" };
}

/** A data date ("2026-09-15") as the reader's language writes it. Unparseable: as given. */
export function formatDate(iso, lang) {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.valueOf())
    ? iso
    : d.toLocaleDateString(lang, { year: "numeric", month: "long", day: "numeric" });
}
