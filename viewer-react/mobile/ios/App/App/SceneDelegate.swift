import UIKit
import Capacitor

// Current iOS SDKs (iOS 26+, enforced on the iOS 27 simulator) require UIScene
// lifecycle adoption. Capacitor 7's stock template still creates its window from the
// AppDelegate and Main.storyboard, which now traps at launch with
// "UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption". This delegate builds
// the window from the Main storyboard (the Capacitor bridge view controller) and
// attaches it to the window scene; Info.plist carries the matching
// UIApplicationSceneManifest, and UIMainStoryboardFile is deliberately absent.
//
// Once scenes are adopted UIKit stops calling the UIApplicationDelegate's open-URL and
// continue-userActivity callbacks, and Capacitor has no scene support of its own, so both
// are forwarded to ApplicationDelegateProxy here. Nothing in the app uses deep links yet;
// forwarding keeps @capacitor/app's appUrlOpen working the day something does (the Portal
// OIDC flow in viewer-react/src/auth/portal.ts is the likely first caller).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window.rootViewController = storyboard.instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()

        // A cold launch caused by a URL or Universal Link delivers it here, not through
        // the scene(_:openURLContexts:) / scene(_:continue:) callbacks below.
        if let urlContext = connectionOptions.urlContexts.first {
            handle(urlContext)
        }
        for activity in connectionOptions.userActivities
        where activity.activityType == NSUserActivityTypeBrowsingWeb {
            handle(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let urlContext = URLContexts.first else { return }
        handle(urlContext)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        handle(userActivity)
    }

    private func handle(_ urlContext: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let sourceApplication = urlContext.options.sourceApplication {
            options[.sourceApplication] = sourceApplication
        }
        if let annotation = urlContext.options.annotation {
            options[.annotation] = annotation
        }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            open: urlContext.url,
            options: options
        )
    }

    private func handle(_ userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }
}
