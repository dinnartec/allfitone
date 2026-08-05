# Allfit Space — mobile

Not scaffolded yet, Expo. Client of `/space/v1`.

- **Headless** login: native screens built with `@allfitone/react-native`. The app
  never talks to the identity provider — it sends credentials to the API, which
  makes the call with the server-side API key.
- Tokens in `expo-secure-store`, never `AsyncStorage`.
- Social login does open a browser: Google and Apple require it, not the provider.
- Local drafts for execution, profile and structured nutrition capture.
- Not deployed to Vercel: EAS Build to the stores, EAS Update for JS.
