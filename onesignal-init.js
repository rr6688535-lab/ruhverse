(function () {
  const canUseNotifications = 'Notification' in window;
  let oneSignalInstance = null;
  let oneSignalReady = false;
  let notificationButton = null;
  let notificationPrompt = null;
  let promptRequested = false;

  const getPushSubscription = function () {
    if (!oneSignalReady || !oneSignalInstance || !oneSignalInstance.User) return null;
    return oneSignalInstance.User.PushSubscription || null;
  };

  const notificationsEnabled = function () {
    const pushSubscription = getPushSubscription();
    if (pushSubscription && typeof pushSubscription.optedIn === 'boolean') {
      return Notification.permission === 'granted' && pushSubscription.optedIn;
    }

    return canUseNotifications && Notification.permission === 'granted';
  };

  const setNotificationButtonState = function () {
    if (!notificationButton) return;

    if (!canUseNotifications) {
      notificationButton.hidden = true;
      return;
    }

    const isEnabled = notificationsEnabled();
    notificationButton.hidden = false;
    notificationButton.classList.toggle('is-enabled', isEnabled);
    notificationButton.setAttribute(
      'aria-label',
      isEnabled
        ? 'Disable notifications'
        : 'Enable notifications'
    );
    notificationButton.title = isEnabled
      ? 'Disable notifications'
      : 'Enable notifications';
  };

  const requestPushPermission = async function (forcePrompt) {
    if (!forcePrompt && promptRequested) return;

    try {
      if (!canUseNotifications) {
        window.alert('This browser does not support web notifications.');
        return;
      }

      if (Notification.permission === 'denied') {
        promptRequested = true;
        window.alert('Notifications are blocked. Please allow RuhVerse notifications from your browser site settings.');
        return;
      }

      if (Notification.permission === 'granted') {
        const pushSubscription = getPushSubscription();
        if (pushSubscription && typeof pushSubscription.optIn === 'function' && pushSubscription.optedIn === false) {
          await pushSubscription.optIn();
        }
        promptRequested = true;
        setNotificationButtonState();
        return;
      }

      if (
        oneSignalReady &&
        oneSignalInstance &&
        oneSignalInstance.Slidedown &&
        typeof oneSignalInstance.Slidedown.promptPush === 'function'
      ) {
        await oneSignalInstance.Slidedown.promptPush(forcePrompt ? { force: true } : undefined);
        promptRequested = true;
        return;
      }

      if (
        oneSignalReady &&
        oneSignalInstance &&
        oneSignalInstance.Notifications &&
        typeof oneSignalInstance.Notifications.requestPermission === 'function'
      ) {
        await oneSignalInstance.Notifications.requestPermission();
        promptRequested = true;
        return;
      }

      if (Notification.requestPermission) {
        await Notification.requestPermission();
        promptRequested = true;
      }
    } catch (error) {
      if (canUseNotifications && Notification.permission !== 'default') {
        promptRequested = true;
      }
      console.warn('Notification permission prompt could not be shown.', error);
      window.alert('Please allow notifications from your browser site settings to receive RuhVerse updates.');
    } finally {
      setNotificationButtonState();
      hideNotificationPrompt();
    }
  };

  const disablePushNotifications = async function () {
    try {
      const pushSubscription = getPushSubscription();
      if (pushSubscription && typeof pushSubscription.optOut === 'function') {
        await pushSubscription.optOut();
        promptRequested = true;
        setNotificationButtonState();
        return;
      }

      window.alert('To fully turn off browser notifications, open site settings for RuhVerse and block notifications.');
    } catch (error) {
      console.warn('Notification opt-out failed.', error);
      window.alert('Notifications could not be disabled here. Please block RuhVerse notifications from your browser site settings.');
    } finally {
      setNotificationButtonState();
    }
  };

  const handleNotificationButtonClick = function () {
    if (notificationsEnabled()) {
      disablePushNotifications();
      return;
    }

    requestPushPermission(true);
  };

  const hideNotificationPrompt = function () {
    if (notificationPrompt) {
      notificationPrompt.hidden = true;
    }
  };

  const createNotificationButton = function () {
    if (notificationButton || !document.body) return;

    const existingButton = document.querySelector('[data-notification-subscribe]');
    if (existingButton) {
      notificationButton = existingButton;
      notificationButton.addEventListener('click', handleNotificationButtonClick);
      setNotificationButtonState();
      createNotificationPrompt();
      return;
    }

    const style = document.createElement('style');
    style.textContent = [
      '.ruh-notification-button{position:fixed;right:22px;bottom:86px;width:54px;height:54px;border:0;border-radius:50%;background:#1a4d2e;color:#fff;box-shadow:0 12px 28px rgba(0,0,0,.22);cursor:pointer;z-index:2147483000;display:grid;place-items:center;font-size:23px;line-height:1;transition:transform .2s ease,background .2s ease;}',
      '.ruh-notification-button:hover{transform:translateY(-2px);background:#23663e;}',
      '.ruh-notification-button.is-enabled{background:#d4af37;color:#17351f;}',
      '.ruh-notification-button[hidden]{display:none;}',
      '.ruh-notification-prompt{position:fixed;right:22px;bottom:150px;width:min(320px,calc(100vw - 32px));border:1px solid rgba(26,77,46,.18);border-radius:12px;background:#fff;color:#17351f;box-shadow:0 18px 46px rgba(0,0,0,.2);padding:14px;z-index:2147482999;font-family:Inter,Arial,sans-serif;}',
      '.ruh-notification-prompt[hidden]{display:none;}',
      '.ruh-notification-prompt strong{display:block;margin:0 0 5px;font-size:15px;}',
      '.ruh-notification-prompt p{margin:0 0 12px;font-size:13px;line-height:1.45;color:#4b5f52;}',
      '.ruh-notification-prompt-actions{display:flex;gap:8px;justify-content:flex-end;}',
      '.ruh-notification-prompt button{border:0;border-radius:8px;cursor:pointer;font:600 13px Inter,Arial,sans-serif;padding:8px 11px;}',
      '.ruh-notification-allow{background:#1a4d2e;color:#fff;}',
      '.ruh-notification-later{background:#eef3ef;color:#17351f;}'
    ].join('');
    document.head.appendChild(style);

    notificationButton = document.createElement('button');
    notificationButton.type = 'button';
    notificationButton.className = 'ruh-notification-button';
    notificationButton.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';
    notificationButton.setAttribute('data-notification-subscribe', '');
    notificationButton.addEventListener('click', handleNotificationButtonClick);
    document.body.appendChild(notificationButton);
    setNotificationButtonState();
    createNotificationPrompt();
  };

  const createNotificationPrompt = function () {
    if (notificationPrompt || !canUseNotifications || Notification.permission !== 'default') return;

    notificationPrompt = document.createElement('section');
    notificationPrompt.className = 'ruh-notification-prompt';
    notificationPrompt.setAttribute('aria-label', 'Enable RuhVerse notifications');
    notificationPrompt.hidden = true;

    const title = document.createElement('strong');
    title.textContent = String.fromCodePoint(128276) + ' Enable RuhVerse notifications';

    const copy = document.createElement('p');
    copy.textContent = 'Allow reminders and new Islamic content updates from RuhVerse.';

    const actions = document.createElement('div');
    actions.className = 'ruh-notification-prompt-actions';

    const laterButton = document.createElement('button');
    laterButton.type = 'button';
    laterButton.className = 'ruh-notification-later';
    laterButton.textContent = 'Later';
    laterButton.addEventListener('click', hideNotificationPrompt);

    const allowButton = document.createElement('button');
    allowButton.type = 'button';
    allowButton.className = 'ruh-notification-allow';
    allowButton.textContent = 'Allow';
    allowButton.addEventListener('click', function () {
      requestPushPermission(true);
    });

    actions.appendChild(laterButton);
    actions.appendChild(allowButton);
    notificationPrompt.appendChild(title);
    notificationPrompt.appendChild(copy);
    notificationPrompt.appendChild(actions);
    document.body.appendChild(notificationPrompt);

    window.setTimeout(function () {
      if (canUseNotifications && Notification.permission === 'default') {
        notificationPrompt.hidden = false;
      }
    }, 900);
  };

  const initNotificationButton = function () {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createNotificationButton, { once: true });
      return;
    }

    createNotificationButton();
  };

  initNotificationButton();

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function (OneSignal) {
    oneSignalInstance = OneSignal;

    try {
      await OneSignal.init({
        appId: 'd1feb8cc-5929-42b8-a78f-55455c3f6613',
        safari_web_id: 'web.onesignal.auto.69a0d04c-4cfa-4f80-8d34-652264ce8748',
        serviceWorkerPath: '/push/onesignal/OneSignalSDKWorker.js',
        serviceWorkerParam: { scope: '/push/onesignal/' },
        notifyButton: {
          enable: false,
          size: 'medium',
          position: 'bottom-right',
          prenotify: true,
          showCredit: false,
          displayPredicate: function () {
            return true;
          }
        },
        promptOptions: {
          slidedown: {
            prompts: [
              {
                type: 'push',
                autoPrompt: true,
                delay: {
                  pageViews: 1,
                  timeDelay: 2
                },
                text: {
                  actionMessage: 'Allow RuhVerse notifications for prayer reminders and new Islamic content.',
                  acceptButton: 'Allow',
                  cancelButton: 'Later'
                }
              }
            ]
          }
        },
        allowLocalhostAsSecureOrigin: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      });
      oneSignalReady = true;
      const pushSubscription = getPushSubscription();
      if (pushSubscription && typeof pushSubscription.addEventListener === 'function') {
        pushSubscription.addEventListener('change', setNotificationButtonState);
      }
      setNotificationButtonState();
    } catch (error) {
      console.warn('OneSignal could not be initialized.', error);
    }
  });
})();
