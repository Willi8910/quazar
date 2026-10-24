//! macOS notifications, through the system framework rather than Tauri's plugin: the plugin always
//! answers "granted" on desktop (so Quazar couldn't tell they're off) and can't say which
//! notification was clicked (so it couldn't open the tab).

use tauri::AppHandle;

/// Starts listening for clicks on Quazar's notifications: each emits `notification-clicked` with the
/// tab it's about. Call once at startup.
pub fn install(app: &AppHandle) {
    platform::install(app);
}

/// Shows a notification about a tab; clicking it opens that tab. False when the system framework
/// isn't available (e.g. a development build), so the caller can fall back to the plugin.
#[tauri::command]
pub async fn notify(tab_id: String, title: String, subtitle: String, body: String) -> bool {
    platform::notify(&tab_id, &title, &subtitle, &body)
}

/// "granted", "denied", "not-determined" (never asked), or "unsupported" (not running from the app
/// bundle, e.g. in development, where the macOS notification framework isn't available).
#[tauri::command]
pub async fn notification_permission() -> &'static str {
    platform::status()
}

/// Asks the user (macOS shows its prompt only the first time), then reports the result as above.
#[tauri::command]
pub async fn request_notification_permission() -> &'static str {
    platform::request()
}

/// Opens System Settings at Quazar's notification settings.
#[tauri::command]
pub fn open_notification_settings(app: tauri::AppHandle) -> Result<(), String> {
    let id = &app.config().identifier;
    let url = format!("x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={id}");
    let status = crate::platform::command("open").arg(url).status().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| "Couldn't open System Settings".into())
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass};
    use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent, UNNotification,
        UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse, UNNotificationSettings,
        UNNotificationSound, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use tauri::{AppHandle, Emitter};

    define_class!(
        /// Receives clicks on Quazar's notifications, and lets them show while Quazar is in front.
        #[unsafe(super(NSObject))]
        #[name = "QuazarNotificationDelegate"]
        #[ivars = AppHandle]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                // Quazar only notifies about tabs out of view, so show it even when Quazar is in front.
                handler.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                handler: &DynBlock<dyn Fn()>,
            ) {
                let id = response.notification().request().identifier().to_string();
                if let Some(tab) = tab_of(&id) {
                    let _ = self.ivars().emit("notification-clicked", tab);
                }
                handler.call(());
            }
        }
    );

    /// Notification ids are `tab:<tab id>:<time>`.
    fn tab_of(id: &str) -> Option<&str> {
        id.strip_prefix("tab:")?.split(':').next().filter(|t| !t.is_empty())
    }

    #[cfg(test)]
    pub fn tab_of_for_test(id: &str) -> Option<&str> {
        tab_of(id)
    }

    pub fn install(app: &AppHandle) {
        if !bundled() {
            return;
        }
        let delegate: Retained<Delegate> = unsafe { msg_send![super(Delegate::alloc().set_ivars(app.clone())), init] };
        UNUserNotificationCenter::currentNotificationCenter().setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        // The center holds its delegate weakly; this one lives as long as the app.
        std::mem::forget(delegate);
    }

    pub fn notify(tab: &str, title: &str, subtitle: &str, body: &str) -> bool {
        if !bundled() {
            return false;
        }
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setSubtitle(&NSString::from_str(subtitle));
        content.setBody(&NSString::from_str(body));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        // Grouped per tab in Notification Center.
        content.setThreadIdentifier(&NSString::from_str(tab));
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis());
        let id = NSString::from_str(&format!("tab:{tab}:{now}"));
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
        UNUserNotificationCenter::currentNotificationCenter().addNotificationRequest_withCompletionHandler(&request, None);
        true
    }

    /// The notification framework needs an app bundle; called outside one it aborts the process.
    fn bundled() -> bool {
        crate::update::running_app().is_some()
    }

    fn name(status: UNAuthorizationStatus) -> &'static str {
        match status {
            UNAuthorizationStatus::NotDetermined => "not-determined",
            UNAuthorizationStatus::Denied => "denied",
            _ => "granted",
        }
    }

    pub fn status() -> &'static str {
        if !bundled() {
            return "unsupported";
        }
        let (tx, rx) = mpsc::channel();
        let done = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            let _ = tx.send(unsafe { settings.as_ref() }.authorizationStatus());
        });
        UNUserNotificationCenter::currentNotificationCenter().getNotificationSettingsWithCompletionHandler(&done);
        rx.recv_timeout(Duration::from_secs(5)).map_or("unsupported", name)
    }

    pub fn request() -> &'static str {
        if !bundled() {
            return "unsupported";
        }
        let (tx, rx) = mpsc::channel();
        let done = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = tx.send(());
        });
        let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge;
        UNUserNotificationCenter::currentNotificationCenter()
            .requestAuthorizationWithOptions_completionHandler(options, &done);
        // The user may take a while to answer the prompt.
        let _ = rx.recv_timeout(Duration::from_secs(120));
        status()
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn install(_app: &tauri::AppHandle) {}
    pub fn notify(_tab: &str, _title: &str, _subtitle: &str, _body: &str) -> bool {
        false
    }
    pub fn status() -> &'static str {
        "unsupported"
    }
    pub fn request() -> &'static str {
        "unsupported"
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn reads_the_tab_from_a_notification_id() {
        assert_eq!(super::platform::tab_of_for_test("tab:t123abc:1700000000000"), Some("t123abc"));
        assert_eq!(super::platform::tab_of_for_test("other"), None);
        assert_eq!(super::platform::tab_of_for_test("tab::1"), None);
    }
}
