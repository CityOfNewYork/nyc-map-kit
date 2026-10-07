import { track } from "../logic/analytics.js";
import {
  cardActions, cardFields, displayUrl, formatDate, hrefFor, mapsLink, parseStructure, telHref,
} from "../logic/card.js";

/**
 * One site's card: always exactly one record. What it shows is decided in logic/card.js
 * from config.json; this file only turns that into markup.
 *
 * Every visible string is its own element — see the language rule at the top of App.jsx.
 */
export function Card({ feature, model, lang }) {
  const p = feature.properties;
  const org = model.orgById.get(p.org_id) || {};
  const fields = cardFields(model.config, p, org);

  return (
    <>
      <h2 id="card-title" tabIndex={-1}>{p.org}</h2>
      <p className="where">
        <span className="addr">{p.address}</span>
        {p.borough && <span className="boro">{p.borough}</span>}
      </p>
      <ActionRow feature={feature} org={org} config={model.config} />
      {fields.length > 0 && (
        <dl>
          {fields.map((field) => [
            <dt key={`${field.key}-dt`}><span>{field.label}</span></dt>,
            <dd key={`${field.key}-dd`}><FieldValue field={field} /></dd>,
          ])}
        </dl>
      )}
      {model.generated && (
        <p className="card-footer">
          <span>Data updated</span>{" "}
          <time dateTime={model.generated}>{formatDate(model.generated, lang)}</time>
        </p>
      )}
    </>
  );
}

/**
 * Call, website, and a link out to Google Maps — the row directly under the address.
 *
 * These are the three things a resident opening a card is most likely to have come for,
 * and they used to be scattered: the phone number and the website were two rows of the
 * definition list, below "Hours" and above four fields of programme prose, and the map
 * link was at the very bottom of the card. Doing anything with a site meant reading past
 * everything describing it first.
 *
 * Which fields appear is config, not code — `actions` in config.json, in the order the
 * card should show them — so a different dataset moves its own fields up here without
 * touching this file. The Google Maps link is appended last and is the one composed
 * rather than read from a single field — see `mapsLink` in logic/card.js.
 *
 * Each button carries a label and a detail line: the label is the verb, the detail is the
 * information. That keeps the phone number and the domain visible and copyable on a
 * desktop, where `tel:` does nothing, without the row turning into an icon puzzle. Both
 * are separate text nodes, so the proxy translates the verb and leaves the number alone.
 */
function ActionRow({ feature, org, config }) {
  const p = feature.properties;
  const actions = cardActions(config, p, org);
  const maps = mapsLink(config, feature, org);
  if (!actions.length && !maps) return null;

  return (
    <div className="actions">
      {actions.map((action) => (
        <a key={action.key} className="action" href={action.href}
           target={action.external ? "_blank" : undefined}
           rel={action.external ? "noopener" : undefined}
           onClick={() => track("map_action_click", {
             org_id: p.org_id, site_id: p.id, action: action.key,
           })}>
          <span className="action-label">{action.label}</span>
          <span className="action-detail">{action.detail}</span>
        </a>
      ))}
      {maps && (
        <a className="action" href={maps} target="_blank" rel="noopener"
           onClick={() => track("map_open_in_maps_click", { org_id: p.org_id, site_id: p.id })}>
          <span className="action-label">Open in Google Maps</span>
          <span className="action-detail">see this location on a full map</span>
        </a>
      )}
    </div>
  );
}

/** One labelled field's value: a link, or text broken into paragraphs and lists. */
function FieldValue({ field }) {
  const { as, value } = field;
  if (as === "url") {
    return (
      <a href={hrefFor(value)} target="_blank" rel="noopener"><span>{displayUrl(value)}</span></a>
    );
  }
  if (as === "tel") return <a href={telHref(value)}><span>{value}</span></a>;

  const s = parseStructure(value);
  const list = (items) => (
    <ul>{items.map((item, i) => <li key={i}><span>{item}</span></li>)}</ul>
  );
  if (s.kind === "intro-list") return <><p><span>{s.intro}</span></p>{list(s.items)}</>;
  if (s.kind === "paragraphs") return s.items.map((line, i) => <p key={i}><span>{line}</span></p>);
  if (s.kind === "list") return list(s.items);
  return <span>{s.text}</span>;
}
