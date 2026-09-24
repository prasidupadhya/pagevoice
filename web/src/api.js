export async function api(path, options={}) {
  const headers = options.body instanceof FormData ? {} : {'Content-Type':'application/json'}
  let response
  try { response = await fetch(path,{...options,headers:{...headers,...options.headers}}) }
  catch { throw new Error('apiOffline') }
  if (!response.ok) {
    const body = await response.json().catch(()=>({}))
    const detail = typeof body.detail==='string' ? body.detail : JSON.stringify(body.detail || response.statusText)
    throw new Error(detail)
  }
  return response.json()
}
