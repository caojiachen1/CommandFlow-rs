import type { StartMenuAppPayload } from './execution'

export const getStartMenuAppDisplayName = (app: Pick<StartMenuAppPayload, 'appName' | 'targetPath' | 'sourcePath'>) =>
  app.appName.trim() || app.targetPath.trim() || app.sourcePath.trim() || '未命名应用'

export const filterStartMenuApps = (apps: StartMenuAppPayload[], query: string) => {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return apps

  return apps.filter((app) => {
    const haystacks = [
      getStartMenuAppDisplayName(app),
      app.targetPath,
      app.sourcePath,
    ]

    return haystacks.some((item) => item.trim().toLowerCase().includes(keyword))
  })
}

export const buildLaunchApplicationParams = (
  currentParams: Record<string, unknown>,
  app: StartMenuAppPayload,
): Record<string, unknown> => ({
  ...currentParams,
  selectedApp: app.sourcePath,
  appName: app.appName,
  targetPath: app.targetPath,
  iconPath: app.iconPath,
  sourcePath: app.sourcePath,
})