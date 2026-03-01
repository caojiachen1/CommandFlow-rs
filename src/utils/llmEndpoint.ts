const endsWithVersionSegment = (url: string): boolean => {
  const segment = url.split('/').filter(Boolean).at(-1) ?? ''
  if (!segment.startsWith('v') || segment.length < 2) {
    return false
  }
  return [...segment.slice(1)].every((ch) => ch >= '0' && ch <= '9')
}

export const resolveGuiAgentChatEndpointPreview = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }

  if (trimmed.endsWith('/chat/completions')) {
    return trimmed
  }

  if (trimmed.endsWith('/models')) {
    const root = trimmed.replace(/\/models$/, '')
    if (endsWithVersionSegment(root)) {
      return `${root}/chat/completions`
    }
    return `${root}/v1/chat/completions`
  }

  if (endsWithVersionSegment(trimmed)) {
    return `${trimmed}/chat/completions`
  }

  return `${trimmed}/v1/chat/completions`
}

export const isLikelyValidBaseUrl = (baseUrl: string): boolean => {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    return false
  }

  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
