# Google Play release

## App identity

| Field | Value |
| --- | --- |
| Developer account | Dhruv2mars |
| Account type | Personal |
| Existing Play app ID | `4971995592984091862` |
| App name | Weathercast — Rain Nowcast |
| Existing Play app package | `com.dhruv2mars.weathercast` |
| Configured package | `com.weathercast.app` |
| Default language | English (United States) |
| Pricing | Free |

The app record was created in Google Play Console on 11 July 2026 for `com.dhruv2mars.weathercast`. Google Play package names cannot be changed after an app record is created. Publishing `com.weathercast.app` therefore requires a new Play app record; it cannot update the existing app.

## Required release path

This personal developer account cannot publish a new app directly to production. Google Play Console currently requires this sequence:

1. Finish every app-content and store-listing task.
2. Upload an Android App Bundle to closed testing.
3. Publish the closed-testing release.
4. Keep at least 12 testers continuously opted in for at least 14 days.
5. Apply for production access and answer the closed-test questions.
6. After approval, create and submit the production release.

The 14-day interval is an external elapsed-time gate. Internal testing does not replace it.

## Checked-in release material

- Listing text: `store-assets/google-play/listings/en-US/`
- Release notes: `store-assets/google-play/release-notes/en-US/default.txt`
- Android screenshots: `store-assets/screenshots/android/`
- Feature graphic: `store-assets/google-play/feature-graphic.png`
- High-resolution icon: `store-assets/google-play/icon.png`
- Data Safety answers: `docs/store-privacy-declarations.md`
- Public privacy policy: `https://weathercast.expo.app/privacy`
- Public support page: `https://weathercast.expo.app/support`
- Public terms: `https://weathercast.expo.app/terms`

## Submission policy

Do not upload the release-candidate APK. Google Play requires a production Android App Bundle. Build it only after the fail-closed production configuration has an owned nowcast API, lawful radar manifest, and restricted Maps key. Do not claim Precision coverage or superiority over another provider until the registered evidence gates pass.
