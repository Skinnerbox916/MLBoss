/** Shared SWR fetcher — throws on non-OK responses. */
export const fetcher = (url: string) =>
  fetch(url).then(res => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });
