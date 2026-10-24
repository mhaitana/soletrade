import type { ExpoConfig } from "expo/config";
const config: ExpoConfig = {
  name: "Soletrade",
  slug: "soletrade",
  scheme: "soletrade",
  version: "1.0.0",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "au.com.soletrade.business",
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: "Capture receipts for your business records.",
      NSPhotoLibraryUsageDescription: "Choose receipt images to attach to business records.",
      NSLocationWhenInUseUsageDescription: "Record distance during a shift you start.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Keep recording your active shift while the app is in the background.",
      NSFaceIDUsageDescription: "Unlock your private business information.",
      UIBackgroundModes: ["location", "fetch", "remote-notification"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "au.com.soletrade.business",
    permissions: [
      "CAMERA",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_FINE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS",
    ],
  },
  plugins: [
    "expo-router",
    "expo-system-ui",
    "expo-secure-store",
    "expo-dev-client",
    "expo-sqlite",
    [
      "expo-image-picker",
      {
        photosPermission: "Choose receipts for your business records.",
        cameraPermission: "Capture receipts for your business records.",
      },
    ],
    [
      "expo-location",
      {
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    "expo-notifications",
    "expo-local-authentication",
    "expo-iap",
    "expo-quick-actions",
    ["react-native-maps", { androidGoogleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY }],
    [
      "expo-widgets",
      {
        enableAndroid: true,
        widgets: [
          {
            name: "SoletradeOverview",
            displayName: "Soletrade",
            description: "Last-synced business overview and quick actions",
            ios: {
              supportedFamilies: ["systemSmall", "systemMedium"],
              initialLayout: "./src/native/overview-widget.ios.tsx",
            },
            android: {
              initialLayout: "./src/native/overview-widget.android.tsx",
              targetCellWidth: 3,
              targetCellHeight: 2,
            },
          },
        ],
      },
    ],
    "./plugins/with-android-quick-widget",
  ],
  experiments: { typedRoutes: true },
};
export default config;
