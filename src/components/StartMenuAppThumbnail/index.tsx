import { useEffect, useState } from 'react'
import { resolveStartMenuAppIcon } from '../../utils/execution'
import { getStartMenuAppDisplayName } from '../../utils/startMenuApp'

interface StartMenuAppThumbnailProps {
  appName: string
  iconPath?: string
  targetPath?: string
  sourcePath?: string
  className?: string
  imageClassName?: string
  fallbackClassName?: string
}

const getInitial = (appName: string) => getStartMenuAppDisplayName({ appName, targetPath: '', sourcePath: '' }).slice(0, 1).toUpperCase()

export default function StartMenuAppThumbnail({
  appName,
  iconPath,
  targetPath,
  sourcePath,
  className,
  imageClassName,
  fallbackClassName,
}: StartMenuAppThumbnailProps) {
  const [loadFailed, setLoadFailed] = useState(false)
  const [iconSrc, setIconSrc] = useState<string | null>(null)

  useEffect(() => {
    setLoadFailed(false)
  }, [iconPath, targetPath, sourcePath])

  useEffect(() => {
    let cancelled = false

    void resolveStartMenuAppIcon(iconPath ?? '', targetPath ?? '', sourcePath)
      .then((resolved) => {
        if (cancelled) return
        setIconSrc(resolved)
      })
      .catch(() => {
        if (cancelled) return
        setIconSrc(null)
      })

    return () => {
      cancelled = true
    }
  }, [iconPath, sourcePath, targetPath])

  if (iconSrc && !loadFailed) {
    return (
      <img
        src={iconSrc}
        alt=""
        aria-hidden="true"
        className={imageClassName ?? className ?? 'h-8 w-8 rounded-lg object-contain'}
        decoding="async"
        draggable={false}
        onError={() => setLoadFailed(true)}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      className={fallbackClassName ?? className ?? 'flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-[11px] font-bold text-slate-600 dark:bg-neutral-800 dark:text-slate-300'}
    >
      {getInitial(appName)}
    </div>
  )
}