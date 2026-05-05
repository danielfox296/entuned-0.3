// Brand wordmark — pulled from entuned.co (img/entuned-logo-ice.svg).
// Copied into public/ so the dashboard isn't fetching from a different
// domain at runtime. Default height matches the marketing site header.

interface Props {
  height?: number
  alt?: string
}

export function Logo({ height = 22, alt = 'Entuned' }: Props) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}entuned-logo.svg`}
      alt={alt}
      style={{ height, display: 'block' }}
    />
  )
}
