// Navigation glue for the file browser (app/browse.tsx). Opens the browser
// for a connection's files, activating the connection first when it isn't
// active — the browser always works against the ACTIVE connection's client,
// so browsing a dormant server without switching would show the wrong tree.
// The start directory is the connection's defaultProjectDir when set.
import { router } from "expo-router"
import type { ServerConnection } from "./types"

export async function openFileBrowser(
  connection: ServerConnection,
  isActive: boolean,
  setActiveConnection: (id: string) => Promise<void>,
): Promise<void> {
  if (!isActive) await setActiveConnection(connection.id)
  const dir = connection.defaultProjectDir?.trim()
  if (dir) router.push({ pathname: "/browse", params: { dir } })
  else router.push("/browse")
}
