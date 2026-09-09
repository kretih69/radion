type PrivacyPolicyProps = {
  onClose: () => void;
};

const EFFECTIVE_DATE = "9 September 2026";

export function PrivacyPolicy({ onClose }: PrivacyPolicyProps) {
  return (
    <div className="legal-screen" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <button
        type="button"
        className="legal-screen__backdrop"
        aria-label="Close privacy policy"
        onClick={onClose}
      />
      <div className="legal-screen__panel">
        <button
          type="button"
          className="legal-screen__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        <p className="legal-screen__brand">RadiOn Online</p>
        <h1 id="privacy-title" className="legal-screen__title">
          Privacy Policy
        </h1>
        <p className="legal-screen__meta">Effective date: {EFFECTIVE_DATE}</p>

        <div className="legal-screen__body">
          <p>
            This Privacy Policy explains how RadiOn Online (“RadiOn Online”,
            “we”, “us”, or “our”) collects, uses, stores, and shares information
            when you use our radio station browser website and related API
            services (the “Service”).
          </p>
          <p>
            By creating an account or using the Service, you acknowledge this
            Policy. If you do not agree, please do not use the Service or create
            an account.
          </p>

          <h2>1. Who we are</h2>
          <p>
            RadiOn Online is an internet radio discovery and listening
            application. Station catalogue and stream metadata are provided via
            third-party radio directory services; playback streams are delivered
            through our backend proxy where needed for reliable playback and
            audio features.
          </p>
          <p>
            For privacy questions, contact us at{" "}
            <a href="mailto:info@valior.hr">
              info@valior.hr
            </a>
            .
          </p>

          <h2>2. Information we collect</h2>
          <h3>2.1 Account information</h3>
          <p>If you register or sign in, we may process:</p>
          <ul>
            <li>Name and email address</li>
            <li>
              Password (stored only as a one-way hash; we never store your plain
              password)
            </li>
            <li>
              Google account identifiers and profile details when you use Google
              sign-in (such as Google subject ID, name, email, and profile photo
              URL provided by Google)
            </li>
            <li>Account creation timestamp</li>
          </ul>

          <h3>2.2 Service data you create</h3>
          <p>When you use signed-in features, we store:</p>
          <ul>
            <li>Favorite stations and related station metadata you save</li>
            <li>Music/genre preference tags you choose</li>
            <li>Last played station information associated with your account</li>
          </ul>

          <h3>2.3 Technical and usage data</h3>
          <p>To operate and secure the Service, we may process:</p>
          <ul>
            <li>
              Authentication tokens and session identifiers stored in your
              browser
            </li>
            <li>
              Approximate location derived from your public IP (country code
              only), used to suggest local stations — this lookup may run in your
              browser via a third-party IP geolocation provider
            </li>
            <li>
              Standard server logs (for example IP address, timestamps, request
              paths, and error diagnostics) retained for security and
              reliability
            </li>
            <li>
              Stream proxy requests needed to play stations and power in-app
              audio features (such as equalizer and spectrum visualization)
            </li>
          </ul>

          <h3>2.4 What we do not intentionally collect</h3>
          <ul>
            <li>Payment card details (we do not process payments)</li>
            <li>
              Precise GPS location from your device sensors
            </li>
            <li>
              Marketing profiles built from third-party advertising trackers (we
              do not embed advertising SDKs in the Service as of the effective
              date)
            </li>
          </ul>

          <h2>3. How we use information</h2>
          <p>We use personal data to:</p>
          <ul>
            <li>Create and manage your account and authenticate you</li>
            <li>
              Provide favorites, preferences, last-played resume, and personalised
              discovery features
            </li>
            <li>Play radio streams and provide audio visualization/equalizer features</li>
            <li>Maintain security, prevent abuse, and troubleshoot issues</li>
            <li>Comply with legal obligations and enforce our terms</li>
            <li>Improve reliability and user experience of the Service</li>
          </ul>
          <p>
            We do not sell your personal information. We do not use your account
            content to train third-party advertising models.
          </p>

          <h2>4. Legal bases (EEA/UK users)</h2>
          <p>Where applicable data protection law requires a legal basis, we rely on:</p>
          <ul>
            <li>
              <strong>Contract</strong> — to provide the Service you request
              (account, favorites, playback)
            </li>
            <li>
              <strong>Legitimate interests</strong> — to secure the Service,
              prevent fraud/abuse, and improve reliability, balanced against your
              rights
            </li>
            <li>
              <strong>Consent</strong> — where required (for example certain
              optional integrations); you may withdraw consent where applicable
            </li>
            <li>
              <strong>Legal obligation</strong> — when we must retain or disclose
              information to comply with law
            </li>
          </ul>

          <h2>5. Cookies and local storage</h2>
          <p>
            The Service uses browser local storage (not advertising cookies) to
            keep you signed in, including:
          </p>
          <ul>
            <li>Authentication token</li>
            <li>Cached basic account profile (name, email, avatar URL)</li>
          </ul>
          <p>
            These items are necessary for signed-in features. Clearing site data
            in your browser signs you out. We do not use third-party advertising
            cookies as part of the core Service.
          </p>

          <h2>6. Sharing and processors</h2>
          <p>We share information only as needed to run the Service:</p>
          <ul>
            <li>
              <strong>Hosting providers</strong> — website and API hosting (for
              example Netlify and Railway or equivalent infrastructure) process
              data on our behalf
            </li>
            <li>
              <strong>Database hosting</strong> — account and preference data are
              stored in our managed PostgreSQL database
            </li>
            <li>
              <strong>Google</strong> — if you choose Google sign-in, Google
              processes authentication under Google’s terms and privacy policy;
              we receive verified identity assertions and basic profile fields
            </li>
            <li>
              <strong>Radio directory / stream sources</strong> — station search
              and playback involve third-party radio browser/directory APIs and
              station operators; stream URLs and related metadata may be
              requested through our servers
            </li>
            <li>
              <strong>IP geolocation</strong> — approximate country detection may
              use a third-party geolocation API from your browser
            </li>
            <li>
              <strong>Legal disclosures</strong> — we may disclose information if
              required by law, court order, or to protect rights, safety, and
              security
            </li>
          </ul>
          <p>
            Third parties process data under their own policies when you interact
            with them directly (for example Google sign-in dialogs or station
            stream origins).
          </p>

          <h2>7. International transfers</h2>
          <p>
            Our infrastructure and some processors may be located outside your
            country, including the European Economic Area, United Kingdom, or
            United States. Where required, we rely on appropriate safeguards
            (such as standard contractual clauses or provider mechanisms) for
            cross-border transfers.
          </p>

          <h2>8. Retention</h2>
          <ul>
            <li>
              Account and associated favorites, preferences, and last-played data
              are kept while your account remains active
            </li>
            <li>
              If you delete your account, we delete your user record and related
              stored account data (favorites, preference tags, last played)
              from our database, subject to short-lived backups and logs that
              expire in the ordinary course of operations
            </li>
            <li>
              Security and server logs are retained only as long as reasonably
              needed for security, debugging, and legal compliance
            </li>
          </ul>

          <h2>9. Your rights and choices</h2>
          <p>Depending on your location, you may have rights to:</p>
          <ul>
            <li>Access the personal data we hold about you</li>
            <li>Correct inaccurate data</li>
            <li>Delete your account and associated data</li>
            <li>Object to or restrict certain processing</li>
            <li>Data portability, where applicable</li>
            <li>Withdraw consent where processing is consent-based</li>
            <li>Lodge a complaint with a supervisory authority</li>
          </ul>
          <p>
            In the Service you can delete your account from your profile menu
            (“Delete account”). That action permanently removes your account
            data as described above after confirmation. You can also log out at
            any time and clear browser storage.
          </p>
          <p>
            To exercise other rights, email{" "}
            <a href="mailto:info@valior.hr">
              info@valior.hr
            </a>
            . We may need to verify your identity before fulfilling requests.
          </p>

          <h2>10. Children</h2>
          <p>
            The Service is not directed to children under 16 (or the minimum age
            required in your jurisdiction). We do not knowingly collect personal
            data from children. If you believe a child has provided us personal
            data, contact us and we will take appropriate steps to delete it.
          </p>

          <h2>11. Security</h2>
          <p>
            We use reasonable technical and organisational measures to protect
            personal data, including HTTPS transport, hashed passwords, and
            access-controlled databases. No method of transmission or storage is
            completely secure; you use the Service at your own risk and should
            choose a strong unique password where applicable.
          </p>

          <h2>12. Audio streams and third-party content</h2>
          <p>
            Radio stations are operated by third parties. Their streams,
            broadcasts, and any data those operators collect are outside our
            control. Our stream proxy may temporarily relay audio bytes to enable
            playback and browser audio features; we do not use this relay to
            build advertising profiles of your listening.
          </p>

          <h2>13. Changes to this Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will revise
            the effective date above and, where appropriate, provide additional
            notice in the Service. Continued use after changes become effective
            constitutes acceptance of the updated Policy.
          </p>

          <h2>14. Contact</h2>
          <p>
            Privacy requests and questions:{" "}
            <a href="mailto:info@valior.hr">
              info@valior.hr
            </a>
          </p>
          <p>Service: RadiOn Online (radion-online.com)</p>
        </div>
      </div>
    </div>
  );
}
