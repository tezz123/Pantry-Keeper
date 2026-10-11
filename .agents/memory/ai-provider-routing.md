---
name: AI provider routing
description: The app has no backend; label recognition calls OpenRouter or a local OpenAI-compatible model directly from the device.
---

There is no project-owned server or project API key. Both providers are called straight from the phone through the same OpenAI-compatible chat-completions request: OpenRouter with the user's own key, or a local endpoint (e.g. Ollama on the LAN). The user's OpenRouter key lives only in device secure storage (expo-secure-store) and is sent only to OpenRouter; never put it in AsyncStorage, the JS bundle, logs, or CI variables.

**Why:** The Replit-hosted API server was dropped (no hosting target), and a hosted server could not reach a model on the user's LAN anyway. A project-owned key in a public repo's backend would be an abuse target.

**How to apply:** New AI providers should plug into the provider selection in `readLabelPhoto`/`chatTarget` (`app/index.tsx`) rather than reintroducing a proxy server. A future self-hosted backend (see `docs/evershelf.md`) is configured by the user (URL + token in Settings/SecureStore), not baked into the build. The removed server and OpenAPI codegen pipeline are recoverable from git commit `8054286`.
