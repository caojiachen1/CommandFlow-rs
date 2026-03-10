import { invalidateDynamicOptionCaches, listOpenWindowEntries, listStartMenuApps } from './execution'

export const COMMAND_FLOW_REFRESH_ALL_EVENT = 'commandflow:refresh-all'

export const dispatchGlobalRefresh = () => {
  window.dispatchEvent(new Event(COMMAND_FLOW_REFRESH_ALL_EVENT))
}

export const triggerGlobalRefresh = async () => {
  invalidateDynamicOptionCaches()

  await Promise.allSettled([
    listOpenWindowEntries(),
    listStartMenuApps(true),
  ])

  dispatchGlobalRefresh()
}