---
name: AI provider routing
description: Hosted label recognition uses a server-side OpenRouter secret; local OpenAI-compatible models are called directly from the mobile app.
---

Hosted AI credentials must stay server-side, while a local model endpoint may need to be reached directly from the Android device on the user's LAN.

**Why:** The managed OpenRouter integration may require an account upgrade, and a Replit-hosted server cannot reach a model running on the user's phone or home network.

**How to apply:** Keep the hosted provider behind the API server and store local endpoint settings on-device; never embed hosted provider secrets in the Expo bundle.