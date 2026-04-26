import { SongBrowser } from './SongBrowser.js'

export function RetiredSongs() {
  return (
    <SongBrowser
      defaultActive="false"
      headerLabel="Retired Songs"
      headerHint="LineageRows that have been retired — Hendrix no longer picks them. Restore brings them back into the pool. Filters narrow the view; toggle to active or all to compare."
    />
  )
}
