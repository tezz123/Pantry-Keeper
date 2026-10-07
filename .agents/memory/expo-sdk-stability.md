---
name: Expo SDK stability
description: Pantry Keeper's SDK upgrade policy and package-registry release-age constraint.
---

Keep Pantry Keeper on stable Expo SDK 57 until Expo SDK 58 is generally available. SDK 57 patch alignment is desirable, but the package registry can temporarily reject newly published compatible patches because of its minimum-release-age safeguard.

**Why:** The user explicitly chose to wait for stable SDK 58, and a recent SDK 57 patch update was blocked by the registry's release-age check.

**How to apply:** Do not switch to an SDK 58 preview or weaken package release-age settings. Retry recommended SDK 57 patch updates after the registry's waiting period has elapsed.