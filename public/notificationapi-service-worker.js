self.addEventListener('push', (event) => {
  if (!(self.Notification && self.Notification.permission === 'granted')) {
    console.log('Push event received but notification permission not granted.');
    return;
  }

  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.error('Error parsing push data json', e);
      data = {
        title: 'New Notification',
        message: event.data.text() || 'You have a new update.',
        icon: '/images/default-notification-icon.png',
        url: '/',
        tag: 'default-tag'
      };
    }
  } else {
    console.log('Push event received with no data.');
    return; // Atau tampilkan notifikasi default jika ingin
  }

  const title = data.title || 'SHARE SOURCE CODE';
  const message = data.message || 'You have a new notification.';
  const icon = data.icon || '/images/default-notification-icon.png'; 
  const tag = data.tag || data.notificationId || 'general-notification'; // Gunakan notificationId sebagai tag jika ada
  const url = data.url || self.registration.scope; // URL default jika tidak ada

  const options = {
    body: message,
    tag: tag,
    icon: icon,
    data: {
      url: url,
      notificationapi_notification_id: data.notificationId, // Simpan ID NotificationAPI untuk tracking/analytics jika perlu
      // Anda bisa menambahkan data lain di sini yang dikirim dari payload push
    },
    actions: data.actions || []
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data.url;
  
  console.log('Notification clicked:', event.notification);
  console.log('Action:', event.action);
  console.log('URL to open:', urlToOpen);

  if (urlToOpen) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (let i = 0; i < clientList.length; i++) {
          let client = clientList[i];
          let clientUrl = new URL(client.url);
          let notificationUrl = new URL(urlToOpen, self.location.origin); // Pastikan URL notifikasi absolut

          // Coba mencocokkan path, abaikan query string untuk fokus tab
          if (clientUrl.pathname === notificationUrl.pathname && 'focus' in client) {
            console.log('Found existing client to focus:', client.url);
            return client.focus();
          }
        }
        if (clients.openWindow) {
          console.log('Opening new window for:', notificationUrl.href);
          return clients.openWindow(notificationUrl.href);
        }
      })
    );
  }
});