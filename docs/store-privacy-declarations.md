# Store privacy declarations

These answers describe the current Weathercast release. Re-audit them whenever analytics, accounts, advertising, background location, remote push tokens, crash reporting, or a new provider is added.

## Apple App Privacy

### Data used to track you

No.

### Data linked to you

None. This release has no account, advertising identifier, or server-side user profile.

### Data not linked to you

| Data type | Purpose | Behavior |
| --- | --- | --- |
| Precise Location | App Functionality | A selected coordinate is sent over HTTPS for forecast and radar requests. The forecast archive retains a four-decimal location cell without an account or device identifier. |

Do not declare diagnostics, contact information, identifiers, purchases, financial information, contacts, photos, browsing history, search history, or user content for this release.

## Google Play Data Safety

| Question | Answer |
| --- | --- |
| Does the app collect or share required user data types? | Collects Location; does not sell it or share it for independent third-party purposes. Contracted weather infrastructure acts as a service provider. |
| Approximate location | Collected, optional, App functionality |
| Precise location | Collected, optional, App functionality |
| Is data encrypted in transit? | Yes, production client and provider endpoints are required to use HTTPS. |
| Can users request deletion? | No account exists. Local app data is deleted through Settings or uninstall. Unlinked forecast archive cells are retained for reproducibility and accuracy verification. |
| Is collection required? | No. Users can choose and save a place instead of granting device location permission. A coordinate is still required to produce a forecast for the chosen place. |
| Ads or advertising use | None |
| Personalization use | None |
| Analytics use | None in this release |
| Fraud prevention/security use | Request metadata may be processed transiently for rate limiting and service security; no persistent user identifier is created. |

## Permission disclosures

- Foreground location only: used to choose the forecast coordinate while Weathercast is open.
- Notifications: optional, used for rain-onset reminders.
- No background location, contacts, camera, microphone, photos, Bluetooth, health, motion, or advertising permission.

## Change triggers

The declarations must change before shipping any of these:

- remote push notification tokens or server-scheduled alerts;
- crash, performance, product analytics, or session replay SDKs;
- accounts, cloud-synced places, or device identifiers;
- advertising, attribution, or cross-app tracking;
- support forms that collect email or attachments inside Weathercast;
- longer-lived IP address or raw precise-coordinate storage.
