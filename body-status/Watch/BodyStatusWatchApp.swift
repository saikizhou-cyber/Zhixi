import SwiftUI

@main
@MainActor
struct BodyStatusWatchApp: App {
    @StateObject private var bridge = WatchBridge()

    var body: some Scene {
        WindowGroup {
            WatchDashboardView()
                .environmentObject(bridge)
        }
    }
}
