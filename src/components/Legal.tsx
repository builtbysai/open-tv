import { useState } from "react";
import { Flag, ExternalLink, Copy, Mail } from "lucide-react";
import { takedownEmail, publicReportEndpoint } from "../config/safety";
import {
  publicReportUrl,
  reportReasons,
  validNotice,
  type CopyrightNotice,
  type ReportTarget,
} from "../domain/reporting";
import { exportJson } from "../persistence/export";
export function Legal({ target }: { target?: ReportTarget }) {
  const [reason, setReason] = useState<string>(reportReasons[0]);
  const [notice, setNotice] = useState<CopyrightNotice>({
    name: "",
    email: "",
    address: "",
    work: "",
    location: "",
    signature: "",
    goodFaith: false,
    accurate: false,
  });
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  // What a report needs, in plain text, for sites without a report form.
  const details = [
    `Reason: ${reason}`,
    target ? `Listing: ${target.id}` : "",
    target && !target.restricted ? `Source: ${target.providerId}` : "",
    `Page: ${location.origin}${location.pathname}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="legal-content">
      <h1>Content reports</h1>
      <p className="description">
        Report a broken stream, incorrect classification or copyright concern.
      </p>
      <section className="settings-section">
        <h2>
          <Flag size={23} /> Report a listing
        </h2>
        <p>Choose a reason and open a listing report.</p>
        {target && (
          <p className="source-note">
            Content reference: {target.id}
            {target.restricted
              ? " · private source"
              : ` · ${target.providerId}`}
          </p>
        )}
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {reportReasons.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <p className="fine-print">
          Listing reports may be public. Send personal information and formal
          copyright notices privately.
        </p>
        {target?.restricted ? (
          <p>Use a private notice for this source.</p>
        ) : (
          <a
            className="button secondary"
            href={publicReportUrl(
              target,
              reason,
              publicReportEndpoint || undefined,
            )}
            target="_blank"
            rel="noreferrer"
          >
            {publicReportEndpoint
              ? "Open listing report"
              : "Open GitHub listing report"}{" "}
            <ExternalLink size={16} />
          </a>
        )}
        {!publicReportEndpoint && !target?.restricted && (
          <>
            <p role="note">
              This site has no public report form. The GitHub link needs a
              GitHub account. Otherwise copy the details below
              {takedownEmail ? " or send them by email" : ""} to the site
              operator.
            </p>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(details)
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
              >
                <Copy size={16} /> {copied ? "Copied" : "Copy report details"}
              </button>
              {takedownEmail && !target?.restricted && (
                <a
                  className="button secondary"
                  href={`mailto:${takedownEmail}?subject=${encodeURIComponent("Open TV listing report")}&body=${encodeURIComponent(details)}`}
                >
                  <Mail size={16} /> Email the details
                </a>
              )}
            </div>
          </>
        )}
      </section>
      <section className="settings-section">
        <h2>Copyright & takedown notices</h2>
        {takedownEmail ? (
          <p>
            Send formal notices privately to{" "}
            <a href={`mailto:${takedownEmail}`}>{takedownEmail}</a>. Include
            enough information to identify the work and the exact Open TV
            listing or location.
          </p>
        ) : (
          <p role="note">
            The operator has not yet published a copyright contact. You can
            download a notice to send once a contact is available.
          </p>
        )}
        <p>
          Complete these fields and statements to prepare a US copyright notice.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!validNotice(notice)) {
              setMessage("Complete the required notice fields and statements.");
              return;
            }
            exportJson("open-tv-takedown-notice.json", {
              version: 1,
              kind: "copyright-notice",
              createdAt: new Date().toISOString(),
              ...notice,
            });
            setMessage(
              "Notice prepared on your device. It has not been submitted. Send it privately to the published contact.",
            );
          }}
        >
          <div className="form-grid">
            {(
              [
                ["name", "Your name"],
                ["email", "Contact email"],
                ["address", "Postal contact address"],
                ["work", "Copyrighted work and ownership"],
                ["location", "Exact Open TV listing or location"],
                ["signature", "Electronic signature"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required
                  type={key === "email" ? "email" : "text"}
                  autoComplete="off"
                  maxLength={key === "email" ? 254 : 5000}
                  value={notice[key]}
                  onChange={(e) =>
                    setNotice({ ...notice, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              required
              checked={notice.goodFaith}
              onChange={(e) =>
                setNotice({ ...notice, goodFaith: e.target.checked })
              }
            />
            I have a good-faith belief that the use is not authorized by the
            copyright owner, its agent, or the law.
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              required
              checked={notice.accurate}
              onChange={(e) =>
                setNotice({ ...notice, accurate: e.target.checked })
              }
            />
            The information is accurate and, under penalty of perjury, I am
            authorized to act for the owner of the exclusive right.
          </label>
          <p className="fine-print">
            Downloading saves your notice on this device. It does not submit it.
          </p>
          <button className="button secondary">Download private notice</button>
        </form>
        {message && <p role="status">{message}</p>}
      </section>
      <section className="settings-section">
        <h2>How reports are handled</h2>
        <p>
          Maintainers review the reported location and rights information.
          Listings may be restricted or removed; repeated misuse can lead to
          source removal. Counter-notices and restoration require human review.
        </p>
        <p>
          DMCA safe-harbor eligibility depends on meeting the applicable legal
          requirements, including a monitored contact and designated agent.
        </p>
        <a
          href="https://www.copyright.gov/512/"
          target="_blank"
          rel="noreferrer"
        >
          US Copyright Office: notice, counter-notice and safe-harbor
          requirements
        </a>
      </section>
      <section className="settings-section">
        <h2>Age & privacy</h2>
        <p>
          The 18+ confirmation is a declaration, not identity verification. 18+
          content stays hidden until you show it in Settings. While it is shown,
          activity is not saved, with optional device PIN protection.
        </p>
        <p>
          No identity documents or birth dates are collected. Where stronger age
          assurance is required, operators must use a verified gateway or
          disable restricted viewing.
        </p>
      </section>
    </div>
  );
}
