# WP Article Manager — React Native

A focused mobile app for managing WordPress articles across multiple sites.

## Features

- React Native 0.86 + TypeScript + Expo SDK 57
- Multiple WordPress sites in one app
- Separate Application Password authentication per site
- Credentials encrypted with Expo SecureStore
- Native article list, search and status filters
- Create, edit and trash posts entirely inside the app
- Content saved as Gutenberg paragraph blocks
- No dependency on `wp-admin`, WebView or browser login

## WordPress setup

1. In WordPress, open **Users → Profile**.
2. Create an **Application Password**.
3. Add the site URL, username and Application Password in the app.
4. The selected WordPress user must be allowed to create and edit posts.

HTTPS is required.

## Local development

```bash
npm install
npx expo prebuild --platform android --clean
npx expo run:android
```

## Build APK

```bash
npm install
npx expo prebuild --platform android --clean
cd android
./gradlew assembleDebug
```

APK path:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
