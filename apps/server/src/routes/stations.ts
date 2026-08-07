// Public station catalogue.
//
// Unauthenticated on purpose: the signup picker at app.entuned.co/start renders
// before an account exists, so it can reach neither /me/stations (session
// cookie) nor /hendrix/stations (Bearer or store slug). The payload is the same
// marketing copy the picker shows — station names and who each is for — with no
// store, pool, tenant, or ICP data attached.
//
// SSOT: ../../../../entune v0.3/schema/23-stations.md

import type { FastifyPluginAsync } from 'fastify'
import { listActiveStations } from '../lib/stations.js'

export const stationRoutes: FastifyPluginAsync = async (app) => {
  // GET /stations — active stations in picker order.
  app.get('/', async () => {
    return { stations: await listActiveStations() }
  })
}
