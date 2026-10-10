#!/usr/bin/env python3
"""Patch the Expo-generated Gradle build file to add release signing config.

Usage: python3 patch-signing.py <path-to-android-dir>

Expects signing.properties to already exist in the android directory.
Handles both Groovy (build.gradle) and Kotlin DSL (build.gradle.kts).
"""
import sys
import os
import re

android_dir = sys.argv[1]

# Detect which build file type exists
kts_path = os.path.join(android_dir, "app", "build.gradle.kts")
groovy_path = os.path.join(android_dir, "app", "build.gradle")

if os.path.isfile(kts_path):
    build_file = kts_path
    is_kts = True
elif os.path.isfile(groovy_path):
    build_file = groovy_path
    is_kts = False
else:
    print("ERROR: No build.gradle or build.gradle.kts found in app/")
    sys.exit(1)

print(f"Patching {build_file}")
src = open(build_file).read()

if is_kts:
    signing_block = """
    signingConfigs {
        create("release") {
            val props = java.util.Properties()
            props.load(rootProject.file("signing.properties").inputStream())
            storeFile = file(props["RELEASE_STORE_FILE"] as String)
            storePassword = props["RELEASE_STORE_PASSWORD"] as String
            keyAlias = props["RELEASE_KEY_ALIAS"] as String
            keyPassword = props["RELEASE_KEY_PASSWORD"] as String
        }
    }
"""
    if "signingConfigs" not in src:
        src = src.replace("android {", "android {" + signing_block, 1)

    # Wire signing config into release buildType
    if 'signingConfig = signingConfigs' not in src:
        src = re.sub(
            r'(getByName\("release"\)\s*\{)',
            r'\1\n            signingConfig = signingConfigs.getByName("release")',
            src,
            count=1,
        )
else:
    signing_block = """
    signingConfigs {
        release {
            def props = new Properties()
            props.load(rootProject.file("signing.properties").newDataInputStream())
            storeFile file(props["RELEASE_STORE_FILE"])
            storePassword props["RELEASE_STORE_PASSWORD"]
            keyAlias props["RELEASE_KEY_ALIAS"]
            keyPassword props["RELEASE_KEY_PASSWORD"]
        }
    }
"""
    if "signingConfigs" not in src:
        src = src.replace("android {", "android {" + signing_block, 1)

    if "signingConfig signingConfigs.release" not in src:
        src = re.sub(
            r"(release\s*\{)",
            r"\1\n            signingConfig signingConfigs.release",
            src,
            count=1,
        )

open(build_file, "w").write(src)
print("Signing config patched successfully")
