import SwiftUI

struct WatchDashboardView: View {
    @EnvironmentObject private var bridge: WatchBridge
    private let mint = Color(red: 0.48, green: 0.90, blue: 0.77)

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if let summary = bridge.summary {
                            summaryView(summary, at: context.date)
                        } else {
                            Image(systemName: "heart.text.square").font(.largeTitle).foregroundStyle(mint).accessibilityHidden(true)
                            Text("在 iPhone 上连接 Apple 健康").font(.headline)
                            Text("知息会将手机中的身体状态摘要同步到这里。")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        Button { bridge.requestRefresh() } label: {
                            Label("请求手机更新", systemImage: "arrow.clockwise")
                        }
                        .tint(mint)
                        if let status = bridge.status { Text(status).font(.footnote).foregroundStyle(.secondary) }
                        Text("手机摘要 · 同步可能延迟").font(.caption2).foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 4)
                }
            }
            .navigationTitle("知息")
        }
    }

    @ViewBuilder
    private func summaryView(_ summary: WatchSummary, at now: Date) -> some View {
        let stale = summary.hrvDate.map { now.timeIntervalSince($0) > BodyAnalysis.freshnessInterval } ?? true
        Text(statusTitle(summary, stale: stale)).font(.title3.bold())
            .foregroundStyle(stale ? Color.secondary : mint)
        if let value = summary.currentHRV {
            VStack(alignment: .leading, spacing: 4) {
                Text("HRV · SDNN").font(.caption).foregroundStyle(.secondary)
                Text("\(value.formatted(.number.precision(.fractionLength(0)))) ms")
                    .font(.title2.bold()).monospacedDigit()
                if let date = summary.hrvDate { Text("测量 \(timeText(date))").font(.caption2).foregroundStyle(.secondary) }
            }
            .accessibilityElement(children: .combine)
        }
        if let value = summary.heartRate {
            VStack(alignment: .leading, spacing: 4) {
                Text("最近心率").font(.caption).foregroundStyle(.secondary)
                Text("\(value.formatted(.number.precision(.fractionLength(0)))) bpm").font(.headline).monospacedDigit()
                if let date = summary.heartRateDate {
                    Text("测量 \(timeText(date))").font(.caption2).foregroundStyle(.secondary)
                    if now.timeIntervalSince(date) > BodyAnalysis.freshnessInterval {
                        Text("较早的记录").font(.caption2).foregroundStyle(.orange)
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
        if summary.level == SignalLevel.buildingBaseline.rawValue && !stale {
            Text("已有 \(summary.baselineDays) 个历史记录日，至少需要 7 天建立参考范围。")
                .font(.footnote).foregroundStyle(.secondary)
        }
        Text("同步 \(timeText(summary.generatedAt))").font(.caption2).foregroundStyle(.secondary)
        Text("HRV 趋势参考，不是健康诊断。").font(.caption2).foregroundStyle(.secondary)
    }

    private func statusTitle(_ summary: WatchSummary, stale: Bool) -> String {
        if summary.currentHRV == nil { return "等待 HRV 记录" }
        if stale { return "数据待更新" }
        switch SignalLevel(rawValue: summary.level) {
        case .belowUsual: return "近期 HRV 偏低"
        case .aboveUsual: return "近期 HRV 偏高"
        case .usual: return "接近平常范围"
        case .buildingBaseline: return "了解你的平常"
        case .stale: return "数据待更新"
        default: return "等待 HRV 记录"
        }
    }

    private func timeText(_ date: Date) -> String {
        date.formatted(.dateTime.month().day().hour().minute())
    }
}
