const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

// Release builds block plain-HTTP requests by default, but local AI servers
// (e.g. Ollama on the LAN) and self-hosted backends are usually plain HTTP.
module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:usesCleartextTraffic'] = 'true';
    return mod;
  });
};
