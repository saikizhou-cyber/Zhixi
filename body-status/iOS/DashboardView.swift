import SwiftUI
import Charts

private enum AppColors {
    static let background = Color(red: 0.035, green: 0.065, blue: 0.11)
    static let card = Color(red: 0.075, green: 0.12, blue: 0.18)
    static let mint = Color(red: 0.48, green: 0.90, blue: 0.77)
    static let amber = Color(red: 1.0, green: 0.78, blue: 0.43)
}

private enum AppTab: Hashable { case status, trends, breathe, settings }

struct DashboardView: View {
    @State private var selection: AppTab = .status

    var body: some View {
        TabView(selection: $selection) {
            StatusPage()
                .tabItem { Label("状态", systemImage: "waveform.path.ecg") }.tag(AppTab.status)
            TrendsPage()
                .tabItem { Label("趋势", systemImage: "chart.xyaxis.line") }.tag(AppTab.trends)
            BreathingPage(isSelected: selection == .breathe)
                .tabItem { Label("呼吸", systemImage: "wind") }.tag(AppTab.breathe)
            SettingsPage()
                .tabItem { Label("设置", systemImage: "slider.horizontal.3") }.tag(AppTab.settings)
        }
        .tint(AppColors.mint)
        .preferredColorScheme(.dark)
    }
}

