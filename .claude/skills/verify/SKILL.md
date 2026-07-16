---
name: verify
summary: Build and drive Weathercast Android release APK on emulator
---

# Weathercast Android verification

1. Start `Pixel_9_Pro_API_35`; wait for `adb -s emulator-5554 shell getprop sys.boot_completed` to return `1`.
2. Regenerate native project:
   `bunx expo prebuild --platform android --clean --no-install`
3. Build ARM64 release with enough Metaspace:
   `/Users/dhruv2mars/dev/github/weathercast/android/gradlew -p /Users/dhruv2mars/dev/github/weathercast/android assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a -Dorg.gradle.jvmargs='-Xmx6g -XX:MaxMetaspaceSize=2g -Dfile.encoding=UTF-8'`
4. Install exact artifact without Metro:
   `adb -s emulator-5554 install -r android/app/build/outputs/apk/release/app-release.apk`
5. Clear first-run state when needed:
   `adb -s emulator-5554 shell pm clear com.dhruv2mars.weathercast`
6. Launch:
   `adb -s emulator-5554 shell am start -W -n com.dhruv2mars.weathercast/.MainActivity`
7. Drive UI with ADB/Codex computer use. Capture screenshots via `adb exec-out screencap -p`, UI trees via `uiautomator dump`, focused logcat, and APK SHA-256.
8. For location, grant foreground permissions, enable services, then inject coordinates with longitude first:
   `adb -s emulator-5554 emu geo fix 77.2090 28.6139`
9. Restore network, rotation, and day/night settings after verification.

Gotchas: Expo CLI `--device emulator-5554` may not resolve serial names. Direct Gradle + ADB works. Default Gradle Metaspace can fail during Expo Updates KSP/lint; use JVM args above.
