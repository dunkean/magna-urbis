/** Direct workshop links enter the app so switching stages retains live work. */
if (window.parent === window && location.protocol !== 'file:') {
  const current = new URL(location.href);
  if (current.searchParams.get('standalone') !== '1') {
    const page = current.pathname.split('/').pop();
    const stage = page === 'urbanbench.html' ? 'urban' : page === 'housebench.html' ? 'houses' : page === 'citybench.html' ? 'city'
      : current.searchParams.get('stage') === 'settlements' ? 'settlements' : 'terrain';
    const params = new URLSearchParams(current.search);
    const fragment = new URLSearchParams(current.hash.slice(1));
    for (const key of ['sketch', 'zones']) {
      const value = fragment.get(key);
      if (value) params.set(key, value);
    }
    const shell = new URL('rustbench.html', current);
    shell.search = '';
    for (const key of ['profile', 'localServer']) {
      const value = params.get(key);
      if (value) shell.searchParams.set(key, value);
    }
    shell.hash = `${stage}${params.size ? `?${params}` : ''}`;
    location.replace(shell.href);
  }
}