private struct StatusPage: View {
    @EnvironmentObject private var model: HealthDashboard
    @State private var connecting = false

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text("留意身体，给自己一点余地。")
                            .font(.title3).foregroundStyle(.secondary)
                        if !model.isAvailable {
                            NoticeCard(title: "健康数据暂不可用", text: "请在支持 Apple 健康的 iPhone 上使用知息。")
                        } else if !model.accessRequested {
                            connectionCard
                        } else {
                            dashboard(at: context.date)
                        }
                        if let message = model.message {
                            NoticeCard(title: "数据读取提示", text: message)
                        }
                        if let message = model.backgroundMessage {
                            NoticeCard(title: "后台更新提示", text: message)
                        }
                    }
                    .padding()
                }
                .refreshable { await model.refresh() }
                .background(AppColors.background)
            }
            .navigationTitle("知息")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if model.isLoading {
                        ProgressView().accessibilityLabel("正在读取健康数据")
                    } else if model.accessRequested {
                        Button { Task { await model.refresh() } } label: {
                            Label("刷新", systemImage: "arrow.clockwise")
                        }
                    }
                }
            }
        }
    }

    private var connectionCard: some View {
        Card {
            Image(systemName: "heart.text.square")
                .font(.largeTitle).foregroundStyle(AppColors.mint).accessibilityHidden(true)
            Text("从你的真实记录开始").font(.title2.bold())
            Text("连接 Apple 健康，读取心率、HRV、静息心率、睡眠和运动记录。知息不会写入或修改健康记录。")
                .foregroundStyle(.secondary)
            Button {
                connecting = true
                Task {
                    await model.connect()
                    connecting = false
                }
            } label: {
                HStack {
                    if connecting { ProgressView() }
                    Text(connecting ? "正在连接…" : "连接 Apple 健康").fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent).tint(AppColors.mint).foregroundStyle(AppColors.background)
            .disabled(connecting)
            Text("你可以选择允许读取的指标。手表记录同步到 Apple 健康后，才会出现在这里。")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func dashboard(at now: Date) -> some View {
        let assessment = BodyAnalysis.assessHRV(model.hrv, now: now)
        Card {
            Label("近期身体信号", systemImage: "sparkle")
                .font(.subheadline).foregroundStyle(.secondary)
            Text(signalTitle(assessment.level)).font(.largeTitle.bold())
                .foregroundStyle(signalColor(assessment.level))
            Text(signalDescription(assessment)).foregroundStyle(.secondary)
            if let lower = assessment.lowerBound, let upper = assessment.upperBound {
                Divider()
                Text("个人常见范围  \(number(lower))–\(number(upper)) ms")
                    .font(.subheadline).monospacedDigit()
                Text("来自过去 28 天中 \(assessment.baselineDays) 天的每日 HRV 中位数。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Text("这是相对个人历史的趋势估计，不直接代表心理压力或疾病。")
                .font(.footnote).foregroundStyle(.secondary)
        }

        MetricCard(title: "心率变异性 · HRV", symbol: "waveform.path", unit: "ms", reading: assessment.current,
                   note: "SDNN · 与 Apple 健康的 HRV 指标一致", now: now)
        MetricCard(title: "最新心率", symbol: "heart", unit: "bpm", reading: latest(model.heartRate, at: now),
                   note: "这是最近一次记录，不是连续测量。", now: now)
        MetricCard(title: "静息心率", symbol: "heart.circle", unit: "bpm", reading: latest(model.restingHeartRate, at: now),
                   note: "按健康记录显示，通常不会实时更新。", now: now, marksStale: false)
        sleepCard(at: now)

        if model.hrv.isEmpty {
            NoticeCard(title: "还没有可读取的 HRV", text: "这可能是尚无记录、手表尚未同步，或未允许读取。请确认正常佩戴 Apple Watch，并在 Apple 健康中检查记录与知息的权限。")
        }
        if let loaded = model.lastLoadedAt {
            Text("最近读取：\(dateText(loaded))。各指标的测量时间可能不同。")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private func sleepCard(at now: Date) -> some View {
        let window = BodyAnalysis.sleepWindow(now: now)
        let seconds = BodyAnalysis.sleepDuration(model.sleepSegments, from: window.start, to: window.end)
        let lastRecord = model.sleepSegments.filter { $0.start < window.end && $0.end > window.start }.map(\.end).max()
        return Card {
            Label("最近睡眠记录", systemImage: "moon.zzz").font(.headline)
            Text(seconds > 0 ? durationText(seconds) : "暂无记录").font(.largeTitle.bold()).monospacedDigit()
            Text("\(dateText(window.start)) 至 \(dateText(window.end))")
                .font(.subheadline).foregroundStyle(.secondary)
            Text("Apple 健康 · 睡眠片段重叠去重，不包含卧床和清醒时长。")
                .font(.footnote).foregroundStyle(.secondary)
            if let lastRecord { Text("记录结束：\(dateText(min(lastRecord, now)))").font(.footnote).foregroundStyle(.secondary) }
            Text("汇总昨天中午至今天中午的记录；未到中午时截至现在。睡眠记录可能在醒来后才同步。")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct TrendsPage: View {
    @EnvironmentObject private var model: HealthDashboard

    var body: some View {
        NavigationStack {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        hrvChart(at: context.date)
                        sleepChart(at: context.date)
                        NoticeCard(title: "看变化，也看记录条件", text: "不同设备、来源和测量条件会影响 HRV。趋势只使用最近 HRV 的同一数据来源；没有记录的日期留空，不用 0 代替。")
                    }
                    .padding()
                }
                .refreshable { await model.refresh() }
                .background(AppColors.background)
            }
            .navigationTitle("身体的节奏")
        }
    }

    private func hrvChart(at now: Date) -> some View {
        let current = latest(model.hrv, at: now)
        let start = Calendar.current.date(byAdding: .day, value: -27, to: Calendar.current.startOfDay(for: now)) ?? now
        let sourceReadings = model.hrv.filter { $0.sourceID == current?.sourceID && $0.date >= start && $0.date <= now }
        let daily = BodyAnalysis.dailyMedians(sourceReadings)
        return Card {
            Text("28 天 HRV 趋势").font(.title2.bold())
            Text("每日中位数 · SDNN · ms").font(.subheadline).foregroundStyle(.secondary)
            if daily.isEmpty {
                EmptyChart(text: "记录同步后，这里会显示你的 HRV 趋势。")
            } else {
                Chart(daily) { reading in
                    PointMark(x: .value("日期", reading.date, unit: .day), y: .value("HRV", reading.value))
                        .foregroundStyle(AppColors.mint)
                }
                .chartXScale(domain: start...now)
                .chartXAxis { AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.month().day())
                } }
                .frame(height: 220)
                .accessibilityLabel("过去 28 天 HRV 每日中位数趋势，\(daily.count) 天有记录")
                Text("来源：\(current?.sourceName ?? "Apple 健康")").font(.footnote).foregroundStyle(.secondary)
                if let last = daily.last {
                    Text("最近一个记录日：\(last.date.formatted(.dateTime.month().day()))，中位数 \(number(last.value)) ms。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func sleepChart(at now: Date) -> some View {
        let days: [SleepDay] = (0..<7).reversed().compactMap { offset in
            guard let reference = Calendar.current.date(byAdding: .day, value: -offset, to: now) else { return nil }
            let endpoint = offset == 0 ? now : (Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: reference) ?? reference)
            let window = BodyAnalysis.sleepWindow(now: endpoint)
            let duration = BodyAnalysis.sleepDuration(model.sleepSegments, from: window.start, to: window.end)
            return SleepDay(date: Calendar.current.startOfDay(for: reference), duration: duration > 0 ? duration : nil)
        }
        let recorded = days.filter { $0.duration != nil }
        return Card {
            Text("7 天睡眠记录").font(.title2.bold())
            Text("睡眠时长 · 小时").font(.subheadline).foregroundStyle(.secondary)
            if recorded.isEmpty {
                EmptyChart(text: "暂无可读取的睡眠记录。请检查手表睡眠记录及健康数据权限。")
            } else {
                Chart(recorded) { day in
                    BarMark(x: .value("日期", day.date, unit: .day), y: .value("睡眠小时", (day.duration ?? 0) / 3600))
                        .foregroundStyle(AppColors.mint.opacity(0.8)).cornerRadius(4)
                }
                .chartXAxis { AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.day())
                } }
                .frame(height: 200)
                .accessibilityLabel("最近 7 天睡眠时长，\(recorded.count) 天有记录")
                Text("每根柱子对应前一天中午到当天中午的去重睡眠记录。今天尚未结束的窗口仅计算到现在。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

private struct SleepDay: Identifiable {
    var id: Date { date }
    let date: Date
    let duration: TimeInterval?
}

private struct BreathingPage: View {
    let isSelected: Bool
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startedAt: Date?
    @State private var finished = false

    private var isRunning: Bool { startedAt != nil && !finished }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    Text("一分钟，慢下来").font(.title2.bold())
                    Text("4 秒吸气，6 秒呼气。自然呼吸，不必用力或屏息。")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30, paused: !isRunning)) { context in
                        let elapsed = startedAt.map { max(0, context.date.timeIntervalSince($0)) } ?? 0
                        let phase = elapsed.truncatingRemainder(dividingBy: 10)
                        let inhaling = phase < 4
                        let progress = inhaling ? phase / 4 : 1 - (phase - 4) / 6
                        let caption = finished ? "给自己一个微笑" : (isRunning ? (inhaling ? "吸气" : "呼气") : "准备好了再开始")
                        VStack(spacing: 16) {
                            if !reduceMotion {
                                Circle()
                                    .fill(AppColors.mint.opacity(0.14))
                                    .overlay { Circle().stroke(AppColors.mint.opacity(0.8), lineWidth: 2) }
                                    .scaleEffect(isRunning ? 0.72 + 0.28 * progress : 0.82)
                                    .frame(width: 190, height: 190)
                                    .accessibilityHidden(true)
                            }
                            Text(caption).font(.largeTitle.bold()).foregroundStyle(AppColors.mint)
                            Text(finished ? "练习结束" : (isRunning ? "剩余 \(max(0, 60 - Int(elapsed))) 秒" : "全程 60 秒，可随时停止"))
                                .font(.title3).monospacedDigit().foregroundStyle(.secondary)
                        }
                        .onChange(of: context.date) { _, date in
                            if let startedAt, isRunning, date.timeIntervalSince(startedAt) >= 60 { finished = true }
                        }
                    }
                    Button {
                        if isRunning { stop() }
                        else { finished = false; startedAt = Date() }
                    } label: {
                        Text(isRunning ? "停止练习" : (finished ? "再练一次" : "开始 1 分钟"))
                            .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 10)
                    }
                    .buttonStyle(.borderedProminent).tint(AppColors.mint).foregroundStyle(AppColors.background)
                    Text("不舒服时随时停止。离开此页或切到后台会结束练习。此练习不写入健康记录。")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(24)
            }
            .background(AppColors.background)
            .navigationTitle("留一点空隙")
        }
        .onChange(of: isSelected) { _, selected in if !selected { stop() } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { stop() } }
        .onDisappear { stop() }
    }

    private func stop() { startedAt = nil; finished = false }
}

private struct SettingsPage: View {
    @EnvironmentObject private var model: HealthDashboard
    @State private var updatingReminder = false
    @State private var connecting = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("休息提醒", isOn: Binding(
                        get: { model.remindersEnabled },
                        set: { enabled in
                            updatingReminder = true
                            Task {
                                await model.setRemindersEnabled(enabled)
                                updatingReminder = false
                            }
                        }
                    ))
                    .disabled(updatingReminder)
                    Text("两次近期 HRV 记录持续低于个人常见范围时，可能建议休息。提醒仅在 08:00–22:00 发送，至少间隔 4 小时。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("近 30 分钟有已记录的运动时会暂停提醒；缺少运动记录不代表没有运动。系统后台调度与数据同步会影响提醒时机。")
                        .font(.footnote).foregroundStyle(.secondary)
                } header: { Text("温和提醒") }
                .listRowBackground(AppColors.card)

                Section {
                    Button(connecting ? "正在检查…" : "检查健康授权") {
                        connecting = true
                        Task { await model.connect(); connecting = false }
                    }
                    .disabled(connecting || !model.isAvailable)
                    Text("如需调整已选择的权限，请打开 Apple 健康，在个人资料中的 App 与服务列表找到「知息」。界面名称可能随系统版本不同。")
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("Apple 不向 App 提供读取权限是否被拒绝的结果。没有读到数据也可能是没有记录或尚未同步。")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let message = model.message { Text(message).font(.footnote).foregroundStyle(AppColors.amber) }
                } header: { Text("数据与权限") }
                .listRowBackground(AppColors.card)

                Section {
                    Text("心率、HRV、静息心率、睡眠和运动均来自 Apple 健康。只申请读取，不修改或新增健康记录。")
                    Text("分析在设备本地进行，无服务器、无账号。通过 Apple WatchConnectivity 向配对手表同步必要摘要，手表显示可能延迟。")
                } header: { Text("你的数据") }
                .listRowBackground(AppColors.card)

                Section {
                    Text("HRV 使用 SDNN。个人常见范围取过去 28 天同一来源的每日中位数的第 25–75 百分位，至少需要 7 个记录日，不包含今天。")
                    Text("超过 30 分钟的 HRV 会显示「数据待更新」。这只是本 App 的新鲜度标准，并不表示手表必须每 30 分钟测量一次。")
                    Text("偏高或偏低都只说明与平常不同，不代表健康好坏。知息不提供诊断，也不用于紧急情况监测。")
                } header: { Text("如何理解结果") }
                .font(.subheadline)
                .listRowBackground(AppColors.card)
            }
            .scrollContentBackground(.hidden)
            .background(AppColors.background)
            .navigationTitle("按自己的节奏")
        }
    }
}

private struct MetricCard: View {
    let title: String
    let symbol: String
    let unit: String
    let reading: HealthReading?
    let note: String
    let now: Date
    var marksStale = true

    var body: some View {
        Card {
            Label(title, systemImage: symbol).font(.headline)
            if let reading {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(number(reading.value)).font(.largeTitle.bold()).monospacedDigit()
                        Text(unit).font(.headline).foregroundStyle(.secondary)
                    }
                    Text("\(number(reading.value)) \(unit)").font(.title.bold())
                }
                Text("测量：\(dateText(reading.date))").font(.subheadline).foregroundStyle(.secondary)
                if marksStale && now.timeIntervalSince(reading.date) > BodyAnalysis.freshnessInterval {
                    Label("较早的记录，等待新数据", systemImage: "clock").font(.footnote).foregroundStyle(AppColors.amber)
                }
                Text("来源：\(reading.sourceName)").font(.footnote).foregroundStyle(.secondary)
            } else {
                Text("暂无可读取数据").font(.title3).foregroundStyle(.secondary)
            }
            Text(note).font(.footnote).foregroundStyle(.secondary)
        }
    }
}

