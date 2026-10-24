#!/bin/bash

# NeuroClaw Android APK Build Script
#
# This script builds the Android APK for NeuroClaw.
#
# Requirements:
#  - Android SDK (set ANDROID_HOME or pass --android-home)
#  - Gradle (installed globally or via ./gradlew)
#  - Java 21+ (JDK)
#
# Usage:
#   ./scripts/build-android-apk.sh [--android-home /path/to/sdk] [--debug]
#
# Output:
#   mobile/android/app/build/outputs/apk/debug/app-debug.apk

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$PROJECT_ROOT/mobile/android"

# Defaults
DEBUG=true
ANDROID_HOME="${ANDROID_HOME:-}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --android-home)
      ANDROID_HOME="$2"
      shift 2
      ;;
    --release)
      DEBUG=false
      shift
      ;;
    --debug)
      DEBUG=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo ""
      echo "Usage: $0 [--android-home /path/to/sdk] [--debug|--release]"
      exit 1
      ;;
  esac
done

# Validate prerequisites
if [ -z "$ANDROID_HOME" ]; then
  if command -v android &>/dev/null; then
    ANDROID_HOME=$(dirname "$(dirname "$(command -v android)")")
  else
    echo "Error: ANDROID_HOME not set and Android SDK not found in PATH"
    echo ""
    echo "Set ANDROID_HOME:"
    echo "  export ANDROID_HOME=/path/to/Android/sdk"
    echo ""
    echo "Then run: $0"
    exit 1
  fi
fi

if ! command -v gradle &>/dev/null && [ ! -f "$ANDROID_DIR/gradlew" ]; then
  echo "Error: Gradle not found. Install it or use the Gradle wrapper."
  exit 1
fi

# Export for build
export ANDROID_HOME

# Build
cd "$ANDROID_DIR"

echo "Building NeuroClaw Android APK..."
echo "Android SDK: $ANDROID_HOME"
echo "Debug build: $DEBUG"
echo ""

if [ -f gradlew ]; then
  ./gradlew assembleDebug
else
  gradle assembleDebug
fi

# Output path
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"

if [ -f "$APK_PATH" ]; then
  echo ""
  echo "✓ Build successful!"
  echo ""
  echo "APK location:"
  echo "  $APK_PATH"
  echo ""
  echo "File size: $(du -h "$APK_PATH" | cut -f1)"
  echo ""
  echo "To install on a device:"
  echo "  adb install -r $APK_PATH"
  echo ""
  echo "Or sideload manually:"
  echo "  1. Enable 'Unknown sources' in device settings"
  echo "  2. Transfer the APK to your phone"
  echo "  3. Tap the APK file to install"
else
  echo ""
  echo "✗ Build failed: APK not found at $APK_PATH"
  exit 1
fi
