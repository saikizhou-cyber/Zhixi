import SwiftUI
import UIKit

@MainActor
final class BodyStatusAppDelegate: NSObject, UIApplicationDelegate {
    let model = HealthDashboard()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        model.prepareForLaunch()
        return true
    }
}

@main
@MainActor
struct BodyStatusApp: App {
    @UIApplicationDelegateAdaptor(BodyStatusAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            NativeDashboardView()
                .environmentObject(appDelegate.model)
                .task { await appDelegate.model.start() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active && appDelegate.model.accessRequested {
                        Task { await appDelegate.model.refresh() }
                    }
                }
        }
    }
}
