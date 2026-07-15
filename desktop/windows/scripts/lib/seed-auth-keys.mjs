export function selectSeedKeys(
  keys,
  { authOnly = false, firebaseOnly = false, gauntlet = false } = {}
) {
  if (firebaseOnly) return keys.filter((key) => key.startsWith('firebase:'))
  if (authOnly || gauntlet)
    return keys.filter((key) => key.startsWith('firebase:') || key === 'omi-windows-prefs-v1')
  return keys
}

export function prepareSeedEntries(data, options = {}) {
  return selectSeedKeys(Object.keys(data), options).map((key) => {
    if (key !== 'omi-windows-prefs-v1' || !options.gauntlet) return [key, data[key]]
    const preferences = JSON.parse(data[key])
    return [
      key,
      JSON.stringify({ ...preferences, continuousRecording: false, retentionMode: 'off' })
    ]
  })
}
