(function () {
  const token = localStorage.getItem('mc_token');

  function killSession() {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    window.location.replace('index.html?expired=1');
  }

  if (!token) {
    killSession();
    return;
  }

  fetch('https://med-clarivo.onrender.com/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` }
  })
    .then(res => {
      if (res.status === 401 || res.status === 404) {
        killSession();
      }
    })
    .catch(() => {});

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch.apply(this, args).then(res => {
      if (res.status === 401) killSession();
      return res;
    });
  };

  window.addEventListener('pageshow', function (event) {
    if (event.persisted && !localStorage.getItem('mc_token')) {
      killSession();
    }
  });
})();
