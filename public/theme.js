try {
  const theme = localStorage.getItem('geosite-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {}
