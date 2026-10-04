const input = document.getElementById('appUrl');
const status = document.getElementById('status');

chrome.storage.sync.get('appUrl').then(({ appUrl }) => {
  if (appUrl) input.value = appUrl;
});

document.getElementById('save').addEventListener('click', async () => {
  let url;
  try {
    url = new URL(input.value.trim());
  } catch {
    status.textContent = 'URL が正しくありません';
    return;
  }
  url.hash = '';
  const value = url.href.replace(/\/?$/, '/');
  input.value = value;
  await chrome.storage.sync.set({ appUrl: value });
  status.textContent = '保存しました';
});
