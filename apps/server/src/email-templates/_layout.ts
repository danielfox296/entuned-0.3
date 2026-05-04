// Shared layout shell for transactional emails.
// Inline CSS only — most clients (Gmail, Outlook) strip <style> blocks.
//
// Brand palette (per VOICE.md / CLAUDE.md design system):
//   bg          #0a0a0a (per spec — close cousin of site #080808)
//   gold accent #d7af74
//   text        #E8E4DE
// Font stack: system, no webfont fetch (faster + safer in mail clients).

export const COLORS = {
  bg: '#0a0a0a',
  card: '#111111',
  border: '#222222',
  gold: '#d7af74',
  text: '#E8E4DE',
  muted: '#9a958c',
} as const

const FONT_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

export interface LayoutProps {
  preheader?: string
  body: string
}

/** Wrap a body fragment in the standard Entuned email shell. */
export function layout({ preheader, body }: LayoutProps): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>Entuned</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.bg};color:${COLORS.text};font-family:${FONT_STACK};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.bg};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;background:${COLORS.card};border:1px solid ${COLORS.border};">
        <tr>
          <td style="padding:28px 32px 16px 32px;border-bottom:1px solid ${COLORS.border};">
            <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${COLORS.gold};font-weight:600;">Entuned</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px 32px;font-size:15px;line-height:1.55;color:${COLORS.text};">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px 24px 32px;border-top:1px solid ${COLORS.border};font-size:11px;color:${COLORS.muted};line-height:1.5;">
            Entuned &middot; Retail music strategy<br/>
            <a href="https://entuned.co" style="color:${COLORS.muted};text-decoration:underline;">entuned.co</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

/** Standard primary CTA button. */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;">
  <tr>
    <td style="background:${COLORS.gold};">
      <a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;letter-spacing:0.04em;color:#0a0a0a;text-decoration:none;font-family:${FONT_STACK};">${escape(label)}</a>
    </td>
  </tr>
</table>`
}

/** Minimal HTML escape for interpolated user/account values. */
export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function escapeAttr(s: string): string {
  return escape(s)
}
