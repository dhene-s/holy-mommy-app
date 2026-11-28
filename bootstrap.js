// Runs independently of app modules, including when a module fails to download.
setTimeout(() => {
  const screen = document.getElementById('app');
  if (screen?.dataset.booting !== 'true') return;
  screen.dataset.booting = 'false';
  screen.innerHTML = '<h1>Не получилось загрузить приложение</h1><p>Проверьте соединение и откройте приложение снова. Сохранённые данные остаются на устройстве.</p><button id="retry-start">Попробовать снова</button>';
  document.getElementById('retry-start').addEventListener('click', () => location.reload());
}, 20000);
