---
name: verify
summary: Build and drive Weathercast Android release APK on an emulator
---

# Weathercast Android verification

This local APK verifies UI/runtime behavior only. Authoritative shipping verification must use the EAS `production` AAB installed from Google Play closed testing with production environment values and Play App Signing.

```bash
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-5554}"
export WEATHERCAST_AVD="${WEATHERCAST_AVD:-Pixel_9_Pro_API_35}"
```

1. Start `$WEATHERCAST_AVD`; wait for `adb -s "$ANDROID_SERIAL" shell getprop sys.boot_completed` to return `1`.
2. Regenerate native project: `bunx expo prebuild --platform android --clean --no-install`.
3. Build ARM64 release with enough Metaspace:
   `./android/gradlew -p ./android assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a -Dorg.gradle.jvmargs='-Xmx6g -XX:MaxMetaspaceSize=2g -Dfile.encoding=UTF-8'`
4. Install without Metro: `adb -s "$ANDROID_SERIAL" install -r android/app/build/outputs/apk/release/app-release.apk`.
5. Clear first-run state when needed: `adb -s "$ANDROID_SERIAL" shell pm clear com.dhruv2mars.weathercast`.
6. Launch: `adb -s "$ANDROID_SERIAL" shell am start -W -n com.dhruv2mars.weathercast/.MainActivity`.
7. Capture screenshots, UI trees, focused logcat, package metadata, and APK SHA-256.
8. Emulator location uses longitude first: `adb -s "$ANDROID_SERIAL" emu geo fix 77.2090 28.6139`.
9. Restore network, rotation, and day/night settings afterward.

Gotchas: Expo CLI serial lookup may fail; direct Gradle + ADB works. Default Gradle Metaspace can fail during native lint/KSP; use JVM args above.
