// Legacy HTTP smoke tests keep explicit cookie handles instead of a browser cookie jar.
// Map a handle to the latest Set-Cookie value so password/session rotation is exercised
// without weakening production auth or rewriting each historical smoke flow.
const nativeFetch = globalThis.fetch
const replacements = new Map()

function cookieFrom(headers) {
  const value = headers.get('cookie') || ''
  return value.split(';').map((part) => part.trim()).find((part) => part.startsWith('lumirror_admin=')) || ''
}
function replacement(cookie) {
  let current = cookie
  const seen = new Set()
  while (current && replacements.has(current) && !seen.has(current)) {
    seen.add(current)
    const next = replacements.get(current)
    if (next === current) break
    current = next
  }
  return current
}

globalThis.fetch = async function testFetch(input, init = undefined) {
  const request = new Request(input,init)
  const headers = new Headers(request.headers)
  const supplied = cookieFrom(headers)
  const current = replacement(supplied)
  if (supplied && current && current !== supplied) {
    const parts = (headers.get('cookie') || '').split(';').map((part) => part.trim()).filter(Boolean)
    headers.set('cookie',parts.map((part) => part === supplied ? current : part).join('; '))
  }
  const response = await nativeFetch(new Request(request,{headers}))
  const setCookie = response.headers.get('set-cookie')?.split(';')[0] || ''
  if (setCookie) {
    replacements.set(setCookie,setCookie)
    if (supplied) replacements.set(supplied,setCookie)
    if (current) replacements.set(current,setCookie)
  }
  return response
}
