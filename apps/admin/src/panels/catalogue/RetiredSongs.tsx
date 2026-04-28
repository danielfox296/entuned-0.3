import { SongBrowser } from './SongBrowser.js'

export function RetiredSongs() {
  return (
    <SongBrowser
      defaultActive="false"
      headerLabel="Retired Songs"
      headerHint=""
    />
  )
}
