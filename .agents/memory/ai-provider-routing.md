---
name: AI provider routing
description: Hosted label recognition uses a server-side OpenRouter secret; local OpenAI-compatible models are called directly from the mobile app.
---

Keep the project-owned OpenRouter credential server-side. A user-provided OpenRouter key belongs in device secure storage and should be sent only with the label-analysis request; never put it in AsyncStorage, the Expo bundle, or server logs. A local model endpoint may need to be reached directly from the Android device on the user's LAN.

**Why:** This preserves the project's hosted fallback while supporting user-owned credentials without leaving them in ordinary app settings or build output; a hosted server also cannot reach a model running on the user's phone or home network.

**How to apply:** The optional request key may override the server fallback for that request only. Keep local endpoint settings on-device and call local OpenAI-compatible models directly.