private struct Card<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) { self.content = content() }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(AppColors.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

private struct NoticeCard: View {
    let title: String
    let text: String
    var body: some View {
        Card {
            Label(title, systemImage: "info.circle").font(.headline).foregroundStyle(AppColors.amber)
            Text(text).font(.subheadline).foregroundStyle(.secondary)
        }
    }
}

private struct EmptyChart: View {
    let text: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "chart.xyaxis.line").font(.largeTitle).accessibilityHidden(true)
            Text(text).multilineTextAlignment(.center)
        }
        .foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 36)
    }
}

private func latest(_ readings: [HealthReading], at now: Date) -> HealthReading? {
    readings.filter { $0.value.isFinite && $0.value > 0 && $0.date <= now }.max { $0.date < $1.date }
}

private func number(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0))) }
private func dateText(_ date: Date) -> String { date.formatted(.dateTime.month().day().hour().minute()) }
private func durationText(_ seconds: TimeInterval) -> String {
    let minutes = Int(seconds / 60)
    return "\(minutes / 60) 小时 \(minutes % 60) 分钟"
}

private func signalTitle(_ level: SignalLevel) -> String {
    switch level {
    case .noData: return "等待身体的信号"
    case .buildingBaseline: return "了解你的平常"
    case .stale: return "数据待更新"
    case .belowUsual: return "近期 HRV 偏低"
    case .usual: return "接近平常范围"
    case .aboveUsual: return "近期 HRV 偏高"
    }
}

private func signalColor(_ level: SignalLevel) -> Color {
    switch level {
    case .belowUsual, .aboveUsual: return AppColors.amber
    case .usual: return AppColors.mint
    default: return .white
    }
}

private func signalDescription(_ assessment: HRVAssessment) -> String {
    switch assessment.level {
    case .noData: return "有了 HRV 记录，才能开始查看个人变化。"
    case .buildingBaseline: return "已找到 \(assessment.baselineDays) 个历史记录日；至少需要 7 天，才能建立个人参考范围。"
    case .stale: return "最近一次 HRV 已超过 30 分钟，不能据此判断当前状态。"
    case .belowUsual: return "这次 HRV 低于你的近期常见范围。结合当下感受与休息情况一起看。"
    case .usual: return "这次 HRV 在你的近期常见范围内。继续按自己的节奏安排今天。"
    case .aboveUsual: return "这次 HRV 高于你的近期常见范围。更高不一定更好，先留意后续变化。"
    }
}
