# Mood

Two-tap mood diary with stats, backup and PDF. Free, no ads, no account.

Check in with two taps: pick how you feel, add what you did, done. Mood Days is a mood journal that keeps everything on your phone, shows you patterns with the numbers behind them, and costs nothing: no ads, no account, no subscription.

**Get it:** [GitHub Releases](https://github.com/plainappsforever/mood-journal/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/mood-journal)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Mood is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

LOG IN TWO TAPS
• Five faces on the home screen: tap one, add activities (sport, friends, sleep …), save.
• Several entries a day, a note with a title, up to 3 photos per entry.
• Your own moods, emoji, colours and activity groups.
• "My day ends at 3:00": late-night entries count for the day before.

SEE PATTERNS, WITH THE COUNTS
• Average mood, always with the number of days and entries it is based on.
• Mood by day, week or month, by weekday and by month, a calendar and a Year in Pixels.
• For every activity: your mood with and without it, on the same day and on the next day, labelled "Clear difference", "Could be chance" or "No clear difference", with the counts. It shows what happened together, never why.
• Activities that often come together, goals such as "sport 3 times a week", days in a row.

YOUR DATA, YOUR FOLDER
• Automatic backup into a folder you choose on this phone (or a cloud folder your phone offers in its file picker), encrypted by default, at most once a day.
• A backup file, encrypted if you like, to move your journal to a new phone, Android or iPhone.
• CSV export of every entry and a PDF report for 7 days, 30 days, a month or a year.
• Switching from Daylio? Import its backup file or CSV export, with a preview and your choice of mood levels. Importing the same file again adds nothing.

QUIET BY DESIGN
• No sign-up and no questions at the first start.
• Reminders only if you turn them on. They say "How was your day?" and never show anything from your journal.
• Lock with your fingerprint or your phone's passcode; while locked the app is hidden in the recent-apps view.
• Home-screen widget: tap a face to start an entry.
• 15 languages.

PRIVATE
Your journal stays on this phone. No account, no ads, no analytics, and the app has no internet permission. Google's cloud backup leaves the journal out; backups go only where you put them.

Mood Days is a personal journal, not a medical device, and does not diagnose, treat, cure or prevent any medical condition. For medical advice, talk to a doctor or another healthcare professional. If you are struggling, talk to someone you trust.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: published with the first release

## Build from source

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/mood-journal.git
cd mood-journal
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Mood was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
