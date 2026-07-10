# Release checklist

## Automated gates

- [ ] `bun run check`
- [ ] `bunx expo-doctor`
- [ ] `bun run export`
- [ ] Signed iOS and Android production builds install and launch
- [ ] Core flows pass on a current iPhone and Android device
- [ ] Crash-free, API latency, provider freshness, and alert-delivery monitoring configured

## Data and accuracy gates

- [ ] Owned `/v1/nowcast` backend configured; evaluation fallback disabled
- [ ] EAS production environment passes the fail-closed config validation
- [ ] Commercial rights and redistribution terms signed for every regional source
- [ ] Radar manifest/tile CDN configured for Precision regions
- [ ] Android-restricted Google Maps SDK key configured for the release signing certificate
- [ ] Forecast archive, observation truth set, and verification jobs operating
- [ ] Confidence labels validated by reliability curves
- [ ] Accuracy claims include metric, horizon, region, dates, and sample size
- [ ] Provider outages degrade to a named lower coverage tier

## Store and legal gates

- [ ] Active Apple Developer and Google Play accounts
- [ ] Unique bundle/package identifiers confirmed
- [ ] Public privacy-policy and terms URLs published
- [ ] Operational support channel tested
- [ ] App icon, screenshots, descriptions, age rating, privacy nutrition labels, and Data Safety form approved
- [ ] Location/notification permission copy matches actual behavior
- [ ] Country-specific privacy and meteorological data review completed

## Operations gates

- [ ] Rate limits, abuse controls, secret rotation, and alerting enabled
- [ ] On-call owner and incident runbook assigned
- [ ] Provider freshness SLO and point-API availability SLO defined
- [ ] Rollback tested through store release tracks and EAS Update policy
- [ ] Account deletion omitted only while the app truly has no accounts or server-side profiles

Unchecked external gates mean the repository is a verified product client, not a truthful generally available precision-nowcasting service.
