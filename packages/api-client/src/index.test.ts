import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildError, createRequestClient } from './index.js'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function textResponse(body: string, init?: ResponseInit) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain' },
    ...init,
  })
}

describe('buildError', () => {
  it('parses {error, message} JSON into Error with status + code', async () => {
    const res = new Response(JSON.stringify({ error: 'bad_input', message: 'human readable' }), {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json' },
    })
    const err = await buildError(res)
    expect(err.message).toBe('human readable')
    expect(err.status).toBe(400)
    expect(err.code).toBe('bad_input')
  })

  it('falls through to raw shape when JSON has {error} but no message', async () => {
    const body = JSON.stringify({ error: 'oops' })
    const res = new Response(body, {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
    })
    const err = await buildError(res)
    expect(err.message).toBe(`500 Internal Server Error: ${body}`)
    expect(err.status).toBe(500)
    expect(err.code).toBeUndefined()
  })

  it('uses message when JSON has message but no error field; code is undefined', async () => {
    const res = new Response(JSON.stringify({ message: 'm', other: 'x' }), {
      status: 422,
      statusText: 'Unprocessable',
      headers: { 'content-type': 'application/json' },
    })
    const err = await buildError(res)
    expect(err.message).toBe('m')
    expect(err.status).toBe(422)
    expect(err.code).toBeUndefined()
  })

  it('falls through to raw shape for non-JSON body', async () => {
    const res = new Response('not json at all', {
      status: 502,
      statusText: 'Bad Gateway',
    })
    const err = await buildError(res)
    expect(err.message).toBe('502 Bad Gateway: not json at all')
    expect(err.status).toBe(502)
    expect(err.code).toBeUndefined()
  })

  it('falls through for empty body, status still set', async () => {
    const res = new Response('', { status: 503, statusText: 'Unavailable' })
    const err = await buildError(res)
    expect(err.message).toBe('503 Unavailable: ')
    expect(err.status).toBe(503)
  })

  it('preserves status for 404', async () => {
    const res = new Response('nope', { status: 404, statusText: 'Not Found' })
    const err = await buildError(res)
    expect(err.status).toBe(404)
  })

  it('preserves status for 500', async () => {
    const res = new Response(JSON.stringify({ error: 'e', message: 'boom' }), {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
    })
    const err = await buildError(res)
    expect(err.status).toBe(500)
    expect(err.message).toBe('boom')
    expect(err.code).toBe('e')
  })
})

describe('createRequestClient → req', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GET without token or body sends no Authorization or Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/things')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/things')
    expect(init.headers).toEqual({})
  })

  it('GET with token sets Authorization: Bearer <token>', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/me', {}, 'abc.def.ghi')
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Authorization).toBe('Bearer abc.def.ghi')
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('POST with JSON body sets Content-Type: application/json', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ created: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/things', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('POST without body does NOT set Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/things', { method: 'POST' })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('POST with body and token sets both headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/things', { method: 'POST', body: JSON.stringify({}) }, 'tok')
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('does not pass credentials when not set in opts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/x')
    const init = fetchMock.mock.calls[0][1]
    expect(init.credentials).toBeUndefined()
  })

  it("propagates credentials: 'include' from opts on every call", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true }))
    const { req } = createRequestClient({
      baseUrl: 'https://api.example.com',
      credentials: 'include',
    })
    await req('/a')
    await req('/b')
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
    expect(fetchMock.mock.calls[1][1].credentials).toBe('include')
  })

  it('returns parsed JSON object on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ hello: 'world', n: 42 }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const result = await req<{ hello: string; n: number }>('/x')
    expect(result).toEqual({ hello: 'world', n: 42 })
  })

  it('returns undefined on 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const result = await req('/x')
    expect(result).toBeUndefined()
  })

  it('returns undefined when response is text/plain (non-JSON guard)', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('plain text'))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const result = await req('/x')
    expect(result).toBeUndefined()
  })

  it('returns undefined when response has no content-type header', async () => {
    fetchMock.mockResolvedValueOnce(new Response('whatever', { status: 200 }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const result = await req('/x')
    expect(result).toBeUndefined()
  })

  it('throws on 400 with {error, message}; .status + .code populated', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'bad', message: 'no good' }), {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      })
    )
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await expect(req('/x')).rejects.toMatchObject({
      message: 'no good',
      status: 400,
      code: 'bad',
    })
  })

  it('throws on 500 with {error} only; uses raw fallback message', async () => {
    const body = JSON.stringify({ error: 'kaboom' })
    fetchMock.mockResolvedValueOnce(
      new Response(body, {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'application/json' },
      })
    )
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await expect(req('/x')).rejects.toMatchObject({
      message: `500 Internal Server Error: ${body}`,
      status: 500,
    })
  })

  it('passes through additional headers from init.headers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/x', { headers: { 'X-Trace-Id': 'abc' } })
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers['X-Trace-Id']).toBe('abc')
  })

  it('prepends baseUrl directly to path (no normalization)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { req } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await req('/path/here')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/path/here')
  })
})

describe('createRequestClient → upload', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs FormData without Content-Type when no token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { upload } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const fd = new FormData()
    fd.append('file', new Blob(['hi']), 'hi.txt')
    await upload('/upload', fd)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/upload')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(fd)
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('upload with token sets Authorization: Bearer <token>', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { upload } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const fd = new FormData()
    await upload('/upload', fd, 'tok')
    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('upload propagates credentials option from opts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { upload } = createRequestClient({
      baseUrl: 'https://api.example.com',
      credentials: 'include',
    })
    await upload('/upload', new FormData())
    expect(fetchMock.mock.calls[0][1].credentials).toBe('include')
  })

  it('upload throws via buildError on non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'too_big', message: 'file too large' }), {
        status: 413,
        statusText: 'Payload Too Large',
        headers: { 'content-type': 'application/json' },
      })
    )
    const { upload } = createRequestClient({ baseUrl: 'https://api.example.com' })
    await expect(upload('/upload', new FormData())).rejects.toMatchObject({
      message: 'file too large',
      status: 413,
      code: 'too_big',
    })
  })

  it('upload returns parsed JSON on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'asset_1' }))
    const { upload } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const result = await upload<{ id: string }>('/upload', new FormData())
    expect(result).toEqual({ id: 'asset_1' })
  })

  it('upload returns undefined on 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    const { upload } = createRequestClient({ baseUrl: 'https://api.example.com' })
    const result = await upload('/upload', new FormData())
    expect(result).toBeUndefined()
  })
})
