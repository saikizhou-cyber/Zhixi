import Foundation
import Combine
import WatchConnectivity

struct WatchSummary: Codable, Sendable {
    let generatedAt: Date
    let level: String
    let currentHRV: Double?
    let hrvDate: Date?
    let heartRate: Double?
    let heartRateDate: Date?
    let baseline: Double?
    let lowerBound: Double?
    let upperBound: Double?
    let baselineDays: Int

    init(generatedAt: Date, assessment: HRVAssessment, heart: HealthReading?) {
        self.generatedAt = generatedAt
        level = assessment.level.rawValue
        currentHRV = assessment.current?.value
        hrvDate = assessment.current?.date
        heartRate = heart?.value
        heartRateDate = heart?.date
        baseline = assessment.baseline
        lowerBound = assessment.lowerBound
        upperBound = assessment.upperBound
        baselineDays = assessment.baselineDays
    }
}

@MainActor
final class WatchBridge: NSObject, ObservableObject, WCSessionDelegate {
    @Published private(set) var summary: WatchSummary?
    @Published private(set) var status: String?
    var onRefreshRequested: (() async -> Void)?
    private let session: WCSession?

    override init() {
        session = WCSession.isSupported() ? .default : nil
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func publish(_ summary: WatchSummary) {
        self.summary = summary
        guard let session, session.activationState == .activated else { return }
        #if os(iOS)
        guard session.isPaired, session.isWatchAppInstalled else { return }
        #endif
        do {
            let data = try JSONEncoder().encode(summary)
            try session.updateApplicationContext(["summary": data])
            status = nil
        } catch { status = "手表摘要尚未同步：\(error.localizedDescription)" }
    }

    func requestRefresh() {
        guard let session, session.activationState == .activated, session.isReachable else {
            status = "请在 iPhone 上打开知息。摘要也会在设备连接后由系统同步。"
            return
        }
        status = "正在向 iPhone 请求更新…"
        session.sendMessage(["refresh": true], replyHandler: nil) { [weak self] error in
            Task { @MainActor in self?.status = "暂时无法连接 iPhone：\(error.localizedDescription)" }
        }
    }

    private func receive(_ context: [String: Any]) {
        guard let data = context["summary"] as? Data else { return }
        do {
            let decoded = try JSONDecoder().decode(WatchSummary.self, from: data)
            let now = Date()
            func validDate(_ date: Date) -> Bool {
                date.timeIntervalSinceReferenceDate.isFinite && date <= now
            }
            guard validDate(decoded.generatedAt),
                  decoded.hrvDate.map(validDate) ?? (decoded.currentHRV == nil),
                  decoded.heartRateDate.map(validDate) ?? (decoded.heartRate == nil),
                  decoded.hrvDate.map({ $0 <= decoded.generatedAt }) ?? true,
                  decoded.heartRateDate.map({ $0 <= decoded.generatedAt }) ?? true,
                  decoded.currentHRV.map({ $0.isFinite && $0 > 0 }) ?? true,
                  decoded.heartRate.map({ $0.isFinite && $0 > 0 }) ?? true,
                  decoded.baseline.map({ $0.isFinite && $0 > 0 }) ?? true,
                  decoded.lowerBound.map({ $0.isFinite && $0 > 0 }) ?? true,
                  decoded.upperBound.map({ $0.isFinite && $0 > 0 }) ?? true,
                  SignalLevel(rawValue: decoded.level) != nil,
                  (0...28).contains(decoded.baselineDays) else {
                status = "收到的摘要无效，请在 iPhone 上重新刷新。"
                return
            }
            if let existing = summary, existing.generatedAt > decoded.generatedAt { return }
            summary = decoded
            status = nil
        } catch { status = "暂时无法读取手机摘要，请更新两端 App 后重试。" }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            if let error { self.status = "设备连接暂不可用：\(error.localizedDescription)"; return }
            #if os(watchOS)
            self.receive(session.receivedApplicationContext)
            #else
            if let summary = self.summary { self.publish(summary) }
            #endif
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.receive(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        guard message["refresh"] as? Bool == true else { return }
        Task { @MainActor in await self.onRefreshRequested?() }
    }

    #if os(iOS)
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}
    nonisolated func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in if let summary = self.summary { self.publish(summary) } }
    }
    #endif
}
